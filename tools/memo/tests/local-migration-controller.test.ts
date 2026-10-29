import { describe, it, expect } from 'vitest';
import { createLocalMigrationController } from '../src/local-migration-controller';
import { fixture, ids } from './migration-fixtures';
import { createPendingMigration } from '../src/migration';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';

const ticket = (controller: ReturnType<typeof createLocalMigrationController>) => {
  const state = controller.getState(); if (state.kind !== 'confirmation') throw new Error('確認状態であること'); return state.token;
};
describe('移行・復旧の明示承認制御', () => {
  it('診断・キャンセルは書かず、生文字列を公開状態へ出さない', async () => {
    const f = fixture(), c = createLocalMigrationController(f.deps); await c.inspect();
    expect(JSON.stringify(c.getState())).not.toContain(f.raw); expect(JSON.stringify(c.getState())).not.toContain('legacySnapshot');
    const token = ticket(c); c.cancel(token); await c.confirm(token);
    expect(c.getState().kind).toBe('cancelled'); expect(f.storage.writes).toEqual([]); expect(f.generated()).toBe(0);
  });
  it('再診断で古い承認を失効させる', async () => {
    const f = fixture(), c = createLocalMigrationController(f.deps); await c.inspect(); const old = ticket(c);
    await c.inspect(); await c.confirm(old); expect(f.storage.writes).toEqual([]); expect(ticket(c)).not.toBe(old);
  });
  it('同じ確認の二重実行を拒否し旧キーを保持する', async () => {
    const f = fixture(), c = createLocalMigrationController(f.deps); await c.inspect(); const token = ticket(c);
    await Promise.all([c.confirm(token), c.confirm(token)]);
    expect(c.getState()).toMatchObject({ kind: 'ready', source: 'migrated' }); expect(f.storage.writes).toHaveLength(2);
    expect(f.storage.values.get(OLD_STORAGE_KEY)).toBe(f.raw);
  });
  it('承認後の旧値変化は停止して古い確認を再利用できない', async () => {
    const f = fixture(), c = createLocalMigrationController(f.deps); await c.inspect(); const token = ticket(c);
    f.storage.values.set(OLD_STORAGE_KEY, '[]'); await c.confirm(token); await c.confirm(token);
    expect(c.getState()).toMatchObject({ kind: 'stopped', result: { reason: 'approval-changed' } }); expect(f.storage.writes).toEqual([]);
  });
  it('中断はreadyにせず、再診断と新しい復旧承認を要求する', async () => {
    const f = fixture(), c = createLocalMigrationController(f.deps);
    f.storage.afterSet = () => { delete f.storage.afterSet; throw new Error('中断'); };
    await c.inspect(); const token = ticket(c); await c.confirm(token);
    expect(c.getState()).toMatchObject({ kind: 'stopped', result: { writeOutcome: 'unverified', remaining: { v2: 'pending' } } });
    await c.confirm(token); expect(f.storage.writes).toHaveLength(1);
    await c.inspect(); expect(c.getState()).toMatchObject({ kind: 'confirmation', operation: 'recover' }); expect(f.storage.writes).toHaveLength(1);
    await c.confirm(ticket(c)); expect(c.getState()).toMatchObject({ kind: 'ready', source: 'recovered' }); expect(f.storage.writes).toHaveLength(2);
  });
  it('pending診断だけでは復旧しない', async () => {
    const f = fixture(); let n = 0; f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(createPendingMigration(f.raw, () => ids[n++]!)));
    const c = createLocalMigrationController(f.deps); await c.inspect(); expect(c.getState()).toMatchObject({ kind: 'confirmation', operation: 'recover' }); expect(f.storage.writes).toEqual([]);
  });
  it('新旧なしでは書込なしで通常利用可能', async () => {
    const f = fixture(null), c = createLocalMigrationController(f.deps); await c.inspect();
    expect(c.getState()).toMatchObject({ kind: 'ready', source: 'empty' }); expect(f.storage.writes).toEqual([]);
  });
  it.each(['{', '[]'])('不正v2は空扱いせず停止：%s', async raw => {
    const f = fixture(); f.storage.values.set(NEW_STORAGE_KEY, raw); const c = createLocalMigrationController(f.deps); await c.inspect();
    expect(c.getState().kind).toBe('stopped'); expect(f.storage.values.get(NEW_STORAGE_KEY)).toBe(raw); expect(f.storage.writes).toEqual([]);
  });
  it('ロック非対応では停止', async () => {
    const f = fixture(), c = createLocalMigrationController({ ...f.deps, locks: undefined }); await c.inspect();
    expect(c.getState()).toMatchObject({ kind: 'stopped', result: { reason: 'locks-unavailable' } }); expect(f.storage.writes).toEqual([]);
  });
  it('診断応答が逆順でも古い結果を反映しない', async () => {
    const f = fixture(); const release: Array<() => void> = [];
    const locks = { request: <T>(_name: string, _options: { mode: 'exclusive' }, run: () => Promise<T>) => new Promise<T>((resolve, reject) => { release.push(() => { void run().then(resolve, reject); }); }) };
    const c = createLocalMigrationController({ ...f.deps, locks }); const first = c.inspect(), second = c.inspect();
    release[1]!(); await second; const newest = ticket(c); f.storage.values.set(OLD_STORAGE_KEY, '{'); release[0]!(); await first;
    expect(ticket(c)).toBe(newest);
  });
  it('既存v2は検証して保持し通常利用可能', async () => {
    const f = fixture(), raw = JSON.stringify({ version: 2, migration: { status: 'not-required' }, memos: [], tags: [], memoTags: [] });
    f.storage.values.set(NEW_STORAGE_KEY, raw); const c = createLocalMigrationController(f.deps); await c.inspect();
    expect(c.getState()).toMatchObject({ kind: 'ready', source: 'existing' }); expect(f.storage.writes).toEqual([]);
    expect(f.storage.values.get(NEW_STORAGE_KEY)).toBe(raw);
  });
  it('確認後に作られた既存v2を上書きしない', async () => {
    const f = fixture(), c = createLocalMigrationController(f.deps); await c.inspect();
    const raw = JSON.stringify({ version: 2, migration: { status: 'not-required' }, memos: [], tags: [], memoTags: [] });
    f.storage.values.set(NEW_STORAGE_KEY, raw); await c.confirm(ticket(c));
    expect(c.getState()).toMatchObject({ kind: 'ready', source: 'existing' }); expect(f.storage.writes).toEqual([]);
  });
  it('復旧承認後にpendingが変わると書かず停止する', async () => {
    const f = fixture(); let n = 0; const raw = JSON.stringify(createPendingMigration(f.raw, () => ids[n++]!));
    f.storage.values.set(NEW_STORAGE_KEY, raw); const c = createLocalMigrationController(f.deps); await c.inspect();
    f.storage.values.set(NEW_STORAGE_KEY, ` ${raw}`); await c.confirm(ticket(c));
    expect(c.getState()).toMatchObject({ kind: 'stopped', result: { reason: 'approval-changed' } }); expect(f.storage.writes).toEqual([]);
  });
  it('complete書込後例外でも成功にせず、再診断による既存v2確認と区別する', async () => {
    const f = fixture(), c = createLocalMigrationController(f.deps);
    f.storage.afterSet = () => { if (f.storage.writes.length === 2) throw new Error('中断'); };
    await c.inspect(); await c.confirm(ticket(c));
    expect(c.getState()).toMatchObject({ kind: 'stopped', result: { writeOutcome: 'unverified', remaining: { v2: 'complete' } } });
    await c.inspect(); expect(c.getState()).toMatchObject({ kind: 'ready', source: 'existing' }); expect(f.storage.writes).toHaveLength(2);
  });
  it('実行中の再診断やキャンセルで書込状態を変更しない', async () => {
    const f = fixture(), c = createLocalMigrationController(f.deps); await c.inspect(); const token = ticket(c);
    const pending = c.confirm(token); await c.inspect(); c.cancel(token); expect(c.getState().kind).toBe('running');
    await pending; expect(f.storage.writes).toHaveLength(2);
  });
  it('不正旧値や元例外を表示状態へ漏らさない', async () => {
    const f = fixture(); f.storage.beforeGet = () => { throw new Error(`PRIVATE-${f.raw}`); };
    const c = createLocalMigrationController(f.deps); await c.inspect();
    expect(c.getState().kind).toBe('stopped'); expect(JSON.stringify(c.getState())).not.toContain('PRIVATE');
    expect(JSON.stringify(c.getState())).not.toContain('legacySnapshot'); expect(f.storage.writes).toEqual([]);
  });
  it('ready後の明示再診断でpendingや不正への変化を再検証する', async () => {
    const f = fixture(null), c = createLocalMigrationController(f.deps); await c.inspect();
    expect(c.getState().kind).toBe('ready');
    f.storage.values.set(NEW_STORAGE_KEY, '{'); await c.inspect();
    expect(c.getState()).toMatchObject({ kind: 'stopped', result: { reason: 'invalid-data' } });
    expect(f.storage.writes).toEqual([]);
  });
});

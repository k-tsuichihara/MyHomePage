import { describe, expect, it } from 'vitest';
import { inspectLocalMigration, migrateLocalData, recoverLocalMigration, NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';
import { createPendingMigration } from '../src/migration';
import { fixture, ids, oldRows } from './migration-fixtures';

function withPending() {
  const f = fixture(); let index = 0;
  const pendingRaw = JSON.stringify(createPendingMigration(f.raw, () => ids[index++]!));
  f.storage.values.set(NEW_STORAGE_KEY, pendingRaw);
  return { ...f, pendingRaw };
}
describe('ロック内での移行・復旧と保存先保護', () => {
  it('判定だけでは書込・UUID生成しない', async () => {
    const f = fixture();
    expect(await inspectLocalMigration(f.deps)).toEqual({ kind: 'migration-required', legacySnapshot: f.raw });
    expect(f.storage.writes).toEqual([]); expect(f.generated()).toBe(0);
  });
  it('両キーなしは空判定のみでnot-requiredを書かない', async () => {
    const f = fixture(null);
    expect(await inspectLocalMigration(f.deps)).toEqual({ kind: 'empty' });
    expect(f.storage.values.size).toBe(0); expect(f.storage.writes).toEqual([]);
  });
  it('正常移行はpending→completeを2回書き、旧キーを原文保持する', async () => {
    const f = fixture(); const result = await migrateLocalData(f.deps, f.raw);
    expect(result.kind).toBe('migrated'); expect(f.storage.writes).toHaveLength(2);
    expect(f.storage.writes.map(([, raw]) => JSON.parse(raw).migration.status)).toEqual(['pending', 'complete']);
    expect(f.storage.writes.every(([key]) => key === NEW_STORAGE_KEY)).toBe(true);
    expect(f.storage.values.get(OLD_STORAGE_KEY)).toBe(f.raw); expect(f.generated()).toBe(2);
    expect(await inspectLocalMigration(f.deps)).toMatchObject({ kind: 'existing', data: { kind: 'validated-complete' } });
  });
  it('空の旧配列も明示承認後に移行する', async () => {
    const f = fixture('[]'); expect(await migrateLocalData(f.deps, f.raw)).toMatchObject({ kind: 'migrated', value: { memos: [] } });
    expect(f.generated()).toBe(0);
  });
  it('非対応時・ロック取得失敗時は書き込まない', async () => {
    const f = fixture();
    expect(await migrateLocalData({ ...f.deps, locks: undefined }, f.raw)).toMatchObject({ kind: 'stopped', reason: 'locks-unavailable', writeOutcome: 'not-attempted' });
    expect(await migrateLocalData({ ...f.deps, locks: { request: async () => { throw new Error('失敗'); } } }, f.raw)).toMatchObject({ kind: 'stopped', reason: 'lock-failure' });
    expect(f.storage.writes).toEqual([]); expect(f.generated()).toBe(0);
  });
  it('ロック待機中に旧生文字列が変わったら再承認を要求する', async () => {
    const f = fixture(); let release!: () => void;
    const blocker = f.locks.request('test', { mode: 'exclusive' }, () => new Promise<void>(resolve => { release = resolve; }));
    await Promise.resolve();
    const result = migrateLocalData(f.deps, f.raw);
    f.storage.values.set(OLD_STORAGE_KEY, ` ${f.raw}`); release(); await blocker;
    expect(await result).toMatchObject({ kind: 'stopped', reason: 'approval-changed' });
    expect(f.storage.writes).toEqual([]);
  });
  it('二重移行を直列化し、後続はロック内で既存completeを返す', async () => {
    const f = fixture();
    const results = await Promise.all([migrateLocalData(f.deps, f.raw), migrateLocalData(f.deps, f.raw)]);
    expect(results.map(row => row.kind)).toEqual(['migrated', 'existing']);
    expect(f.storage.writes).toHaveLength(2); expect(f.generated()).toBe(2);
  });
  it('既存not-requiredを保持し、旧値への恒久的一致を要求しない', async () => {
    const f = fixture(); const raw = JSON.stringify({ version: 2, migration: { status: 'not-required' }, memos: [], tags: [], memoTags: [] });
    f.storage.values.set(NEW_STORAGE_KEY, raw);
    expect(await migrateLocalData(f.deps, f.raw)).toMatchObject({ kind: 'existing' });
    expect(f.storage.values.get(NEW_STORAGE_KEY)).toBe(raw); expect(f.storage.writes).toEqual([]);
  });
  it.each(['{', 'null', '[]'])('不正な新値を上書きしない: %s', raw => {
    return (async () => {
      const f = fixture(); f.storage.values.set(NEW_STORAGE_KEY, raw);
      expect(await migrateLocalData(f.deps, f.raw)).toMatchObject({ kind: 'stopped', reason: 'invalid-data' });
      expect(f.storage.values.get(NEW_STORAGE_KEY)).toBe(raw); expect(f.storage.writes).toEqual([]);
    })();
  });
  it('不正な旧値はUUID生成・書込前に拒否する', async () => {
    const f = fixture(JSON.stringify([{ ...oldRows()[0], title: ' 不正' }]));
    expect(await migrateLocalData(f.deps, f.raw)).toMatchObject({ kind: 'stopped', reason: 'invalid-data' });
    expect(f.generated()).toBe(0); expect(f.storage.writes).toEqual([]);
  });
  it('生成器失敗・重複は再生成せず停止する', async () => {
    for (const createId of [() => { throw new Error('合成失敗'); }, () => ids[0]!]) {
      const f = fixture(); expect(await migrateLocalData({ ...f.deps, createId }, f.raw)).toMatchObject({ kind: 'stopped', reason: 'uuid-failure' });
      expect(f.storage.writes).toEqual([]);
    }
  });
  it.each([NEW_STORAGE_KEY, OLD_STORAGE_KEY])('生成中に他処理が%sを書いたら、直前照合で停止する', async key => {
    const f = fixture(); let generated = 0;
    const result = await migrateLocalData({ ...f.deps, createId: () => { f.storage.values.set(key, 'external'); return ids[generated++]!; } }, f.raw);
    expect(result).toMatchObject({ kind: 'stopped', reason: 'snapshot-changed', phase: 'pending-write', writeOutcome: 'not-attempted' });
    expect(f.storage.writes).toEqual([]);
    expect(f.storage.values.get(key)).toBe('external');
  });
  it('pendingの判定では書かず、通常移行でも復旧を代行しない', async () => {
    const f = withPending();
    expect(await inspectLocalMigration(f.deps)).toEqual({ kind: 'recovery-ready', legacySnapshot: f.raw, pendingSnapshot: f.pendingRaw });
    expect(await migrateLocalData(f.deps, f.raw)).toMatchObject({ kind: 'stopped', reason: 'recovery-required' });
    expect(f.storage.writes).toEqual([]); expect(f.generated()).toBe(0);
  });
  it('明示復旧では既存UUIDを保ち、completeだけを書いて再照合する', async () => {
    const f = withPending();
    expect(await recoverLocalMigration(f.deps, f.raw, f.pendingRaw)).toMatchObject({ kind: 'recovered' });
    expect(f.generated()).toBe(0); expect(f.storage.writes).toHaveLength(1);
    expect(JSON.parse(f.storage.writes[0]![1]).memos.map((row: { id: string }) => row.id)).toEqual(ids);
    expect(f.storage.values.get(OLD_STORAGE_KEY)).toBe(f.raw);
  });
  it('確認したpending生文字列が変わった場合は書込を拒否する', async () => {
    const f = withPending(); f.storage.values.set(NEW_STORAGE_KEY, ` ${f.pendingRaw}`);
    expect(await recoverLocalMigration(f.deps, f.raw, f.pendingRaw)).toMatchObject({ kind: 'stopped', reason: 'approval-changed' });
    expect(f.storage.writes).toEqual([]);
  });
  it('旧値なし・旧生文字列不一致・初期状態不一致のpendingは停止する', async () => {
    for (const mode of ['missing', 'changed', 'revision']) {
      const f = withPending();
      if (mode === 'missing') f.storage.values.delete(OLD_STORAGE_KEY);
      if (mode === 'changed') f.storage.values.set(OLD_STORAGE_KEY, ` ${f.raw}`);
      if (mode === 'revision') { const value = JSON.parse(f.pendingRaw); value.memos[0].revision = 2; f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(value)); }
      expect(await inspectLocalMigration(f.deps)).toMatchObject({ kind: 'stopped', reason: 'invalid-data' });
      expect(f.storage.writes).toEqual([]);
    }
  });
  it('pendingが消失しても復旧操作から新規移行を開始しない', async () => {
    const f = withPending(); f.storage.values.delete(NEW_STORAGE_KEY);
    expect(await recoverLocalMigration(f.deps, f.raw, f.pendingRaw)).toMatchObject({ kind: 'stopped', reason: 'approval-changed' });
    expect(f.storage.writes).toEqual([]); expect(f.generated()).toBe(0);
  });
});

describe('障害・中断後の状態報告（成功と断定しない）', () => {
  it.each([1, 2])('%s回目の書込が失敗しても削除・再試行しない', async step => {
    const f = fixture(); let attempts = 0;
    f.storage.beforeSet = () => { if (++attempts === step) throw new Error('合成容量不足'); };
    const result = await migrateLocalData(f.deps, f.raw);
    expect(result).toMatchObject({ kind: 'stopped', reason: 'storage-failure', writeOutcome: 'unverified',
      remaining: { legacy: 'present', v2: step === 1 ? 'absent' : 'pending' } });
    expect(attempts).toBe(step); expect(f.storage.writes).toHaveLength(step - 1);
    expect(f.storage.values.get(OLD_STORAGE_KEY)).toBe(f.raw);
  });
  it.each([1, 2])('%s回目の書込後に例外が出た場合、保存済みとは表示しない', async step => {
    const f = fixture();
    f.storage.afterSet = () => { if (f.storage.writes.length === step) throw new Error('合成中断'); };
    expect(await migrateLocalData(f.deps, f.raw)).toMatchObject({ kind: 'stopped', writeOutcome: 'unverified', remaining: { v2: step === 1 ? 'pending' : 'complete' } });
    expect(f.storage.writes).toHaveLength(step);
  });
  it.each([1, 2])('%s回目の読戻しが不一致ならその場で停止する', async step => {
    const f = fixture();
    f.storage.afterSet = () => { if (f.storage.writes.length === step) f.storage.values.set(NEW_STORAGE_KEY, 'broken'); };
    expect(await migrateLocalData(f.deps, f.raw)).toMatchObject({ kind: 'stopped', reason: 'snapshot-changed', writeOutcome: 'unverified', remaining: { v2: 'invalid' } });
    expect(f.storage.writes).toHaveLength(step);
  });
  it.each([1, 2])('%s回目の読戻しが取得不能なら状態不明として停止する', async step => {
    const f = fixture();
    f.storage.beforeGet = key => { if (key === NEW_STORAGE_KEY && f.storage.writes.length === step) throw new Error('合成読取失敗'); };
    expect(await migrateLocalData(f.deps, f.raw)).toMatchObject({ kind: 'stopped', reason: 'storage-failure', writeOutcome: 'unverified', remaining: { v2: 'unreadable' } });
    expect(f.storage.writes).toHaveLength(step);
  });
  it('旧値がpending書込直後に変わったらcompleteへ進めない', async () => {
    const f = fixture(); f.storage.afterSet = () => { f.storage.values.set(OLD_STORAGE_KEY, 'changed externally'); };
    expect(await migrateLocalData(f.deps, f.raw)).toMatchObject({ kind: 'stopped', reason: 'snapshot-changed', remaining: { v2: 'pending' } });
    expect(f.storage.writes).toHaveLength(1);
  });
  it('pending直後の中断から、別の明示操作で復旧できる', async () => {
    const f = fixture(); f.storage.afterSet = () => { throw new Error('中断'); };
    expect((await migrateLocalData(f.deps, f.raw)).kind).toBe('stopped');
    delete f.storage.afterSet;
    const inspected = await inspectLocalMigration(f.deps);
    if (inspected.kind !== 'recovery-ready') throw new Error('復旧対象であること');
    expect((await recoverLocalMigration(f.deps, inspected.legacySnapshot, inspected.pendingSnapshot)).kind).toBe('recovered');
  });
  it('complete直後の中断でも次回は検証だけで既存データを保持する', async () => {
    const f = withPending(); f.storage.afterSet = () => { throw new Error('中断'); };
    expect((await recoverLocalMigration(f.deps, f.raw, f.pendingRaw)).kind).toBe('stopped');
    delete f.storage.afterSet;
    expect((await inspectLocalMigration(f.deps)).kind).toBe('existing'); expect(f.storage.writes).toHaveLength(1);
  });
  it('最初の読取失敗と残存状態の読取失敗も実値なしで報告する', async () => {
    const f = fixture(); f.storage.beforeGet = () => { throw new Error(`PRIVATE-${f.raw}`); };
    const result = await inspectLocalMigration(f.deps);
    expect(result).toMatchObject({ kind: 'stopped', writeOutcome: 'not-attempted', remaining: { legacy: 'unreadable', v2: 'unreadable' } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE'); expect(JSON.stringify(result)).not.toContain(oldRows()[0]!.title);
  });
  it('任意の確認後に行われたロック外の変更を次の書込前にも検出する', async () => {
    const f = withPending(); let reads = 0;
    f.storage.beforeGet = key => { if (key === NEW_STORAGE_KEY && ++reads === 2) f.storage.values.set(NEW_STORAGE_KEY, 'foreign'); };
    expect(await recoverLocalMigration(f.deps, f.raw, f.pendingRaw)).toMatchObject({ kind: 'stopped', reason: 'snapshot-changed' });
    expect(f.storage.writes).toEqual([]);
  });
  it('新規移行でもpending読戻し後の変更をcomplete書込直前に再確認する', async () => {
    const f = fixture(); let reads = 0;
    f.storage.beforeGet = key => { if (key === NEW_STORAGE_KEY && ++reads === 4) f.storage.values.set(NEW_STORAGE_KEY, 'foreign'); };
    expect(await migrateLocalData(f.deps, f.raw)).toMatchObject({ kind: 'stopped', reason: 'snapshot-changed', phase: 'complete-write', writeOutcome: 'unverified' });
    expect(f.storage.writes).toHaveLength(1); expect(f.storage.values.get(NEW_STORAGE_KEY)).toBe('foreign');
  });
  it('復旧の読戻しが不一致でもcomplete成功と断定しない', async () => {
    const f = withPending(); f.storage.afterSet = () => { f.storage.values.set(NEW_STORAGE_KEY, 'broken'); };
    expect(await recoverLocalMigration(f.deps, f.raw, f.pendingRaw)).toMatchObject({ kind: 'stopped', writeOutcome: 'unverified', phase: 'complete-readback' });
    expect(f.storage.writes).toHaveLength(1);
  });
});

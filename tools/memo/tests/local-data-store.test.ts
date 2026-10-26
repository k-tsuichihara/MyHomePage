import { describe, expect, it } from 'vitest';
import { createLocalDataStore } from '../src/local-data-store';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';
import { createPendingMigration } from '../src/migration';
import { saveFixture, state, MEMO, NOW } from './local-save-fixtures';

describe('ローカル書込基盤の非破壊読込', () => {
  it('両キーなしはemptyで、事前初期化しない', async () => {
    const f = saveFixture(null);
    expect(await f.store.load()).toEqual({ kind: 'empty' }); expect(f.storage.writes).toEqual([]);
  });
  it('検証した独立データを返し、返却値の編集は保存しない', async () => {
    const f = saveFixture(), result = await f.store.load();
    expect(result).toEqual({ kind: 'loaded', value: state() });
    if (result.kind !== 'loaded') throw new Error('読込成功');
    result.value.memos[0]!.title = '編集';
    expect(JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!).memos[0].title).toBe('元のタイトル');
    expect(f.storage.writes).toEqual([]);
  });
  it.each(['{', 'null', '[]', '{}'])('不正新値%sを空データに補正しない', async raw => {
    const f = saveFixture(null); f.storage.values.set(NEW_STORAGE_KEY, raw);
    expect(await f.store.load()).toEqual({ kind: 'unavailable', reason: 'invalid-data' });
    expect(f.storage.values.get(NEW_STORAGE_KEY)).toBe(raw); expect(f.storage.writes).toEqual([]);
  });
  it('旧値のみは移行要求、pendingは復旧要求とし自動処理しない', async () => {
    const f = saveFixture(null); f.storage.values.set(OLD_STORAGE_KEY, '[]');
    expect(await f.store.load()).toEqual({ kind: 'unavailable', reason: 'migration-required' });
    f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(createPendingMigration('[]', () => MEMO)));
    expect(await f.store.load()).toEqual({ kind: 'unavailable', reason: 'recovery-required' });
    expect(f.storage.writes).toEqual([]);
  });
  it('保存先とロックの失敗理由に元例外を含めない', async () => {
    const f = saveFixture(); f.storage.beforeGet = () => { throw new Error('PRIVATE'); };
    expect(await f.store.load()).toEqual({ kind: 'unavailable', reason: 'storage-failure' });
    expect(await createLocalDataStore({ storage: f.storage, locks: undefined }).load()).toEqual({ kind: 'unavailable', reason: 'locks-unavailable' });
    expect(await createLocalDataStore({ storage: f.storage, locks: { request: async () => { throw new Error('PRIVATE'); } } }).load()).toEqual({ kind: 'unavailable', reason: 'lock-failure' });
  });
});
describe('候補全体・メタデータ・読戻しの検証', () => {
  it('変換候補の構造不正は未書込拒否する', async () => {
    const f = saveFixture(), store = createLocalDataStore(f.deps);
    expect(await store.transact(current => { current.memos[0]!.revision = 0; return current; })).toMatchObject({ kind: 'rejected' });
    expect(f.storage.writes).toEqual([]); expect(await f.store.load()).toEqual({ kind: 'loaded', value: state() });
  });
  it('migrationメタデータの変更を拒否する', async () => {
    const f = saveFixture();
    expect(await createLocalDataStore(f.deps).transact(current => ({ ...current, migration: { status: 'complete', legacySnapshot: '[]' } }))).toMatchObject({ kind: 'rejected', reason: 'invalid-data' });
    expect(f.storage.writes).toEqual([]);
  });
  it.each([OLD_STORAGE_KEY, NEW_STORAGE_KEY])('候補構築中に%sが変わったら上書きしない', async key => {
    const f = saveFixture();
    const result = await createLocalDataStore(f.deps).transact(current => { f.storage.values.set(key, 'external'); return current; });
    expect(result).toEqual({ kind: 'rejected', reason: 'snapshot-changed', writeOutcome: 'not-attempted' });
    expect(f.storage.values.get(key)).toBe('external'); expect(f.storage.writes).toEqual([]);
  });
  it.each(['before-set', 'after-set', 'read-failure', 'mismatch', 'legacy-change'])('書込試行後の%sはunknownで再試行しない', async mode => {
    const f = saveFixture(); let attempted = 0;
    f.storage.beforeSet = () => { attempted++; if (mode === 'before-set') throw new Error('PRIVATE'); };
    f.storage.afterSet = () => {
      if (mode === 'after-set') throw new Error('PRIVATE');
      if (mode === 'mismatch') f.storage.values.set(NEW_STORAGE_KEY, '{}');
      if (mode === 'legacy-change') f.storage.values.set(OLD_STORAGE_KEY, 'external');
    };
    if (mode === 'read-failure') f.storage.beforeGet = key => { if (key === NEW_STORAGE_KEY && f.storage.writes.length) throw new Error('PRIVATE'); };
    const result = await createLocalDataStore(f.deps).transact(current => {
      current.memos[0]!.updatedAt = NOW; return current;
    });
    expect(result).toMatchObject({ kind: 'unknown', writeOutcome: 'unverified' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE'); expect(attempted).toBe(1);
  });
});

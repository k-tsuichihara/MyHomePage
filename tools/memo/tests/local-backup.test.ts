import { describe, it, expect } from 'vitest';
import { createLocalBackup, MAX_BACKUP_BYTES } from '../src/local-backup';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';
import { LOCAL_DATA_LOCK_NAME } from '../src/local-lock';
import { state, NOW, token } from './local-save-fixtures';
import { createPendingMigration } from '../src/migration';

function fixture(value: unknown = { ...state(), version: 3, deletedMemoIds: [token(77)] }) {
  const values = new Map<string, string>();
  if (value !== undefined) values.set(NEW_STORAGE_KEY, JSON.stringify(value));
  let reads = 0;
  const locks: string[] = [];
  const storage = { getItem(key: string) { reads++; return values.get(key) ?? null; } };
  const deps = { storage, locks: { async request<T>(name: string, _options: { mode: 'exclusive' }, fn: () => Promise<T>) {
    locks.push(name); return fn();
  } }, now: () => NOW };
  return { values, deps, prepare: createLocalBackup(deps), locks, reads: () => reads };
}
describe('読取専用JSONバックアップ', () => {
  it('全配列と原値を含み、旧値・metadataを含まず、保存先を変えない', async () => {
    const f = fixture(); f.values.set(OLD_STORAGE_KEY, 'PRIVATE');
    const before = [...f.values]; const result = await f.prepare();
    expect(result.kind).toBe('prepared'); if (result.kind !== 'prepared') return;
    const source = JSON.parse(before[0]![1]);
    expect(JSON.parse(result.json)).toEqual({ format: 'myhomepage.memo.local-backup', backupVersion: 1,
      sourceStorageVersion: 3, exportedAt: NOW, data: { memos: source.memos, tags: source.tags, memoTags: source.memoTags, deletedMemoIds: [token(77)] } });
    expect(result.json).not.toContain('PRIVATE'); expect(result.json).not.toContain('migration');
    expect(result.json.charCodeAt(0)).not.toBe(0xfeff); expect(result.bytes).toBe(new TextEncoder().encode(result.json).length);
    expect(result.filename).toBe('memo-backup-2026-10-26T12-00-00-123Z.json');
    expect([...f.values]).toEqual(before); expect(f.locks).toEqual([LOCAL_DATA_LOCK_NAME]);
  });
  it('空v3でも履歴・未使用タグを落とさない', async () => {
    const v = { ...state(), version: 3, memos: [], memoTags: [], deletedMemoIds: [token(1)] };
    const r = await fixture(v).prepare(); expect(r.kind).toBe('prepared');
    if (r.kind === 'prepared') expect(JSON.parse(r.json).data).toEqual({ memos: [], memoTags: [], tags: v.tags, deletedMemoIds: v.deletedMemoIds });
  });
  it.each([state(), { version: 99 }, {}, null, { ...state(), version: 3, deletedMemoIds: [state().memos[0]!.id] }])('v2・未知・不正・衝突は拒否 %j', async value => {
    const f = fixture(value); const before = [...f.values]; expect((await f.prepare()).kind).toBe('failed'); expect([...f.values]).toEqual(before);
  });
  it('pendingを出力しない', async () => {
    const r = await fixture({ ...createPendingMigration('[]', () => token(2)), version: 3, deletedMemoIds: [] }).prepare();
    expect(r).toEqual({ kind: 'failed', reason: 'pending' });
  });
  it('completeの旧snapshot実値をファイルへ含めない', async () => {
    const pending = createPendingMigration('[]', () => token(2));
    const f = fixture({ ...pending, version: 3, migration: { ...pending.migration, status: 'complete' }, deletedMemoIds: [] });
    const result = await f.prepare(); expect(result.kind).toBe('prepared');
    if (result.kind === 'prepared') expect(JSON.parse(result.json).data).toEqual({ memos: [], tags: [], memoTags: [], deletedMemoIds: [] });
  });
  it('ロック待機後の最新値を取得し、返却後の入力変更から独立する', async () => {
    const f = fixture(); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const prepare = createLocalBackup({ ...f.deps, locks: { async request(_name, _options, fn) { await gate; return fn(); } } });
    const waiting = prepare();
    const latest = { ...state(), version: 3, deletedMemoIds: [token(88)] }; latest.memos[0]!.title = '最新';
    f.values.set(NEW_STORAGE_KEY, JSON.stringify(latest)); release();
    const result = await waiting; latest.memos[0]!.title = '後続変更';
    if (result.kind !== 'prepared') throw new Error('capture');
    expect(JSON.parse(result.json).data.memos[0].title).toBe('最新');
    expect(JSON.parse(result.json).data.deletedMemoIds).toEqual([token(88)]);
  });
  it('不存在・不正JSON・読取例外を空出力にしない', async () => {
    const f = fixture(); f.values.clear(); expect(await f.prepare()).toEqual({ kind: 'failed', reason: 'missing-data' });
    f.values.set(NEW_STORAGE_KEY, '{'); expect(await f.prepare()).toEqual({ kind: 'failed', reason: 'invalid-data' });
    expect(await createLocalBackup({ ...f.deps, storage: { getItem() { throw new Error('PRIVATE'); } } })()).toEqual({ kind: 'failed', reason: 'read-failure' });
  });
  it('ロック非対応は保存先を読む前に拒否、取得失敗も秘匿', async () => {
    const f = fixture(); expect(await createLocalBackup({ ...f.deps, locks: undefined })()).toEqual({ kind: 'failed', reason: 'locks-unavailable' }); expect(f.reads()).toBe(0);
    expect(await createLocalBackup({ ...f.deps, locks: { request: async () => { throw new Error('PRIVATE'); } } })()).toEqual({ kind: 'failed', reason: 'lock-failure' });
  });
  it.each([NEW_STORAGE_KEY, OLD_STORAGE_KEY])('取得中の%s変更を検出する', async key => {
    const f = fixture(); let n = 0;
    const prepare = createLocalBackup({ ...f.deps, storage: { getItem(k: string) {
      if (k === key && ++n === 2) return 'changed'; return f.deps.storage.getItem(k);
    } } }); expect(await prepare()).toEqual({ kind: 'failed', reason: 'snapshot-changed' });
  });
  it('時計異常は実値を出さずファイル生成失敗', async () => {
    const f = fixture(); expect(await createLocalBackup({ ...f.deps, now: () => 'PRIVATE' })()).toEqual({ kind: 'failed', reason: 'generation-failure' });
  });
  it('10 MiBの一致・1バイト超過とUnicodeバイト数を検証', async () => {
    // 本文の個別上限を守りながら全体サイズだけを境界へ調整する。
    const v = { version: 3, migration: { status: 'not-required' }, tags: [], memoTags: [], deletedMemoIds: [],
      memos: Array.from({ length: 1100 }, (_, i) => ({ ...state().memos[0]!, id: token(i + 1), body: 'a'.repeat(9000) })) };
    let r = await fixture(v).prepare(); if (r.kind !== 'prepared') throw new Error('fixture');
    let remaining = MAX_BACKUP_BYTES - r.bytes;
    for (const m of v.memos) { const n = Math.min(1000, remaining); m.body += 'a'.repeat(n); remaining -= n; }
    expect(remaining).toBe(0); r = await fixture(v).prepare(); expect(r.kind === 'prepared' && r.bytes).toBe(10_485_760);
    v.memos[0]!.title += 'a'; expect(await fixture(v).prepare()).toEqual({ kind: 'failed', reason: 'too-large' });
    v.memos[0]!.title = '😀'; expect((await fixture(v).prepare()).kind).toBe('prepared');
  });
});

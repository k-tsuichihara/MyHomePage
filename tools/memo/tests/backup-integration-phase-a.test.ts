import { describe, it, expect } from 'vitest';
import { MemoryStorage, QueueLocks } from './migration-fixtures';
import { token } from './local-save-fixtures';
import { createLocalMemoStore } from '../src/local-memo-store';
import { createLocalBackup } from '../src/local-backup';
import { createLocalRestoreController } from '../src/local-restore-controller';
import { createDeletedRecoveryController } from '../src/deleted-recovery-controller';
import { createInitialRestoreController } from '../src/initial-restore-controller';
import { validateLocalV3 } from '../src/local-format';
import type { RestoreV3 } from '../src/local-restore';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';

const T0 = '2026-11-01T00:00:00Z', T1 = '2026-11-01T01:00:00Z', T2 = '2026-11-01T02:00:00Z', T3 = '2026-11-01T03:00:00Z';
const M1 = token(10), M2 = token(11), TAG = token(30), UNUSED = token(31), HISTORY = token(900);
type FileData = Pick<RestoreV3, 'memos' | 'tags' | 'memoTags' | 'deletedMemoIds'>;
function empty(): RestoreV3 { return { version: 3, migration: { status: 'not-required' }, memos: [], tags: [], memoTags: [], deletedMemoIds: [HISTORY] }; }
function environment(initial: RestoreV3 | null = empty()) {
  const storage = new MemoryStorage(), locks = new QueueLocks();
  if (initial) storage.values.set(NEW_STORAGE_KEY, JSON.stringify(initial));
  let time = T0, sequence = 10000;
  const next = () => token(++sequence);
  const store = createLocalMemoStore({ storage, locks, now: () => time });
  return { storage, locks, store, next, at: (value: string) => { time = value; } };
}
type Env = ReturnType<typeof environment>;
async function load(f: Env): Promise<RestoreV3> {
  const r = await f.store.load(); expect(r.kind).toBe('loaded');
  if (r.kind !== 'loaded' || r.value.version !== 3) throw Error('Expected ready v3');
  expect(validateLocalV3(r.value).kind).not.toBe('validated-pending'); return r.value as RestoreV3;
}
async function output(f: Env) {
  const before = [...f.storage.values], writes = f.storage.writes.length;
  const r = await createLocalBackup({ storage: f.storage, locks: f.locks, now: () => T3 })();
  expect(r.kind).toBe('prepared'); if (r.kind !== 'prepared') throw Error('Expected output');
  expect(f.storage.writes).toHaveLength(writes); expect([...f.storage.values]).toEqual(before);
  const value = JSON.parse(r.json) as { data: FileData };
  expect(Object.keys(value.data)).toEqual(['memos', 'tags', 'memoTags', 'deletedMemoIds']);
  return { bytes: new TextEncoder().encode(r.json), json: r.json, data: value.data };
}
/** 初期値以外のメモ・タグは全て実ストア操作で作り、期待するrevisionを独立に列挙する。 */
async function populated() {
  const initial = empty(); initial.migration = { status: 'complete', legacySnapshot: '[]' };
  const f = environment(initial); f.storage.values.set(OLD_STORAGE_KEY, '[]');
  for (const [id, name] of [[TAG, 'Work'], [UNUSED, '未使用']] as const)
    expect((await f.store.saveTag({ id, name, expectedRevision: null, requestId: f.next() })).kind).toBe('written');
  for (const [id, title] of [[M1, '作成1'], [M2, '作成2']] as const)
    expect((await f.store.save({ id, title, body: ' 原本文\n', tagIds: [TAG], expectedRevision: null, requestId: f.next() })).kind).toBe('saved');
  f.at(T1);
  expect((await f.store.save({ id: M1, title: '編集済み', body: ' 更新本文\n', tagIds: [TAG], expectedRevision: 1, requestId: f.next() })).kind).toBe('saved');
  f.at(T2);
  expect((await f.store.changeState({ id: M1, action: 'pin', expectedRevision: 2, requestId: f.next() })).kind).toBe('written');
  expect((await f.store.changeState({ id: M2, action: 'pin', expectedRevision: 1, requestId: f.next() })).kind).toBe('written');
  expect((await f.store.changeState({ id: M2, action: 'trash', expectedRevision: 2, requestId: f.next() })).kind).toBe('written');
  return f;
}
async function additive(f: Env, bytes: Uint8Array) {
  const c = createLocalRestoreController({ store: f.store, createId: f.next });
  await c.dispatch({ kind: 'file', bytes }); await c.dispatch({ kind: 'select', indexes: [0, 1], selected: true });
  await c.dispatch({ kind: 'prepare' }); expect(c.getState().phase).toBe('confirmation'); return c;
}
async function recovery(f: Env, bytes: Uint8Array, index = 1) {
  const c = createDeletedRecoveryController({ store: f.store, createId: f.next, openCreated: async () => true });
  await c.dispatch({ kind: 'file', bytes }); await c.dispatch({ kind: 'select', index }); expect(c.getState().phase).toBe('preview'); return c;
}
async function initial(f: Env, bytes: Uint8Array) {
  const c = createInitialRestoreController({ store: f.store, createId: f.next, openNormal: async () => true });
  await c.dispatch({ kind: 'file', bytes }); await c.dispatch({ kind: 'prepare' }); expect(c.getState().phase).toBe('confirmation'); return c;
}
async function removeSource(f: Env) {
  expect(await f.store.deletePermanently({ id: M2, expectedRevision: 3, requestId: f.next() })).toMatchObject({ kind: 'deleted', count: 1 });
}

describe('Step 6 Phase A：実出力から復元までの横断契約', () => {
  it('A01 通常作成・タグ・編集・ピン・ゴミ箱から出力し、全属性と管理情報除外を確認', async () => {
    const f = await populated(), exported = await output(f);
    expect(exported.data.memos).toEqual([
      { id: M1, title: '編集済み', body: ' 更新本文\n', createdAt: T0, updatedAt: T2, revision: 3, lastRequestId: null, pinnedAt: T2, deletedAt: null },
      { id: M2, title: '作成2', body: ' 原本文\n', createdAt: T0, updatedAt: T2, revision: 3, lastRequestId: null, pinnedAt: T2, deletedAt: T2 },
    ]);
    expect(exported.data.tags).toEqual([{ id: TAG, name: 'Work', createdAt: T0, revision: 1 }, { id: UNUSED, name: '未使用', createdAt: T0, revision: 1 }]);
    // 通常更新は対象の関連を再構築する。作成順と混同せず、関係の集合と出力時点の順序を別々に確認する。
    expect(exported.data.memoTags).toHaveLength(2);
    expect(exported.data.memoTags).toEqual(expect.arrayContaining([{ memoId: M1, tagId: TAG }, { memoId: M2, tagId: TAG }]));
    expect(exported.data.memoTags).toEqual((await load(f)).memoTags);
    expect(exported.data.deletedMemoIds).toEqual([HISTORY]); expect(exported.json).not.toContain('migration'); expect(exported.json).not.toContain('legacySnapshot');
    expect(f.storage.values.get(OLD_STORAGE_KEY)).toBe('[]');
  });
  it('A02 実出力を既存v3へ追加し、方式固有の変換と通常更新・再出力を確認', async () => {
    const source = await populated(), file = await output(source), target = environment(); target.at(T3);
    const existingTag = token(50); await target.store.saveTag({ id: existingTag, name: 'WORK', expectedRevision: null, requestId: target.next() });
    await target.store.save({ id: token(12), title: '既存メモを保持', body: '既存本文', tagIds: [existingTag], expectedRevision: null, requestId: target.next() });
    const before = await load(target), c = await additive(target, file.bytes), writes = target.storage.writes.length;
    await c.dispatch({ kind: 'confirm' }); expect(c.getState().phase).toBe('applied'); expect(target.storage.writes).toHaveLength(writes + 1);
    const next = await load(target); expect(next.tags[0]).toEqual(before.tags[0]); expect(next.tags).toHaveLength(2);
    expect(next.memos.slice(0, before.memos.length)).toEqual(before.memos);
    expect(next.memoTags.slice(0, before.memoTags.length)).toEqual(before.memoTags);
    for (const [i, memo] of next.memos.slice(before.memos.length).entries()) {
      expect([M1, M2]).not.toContain(memo.id);
      expect(memo).toMatchObject({ title: file.data.memos[i]!.title, body: file.data.memos[i]!.body, createdAt: T3, updatedAt: T3, revision: 1, lastRequestId: null, pinnedAt: T3, deletedAt: i === 0 ? null : T2 });
    }
    expect(next.memoTags.map(link => link.tagId)).toEqual([existingTag, existingTag, existingTag]); expect(next.deletedMemoIds).toEqual(before.deletedMemoIds);
    const memo = next.memos[1]!; await target.store.save({ id: memo.id, title: '追加後編集', body: memo.body, tagIds: [existingTag], expectedRevision: 1, requestId: target.next() });
    const reexport = await output(target); expect(reexport.data.memos[1]).toMatchObject({ title: '追加後編集', revision: 2, lastRequestId: null }); expect(reexport.data.memos[2]).toEqual(next.memos[2]); expect(reexport.data.memos[0]).toEqual(before.memos[0]);
  });
  it('A03 出力後に実際に完全削除し、選択回復と通常更新・再出力で履歴を保護', async () => {
    const f = await populated(), file = await output(f); await removeSource(f);
    await f.store.saveTag({ id: TAG, name: '現在名', expectedRevision: 1, requestId: f.next() }); f.at(T3);
    const before = await load(f), c = await recovery(f, file.bytes); await c.dispatch({ kind: 'restore' });
    expect(c.getState().outcome).toBe('created'); const next = await load(f), added = next.memos.at(-1)!;
    expect(next.memos[0]).toEqual(before.memos[0]); expect(next.tags).toEqual(before.tags); expect(next.deletedMemoIds).toEqual([HISTORY, M2]);
    expect(added).toEqual({ ...file.data.memos[1], id: c.getState().newId, createdAt: T3, updatedAt: T3, revision: 1, lastRequestId: null, pinnedAt: null, deletedAt: null });
    expect(next.memoTags.at(-1)).toEqual({ memoId: added.id, tagId: TAG });
    await f.store.save({ id: added.id, title: '回復後編集', body: added.body, tagIds: [TAG], expectedRevision: 1, requestId: f.next() });
    const exported = await output(f); expect(exported.data.memos.at(-1)).toMatchObject({ revision: 2, title: '回復後編集' }); expect(exported.data.deletedMemoIds).toEqual([HISTORY, M2]);
    expect(await f.store.save({ id: M2, title: '再利用不可', body: '', tagIds: [], expectedRevision: null, requestId: f.next() })).toMatchObject({ reason: 'deleted-id' });
    expect(f.storage.values.get(OLD_STORAGE_KEY)).toBe('[]');
  });
  it('A04 実出力を別の空環境へ初期復元し、通常操作・再出力後も元IDと履歴を維持', async () => {
    const source = await populated(), file = await output(source), target = environment(null), c = await initial(target, file.bytes);
    await c.dispatch({ kind: 'confirm', generation: c.getState().generation }); expect(c.getState().result).toBe('written');
    expect((await output(target)).data).toEqual(file.data); expect((await load(target)).migration).toEqual({ status: 'not-required' });
    expect(target.storage.values.has(OLD_STORAGE_KEY)).toBe(false);
    target.at(T3); await target.store.changeState({ id: M2, action: 'restore', expectedRevision: 3, requestId: target.next() });
    await target.store.saveTag({ id: TAG, name: '初期復元後名', expectedRevision: 1, requestId: target.next() });
    await target.store.save({ id: M1, title: '初期復元後編集', body: file.data.memos[0]!.body, tagIds: [TAG], expectedRevision: 3, requestId: target.next() });
    const after = await output(target); expect(after.data.memos[0]).toMatchObject({ id: M1, revision: 4, lastRequestId: null, createdAt: T0, updatedAt: T3, pinnedAt: T2 });
    expect(after.data.memos[1]).toMatchObject({ id: M2, revision: 4, deletedAt: null, pinnedAt: T2 }); expect(after.data.tags[0]).toMatchObject({ id: TAG, name: '初期復元後名', revision: 2 });
    expect(after.data.deletedMemoIds).toEqual(file.data.deletedMemoIds); expect(after.data.memoTags).toEqual(file.data.memoTags);
    expect(source.storage.values.get(OLD_STORAGE_KEY)).toBe('[]'); expect((await output(source)).data).toEqual(file.data);
  });
  it('A05 初期復元後の追加型確認は単件回復後に競合拒否し、requestIdは全方式で共用', async () => {
    const source = await populated(), file = await output(source), f = environment(null), requests: string[] = [];
    const issue = () => { const id = f.next(); requests.push(id); return id; };
    const first = createInitialRestoreController({ store: f.store, createId: issue, openNormal: async () => true });
    await first.dispatch({ kind: 'file', bytes: file.bytes }); await first.dispatch({ kind: 'prepare' });
    await first.dispatch({ kind: 'confirm', generation: first.getState().generation }); await removeSource(f);
    const add = createLocalRestoreController({ store: f.store, createId: issue });
    await add.dispatch({ kind: 'file', bytes: file.bytes }); await add.dispatch({ kind: 'select', indexes: [0], selected: true }); await add.dispatch({ kind: 'prepare' });
    const recover = createDeletedRecoveryController({ store: f.store, createId: issue, openCreated: async () => true });
    await recover.dispatch({ kind: 'file', bytes: file.bytes }); await recover.dispatch({ kind: 'select', index: 1 }); await recover.dispatch({ kind: 'restore' });
    const before = [...f.storage.values], writes = f.storage.writes.length;
    await add.dispatch({ kind: 'confirm' }); expect(add.getState().phase).toBe('failed'); expect(recover.getState().outcome).toBe('created'); expect(first.getState().result).toBe('written');
    expect([...f.storage.values]).toEqual(before); expect(f.storage.writes).toHaveLength(writes);
    for (const requestId of [requests[0]!, requests.at(-2)!, requests.at(-1)!]) expect(await f.store.saveTag({ requestId })).toMatchObject({ reason: 'request-id-reused' });
    expect(f.storage.writes).toHaveLength(writes);
  });
  it('A06 実出力のJSON構文を壊した場合、全復元方式で既存値を変更しない', async () => {
    const source = await populated(), file = await output(source), broken = new TextEncoder().encode(file.json.slice(0, -1));
    await removeSource(source); const fresh = environment(null), before = [...source.storage.values], writes = source.storage.writes.length;
    const add = createLocalRestoreController({ store: source.store, createId: source.next });
    const recover = createDeletedRecoveryController({ store: source.store, createId: source.next });
    const init = createInitialRestoreController({ store: fresh.store, createId: fresh.next });
    await add.dispatch({ kind: 'file', bytes: broken }); await recover.dispatch({ kind: 'file', bytes: broken }); await init.dispatch({ kind: 'file', bytes: broken });
    expect(add.getState().phase).toBe('failed'); expect(recover.getState().phase).toBe('failed'); expect(init.getState().phase).toBe('blocked');
    expect([...source.storage.values]).toEqual(before); expect(source.storage.writes).toHaveLength(writes); expect(fresh.storage.writes).toHaveLength(0);
  });
  it.each(['quota', 'after-write', 'readback'] as const)('A07 実出力→各方式の%s：診断差と自動再書込なし', async fault => {
    const source = await populated(), file = await output(source);
    for (const mode of ['add', 'recover', 'initial'] as const) {
      const f = mode === 'initial' ? environment(null) : await populated();
      if (mode === 'recover') await removeSource(f);
      const c = mode === 'add' ? await additive(f, file.bytes) : mode === 'recover' ? await recovery(f, file.bytes) : await initial(f, file.bytes);
      const before = [...f.storage.values], writes = f.storage.writes.length;
      if (fault === 'quota') f.storage.beforeSet = () => { throw Error('Synthetic fault'); };
      if (fault === 'after-write') f.storage.afterSet = () => { throw Error('Synthetic fault'); };
      if (fault === 'readback') f.storage.beforeGet = () => { if (f.storage.writes.length > writes) throw Error('Synthetic fault'); };
      if (mode === 'initial') {
        const typed = c as ReturnType<typeof createInitialRestoreController>;
        await typed.dispatch({ kind: 'confirm', generation: typed.getState().generation }); expect(typed.getState().result).toBe('unknown');
      } else if (mode === 'recover') {
        const typed = c as ReturnType<typeof createDeletedRecoveryController>;
        await typed.dispatch({ kind: 'restore' }); expect(typed.getState().outcome).toBe(fault === 'after-write' ? 'created' : 'unknown');
      } else { const typed = c as ReturnType<typeof createLocalRestoreController>; await typed.dispatch({ kind: 'confirm' }); expect(typed.getState().phase).toBe('unknown'); }
      expect(f.storage.writes).toHaveLength(writes + (fault === 'quota' ? 0 : 1));
      if (fault === 'quota') expect([...f.storage.values]).toEqual(before);
      delete f.storage.beforeSet; delete f.storage.afterSet; delete f.storage.beforeGet;
      const attempts = f.storage.writes.length;
      if (mode === 'initial') {
        const typed = c as ReturnType<typeof createInitialRestoreController>; await typed.dispatch({ kind: 'inspect' });
        expect(typed.getState()).toMatchObject({ result: 'unknown', hadUnknown: true, observed: fault === 'quota' ? 'absent' : 'v3' });
      } else if (mode === 'add') { const typed = c as ReturnType<typeof createLocalRestoreController>; await typed.dispatch({ kind: 'inspect' }); expect(typed.getState().phase).toBe('unknown'); }
      else if (fault !== 'after-write') { const typed = c as ReturnType<typeof createDeletedRecoveryController>; await typed.dispatch({ kind: 'inspect' }); expect(typed.getState().outcome).toBe(fault === 'quota' ? 'unknown' : 'created'); }
      expect(f.storage.writes).toHaveLength(attempts);
      expect(f.storage.values.get(OLD_STORAGE_KEY)).toBe(mode === 'initial' ? undefined : '[]');
      if (fault !== 'quota') { const value = await load(f); expect(value.deletedMemoIds).toEqual(mode === 'initial' ? file.data.deletedMemoIds : mode === 'recover' ? [HISTORY, M2] : [HISTORY]); }
    }
  });
});

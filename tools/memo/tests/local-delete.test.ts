import { expect, it, vi } from 'vitest';
import { createLocalMemoController } from '../src/local-memo-controller';
import { createLocalMemoStore } from '../src/local-memo-store';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';
import { createPendingMigration } from '../src/migration';
import { oldRows } from './migration-fixtures';
import { MEMO, OTHER, TAG2, NOW, state, token, saveFixture, request } from './local-save-fixtures';

const NORMAL = token(300), HISTORY = 'abcdefac-0000-4000-8000-000000000001';
function data() {
  const base = state();
  return { ...base, version: 3 as const, deletedMemoIds: [HISTORY],
    memos: [...base.memos.map(row => ({ ...row, deletedAt: NOW })), { ...base.memos[1]!, id: NORMAL, title: '通常メモ', deletedAt: null }],
    memoTags: [...base.memoTags, { memoId: NORMAL, tagId: TAG2 }] };
}
const targets = () => [{ id: MEMO, revision: 3 }, { id: OTHER, revision: 1 }];
const one = (n = 1) => ({ id: MEMO, expectedRevision: 3, requestId: token(n) });
const all = (n = 1) => ({ targets: targets(), requestId: token(n) });
function fixture() {
  const f = saveFixture(data()); let next = 500;
  const controller = createLocalMemoController({ store: f.store, createId: () => token(++next) });
  return { ...f, c: controller, send: controller.dispatch, get: controller.getState };
}
const raw = (f: ReturnType<typeof fixture>) => f.storage.values.get(NEW_STORAGE_KEY)!;
function change(f: ReturnType<typeof fixture>, operation: (value: ReturnType<typeof data>) => void) {
  const value = JSON.parse(raw(f)) as ReturnType<typeof data>; operation(value); f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(value));
}
async function prepare(f: ReturnType<typeof fixture>, batch = false) {
  await f.send({ kind: 'load' });
  return f.send({ kind: 'mutate', operation: batch ? { kind: 'empty-trash', targets: targets() }
    : { kind: 'permanent-delete', id: MEMO, expectedRevision: 3 } });
}
async function confirm(f: ReturnType<typeof fixture>) {
  return f.send({ kind: 'confirm', token: f.get().confirmation!.token, accepted: true });
}

it('個別は原表記のIDを追加しメモ・関連・履歴を一回で保存、他データ不変', async () => {
  const f = fixture(), before = data();
  expect(await f.store.deletePermanently({ ...one(), id: MEMO.toUpperCase() })).toEqual({ kind: 'deleted', count: 1 });
  const after = JSON.parse(raw(f));
  expect(after.memos).toEqual(before.memos.filter(row => row.id !== MEMO));
  expect(after.memoTags).toEqual(before.memoTags.filter(row => row.memoId !== MEMO));
  expect(after.tags).toEqual(before.tags); expect(after.deletedMemoIds).toEqual([HISTORY, MEMO]);
  expect(f.storage.writes).toHaveLength(1);
  expect(await f.store.save({ ...request(2), expectedRevision: null })).toMatchObject({ kind: 'rejected', reason: 'deleted-id' });
});
it('一括は順序とUUID表記差を許し、ゴミ箱だけ全件を一回で削除', async () => {
  const f = fixture();
  expect(await f.store.emptyTrash({ ...all(), targets: targets().reverse().map(row => ({ ...row, id: row.id.toUpperCase() })) })).toEqual({ kind: 'deleted', count: 2 });
  const after = JSON.parse(raw(f));
  expect(after.memos).toEqual([data().memos[2]]); expect(after.memoTags).toEqual([{ memoId: NORMAL, tagId: TAG2 }]);
  expect(after.deletedMemoIds).toEqual([HISTORY, MEMO, OTHER]); expect(after.tags).toEqual(data().tags);
  expect(f.storage.writes).toHaveLength(1);
});
it('一括0件は最新状態を照合して未書込と明示する', async () => {
  const f = fixture(); change(f, value => { value.memos.forEach(row => { row.deletedAt = null; }); });
  const before = raw(f);
  expect(await f.store.emptyTrash({ targets: [], requestId: token(1) })).toEqual({ kind: 'not-needed', count: 0 });
  expect(raw(f)).toBe(before); expect(f.storage.writes).toHaveLength(0);
  expect((await f.store.emptyTrash({ targets: [], requestId: token(1) })).kind).toBe('rejected');
});
it.each(['v2', 'pending-v2', 'pending-v3', 'unknown', 'corrupt', 'orphan'] as const)('%sは個別・一括とも未書込', async mode => {
  for (const batch of [false, true]) {
    const f = fixture();
    if (mode === 'v2') f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(state()));
    if (mode.startsWith('pending')) {
      const legacy = JSON.stringify(oldRows()); f.storage.values.set(OLD_STORAGE_KEY, legacy); let n = 800;
      const pending = createPendingMigration(legacy, () => token(++n));
      f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(mode === 'pending-v3' ? { ...pending, version: 3, deletedMemoIds: [] } : pending));
    }
    if (mode === 'unknown') f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify({ ...data(), version: 9 }));
    if (mode === 'corrupt') f.storage.values.set(NEW_STORAGE_KEY, '{');
    if (mode === 'orphan') change(f, value => { value.memoTags[0]!.memoId = token(999); });
    const before = raw(f);
    const result = batch ? await f.store.emptyTrash(all()) : await f.store.deletePermanently(one());
    expect(result.kind).toBe('rejected'); expect(raw(f)).toBe(before); expect(f.storage.writes).toHaveLength(0);
  }
});
it.each(['normal', 'missing', 'revision', 'restored'] as const)('個別%sを拒否し対象を変更しない', async mode => {
  const f = fixture(); let input = one();
  if (mode === 'normal') input = { ...input, id: NORMAL, expectedRevision: 1 };
  if (mode === 'missing') input = { ...input, id: token(999) };
  if (mode === 'revision') input.expectedRevision = 2;
  if (mode === 'restored') change(f, value => { value.memos[0]!.deletedAt = null; });
  const before = raw(f);
  expect(await f.store.deletePermanently(input)).toMatchObject({ kind: 'rejected', reason: 'delete-conflict' });
  expect(raw(f)).toBe(before); expect(f.storage.writes).toHaveLength(0);
});
it.each(['added', 'removed', 'revision', 'restore', 'duplicate', 'missing'] as const)('一括%sで部分実行せず全体拒否', async mode => {
  const f = fixture(), input = all();
  if (mode === 'added') change(f, value => { value.memos[2]!.deletedAt = NOW; });
  if (mode === 'removed') change(f, value => { value.memos.shift(); value.memoTags = value.memoTags.filter(row => row.memoId !== MEMO); value.deletedMemoIds.push(MEMO); });
  if (mode === 'revision') change(f, value => { value.memos[0]!.revision++; });
  if (mode === 'restore') change(f, value => { value.memos[0]!.deletedAt = null; });
  if (mode === 'duplicate') input.targets[1] = { id: MEMO.toUpperCase(), revision: 3 };
  if (mode === 'missing') input.targets.pop();
  const before = raw(f);
  expect((await f.store.emptyTrash(input)).kind).toBe('rejected'); expect(raw(f)).toBe(before); expect(f.storage.writes).toHaveLength(0);
});
it('最大安全revisionでも加算せず削除できる', async () => {
  const f = fixture(); change(f, value => { value.memos[0]!.revision = Number.MAX_SAFE_INTEGER; });
  expect((await f.store.deletePermanently({ ...one(), expectedRevision: Number.MAX_SAFE_INTEGER })).kind).toBe('deleted');
});
it('受付後の入力変更とrequestId再利用を他操作でも拒否', async () => {
  const f = fixture(), input = all(); const pending = f.store.emptyTrash(input);
  input.targets.length = 0; expect((await pending).kind).toBe('deleted');
  expect(await f.store.save({ ...request(), expectedRevision: null })).toMatchObject({ reason: 'request-id-reused' });
});
it.each(['quota', 'after', 'readback', 'mismatch'] as const)('%sはunknown、自動再送・履歴削除なし', async mode => {
  const f = fixture(), before = raw(f);
  if (mode === 'quota') f.storage.beforeSet = () => { throw new Error('QuotaExceededError'); };
  if (mode === 'after') f.storage.afterSet = () => { throw new Error('after'); };
  if (mode === 'readback') f.storage.afterSet = () => { f.storage.beforeGet = () => { throw new Error('readback'); }; };
  if (mode === 'mismatch') f.storage.afterSet = () => { f.storage.values.set(NEW_STORAGE_KEY, before); };
  expect((await f.store.emptyTrash(all())).kind).toBe('unknown');
  delete f.storage.beforeSet; delete f.storage.afterSet; delete f.storage.beforeGet;
  expect((await f.store.emptyTrash(all())).kind).toBe('rejected');
  expect(f.storage.writes.length).toBe(mode === 'quota' ? 0 : 1);
  if (mode === 'quota') expect(raw(f)).toBe(before);
});
it('取消・確認後loadの失効・二重確認は書込を増やさない', async () => {
  const f = fixture(); await prepare(f); let ticket = f.get().confirmation!;
  await f.send({ kind: 'confirm', token: ticket.token, accepted: false }); expect(f.storage.writes).toHaveLength(0);
  await prepare(f); ticket = f.get().confirmation!; await f.send({ kind: 'load' });
  expect(await f.send({ kind: 'confirm', token: ticket.token, accepted: true })).toMatchObject({ reason: 'stale-confirmation' });
  await prepare(f); ticket = f.get().confirmation!; const pending = confirm(f);
  expect(await f.send({ kind: 'confirm', token: ticket.token, accepted: true })).toMatchObject({ reason: 'writing' });
  await pending; expect(f.storage.writes).toHaveLength(1); expect(f.get().write).toMatchObject({ kind: 'succeeded', deletedCount: 1 });
});
it('確認後の別タブ追加はロック内で全件拒否し、再確認対象を勝手に広げない', async () => {
  const f = fixture(); await prepare(f, true);
  change(f, value => { value.memos[2]!.deletedAt = NOW; }); const before = raw(f);
  await confirm(f); expect(f.get().write).toMatchObject({ kind: 'rejected', reason: 'trash-conflict' });
  expect(raw(f)).toBe(before); expect(f.storage.writes).toHaveLength(0);
});
it('unknown後はloadしても成功へ昇格せず、新確認だけで再実行', async () => {
  const f = fixture(); await prepare(f); f.storage.beforeSet = () => { throw new Error('quota'); };
  await confirm(f); expect(f.get().write.kind).toBe('unknown');
  expect((await f.send({ kind: 'mutate', operation: { kind: 'permanent-delete', id: MEMO, expectedRevision: 3 } })).kind).toBe('blocked');
  delete f.storage.beforeSet; await f.send({ kind: 'load' }); expect(f.get().write.kind).toBe('unknown');
  expect((await f.send({ kind: 'mutate', operation: { kind: 'permanent-delete', id: MEMO, expectedRevision: 3 } })).kind).toBe('confirmation-required');
  await confirm(f); expect(f.get().write).toMatchObject({ kind: 'succeeded', deletedCount: 1 });
  expect(f.get().unresolved).toHaveLength(1); expect(f.storage.writes).toHaveLength(1);
});
it('unknownで実際に消えた対象はload後も過去成功とせず再削除を拒否', async () => {
  const f = fixture(); await prepare(f); f.storage.afterSet = () => { throw new Error('after'); }; await confirm(f);
  delete f.storage.afterSet; await f.send({ kind: 'load' });
  expect(f.get().write.kind).toBe('unknown');
  await f.send({ kind: 'mutate', operation: { kind: 'permanent-delete', id: MEMO, expectedRevision: 3 } });
  await confirm(f); expect(f.storage.writes).toHaveLength(1); expect(f.get().write.kind).toBe('unknown');
});
it('削除後の詳細遷移と旧キー・legacySnapshotの保護', async () => {
  const f = fixture(), legacy = JSON.stringify(oldRows()); f.storage.values.set(OLD_STORAGE_KEY, legacy);
  change(f, value => { value.migration = { status: 'complete', legacySnapshot: legacy }; });
  await f.send({ kind: 'load' }); await f.send({ kind: 'detail', id: MEMO });
  await f.send({ kind: 'mutate', operation: { kind: 'permanent-delete', id: MEMO, expectedRevision: 3 } }); await confirm(f);
  expect(f.get().route.kind).toBe('list'); expect(f.storage.values.get(OLD_STORAGE_KEY)).toBe(legacy);
  expect(JSON.parse(raw(f)).migration).toEqual({ status: 'complete', legacySnapshot: legacy });
});
it('復元と削除の同時実行は一方だけ成功する', async () => {
  const f = fixture(), other = createLocalMemoStore(f.deps);
  const results = await Promise.all([other.changeState({ id: MEMO, action: 'restore', expectedRevision: 3, requestId: token(2) }), f.store.deletePermanently(one())]);
  expect(results.filter(row => row.kind === 'written' || row.kind === 'deleted')).toHaveLength(1);
  expect(results.filter(row => row.kind === 'rejected')).toHaveLength(1);
});
it.each(['absent', 'legacy-only', 'no-locks', 'read-failure'] as const)('%sでは一括0件指定でも書込しない', async mode => {
  const f = fixture();
  if (mode === 'absent' || mode === 'legacy-only') f.storage.values.delete(NEW_STORAGE_KEY);
  if (mode === 'legacy-only') f.storage.values.set(OLD_STORAGE_KEY, JSON.stringify(oldRows()));
  if (mode === 'read-failure') f.storage.beforeGet = () => { throw new Error('read'); };
  const store = mode === 'no-locks' ? createLocalMemoStore({ ...f.deps, locks: undefined }) : f.store;
  expect((await store.emptyTrash({ targets: [], requestId: token(1) })).kind).toBe('rejected');
  expect(f.storage.writes).toHaveLength(0);
});
it('ゴミ箱が残るのに空集合を渡して成功にしない', async () => {
  const f = fixture(), before = raw(f);
  expect(await f.store.emptyTrash({ targets: [], requestId: token(1) })).toMatchObject({ kind: 'rejected', reason: 'trash-conflict' });
  expect(raw(f)).toBe(before); expect(f.storage.writes).toHaveLength(0);
});
it('別ストアで再起動相当でも削除済みIDの新規作成は拒否', async () => {
  const f = fixture(); await f.store.deletePermanently(one());
  const restarted = createLocalMemoStore(f.deps);
  expect(await restarted.save({ ...request(9), id: MEMO.toUpperCase(), expectedRevision: null })).toMatchObject({ kind: 'rejected', reason: 'deleted-id' });
  expect(f.storage.writes).toHaveLength(1);
});
it('削除成功と後続の再読込失敗を独立して保持', async () => {
  const f = fixture();
  const store: typeof f.store = { ...f.store, async load() {
    return f.storage.writes.length ? { kind: 'unavailable', reason: 'storage-failure' } : f.store.load();
  } };
  const c = createLocalMemoController({ store, createId: () => token(10) });
  await c.dispatch({ kind: 'load' }); await c.dispatch({ kind: 'detail', id: MEMO });
  await c.dispatch({ kind: 'mutate', operation: { kind: 'permanent-delete', id: MEMO, expectedRevision: 3 } });
  await c.dispatch({ kind: 'confirm', token: c.getState().confirmation!.token, accepted: true });
  expect(c.getState().write).toMatchObject({ kind: 'succeeded', deletedCount: 1 });
  expect(c.getState().read.kind).toBe('failed'); expect(c.getState().route.kind).toBe('list');
  expect(f.storage.writes).toHaveLength(1);
});
it('保存先依存の差替えで確認済み削除を別保存領域へ流さない', async () => {
  const f = fixture(), other = fixture(); await prepare(f);
  f.deps.storage = other.storage; await confirm(f);
  expect(f.storage.writes).toHaveLength(1); expect(other.storage.writes).toHaveLength(0);
});
it.each([false, true])('確認なし・偽トークン・取消では低レベル削除ポートを呼ばない：一括=%s', async batch => {
  const f = fixture(), single = vi.spyOn(f.store, 'deletePermanently'), bulk = vi.spyOn(f.store, 'emptyTrash');
  const before = raw(f);
  expect(await f.send({ kind: 'confirm', token: 12345, accepted: true })).toMatchObject({ reason: 'stale-confirmation' });
  expect((await prepare(f, batch)).kind).toBe('confirmation-required');
  const ticket = f.get().confirmation!;
  expect(single).not.toHaveBeenCalled(); expect(bulk).not.toHaveBeenCalled();
  expect(await f.send({ kind: 'confirm', token: ticket.token + 1, accepted: true })).toMatchObject({ reason: 'stale-confirmation' });
  await f.send({ kind: 'confirm', token: ticket.token, accepted: false });
  expect(await f.send({ kind: 'confirm', token: ticket.token, accepted: true })).toMatchObject({ reason: 'stale-confirmation' });
  expect(single).not.toHaveBeenCalled(); expect(bulk).not.toHaveBeenCalled();
  expect(raw(f)).toBe(before); expect(f.storage.writes).toHaveLength(0);
});
it.each([false, true])('確認したID・revisionだけを一度渡し、外部入力の変更を反映しない：一括=%s', async batch => {
  const f = fixture(), single = vi.spyOn(f.store, 'deletePermanently'), bulk = vi.spyOn(f.store, 'emptyTrash');
  await f.send({ kind: 'load' });
  const operation = batch ? { kind: 'empty-trash' as const, targets: targets() }
    : { kind: 'permanent-delete' as const, id: MEMO, expectedRevision: 3 };
  await f.send({ kind: 'mutate', operation }); const ticket = f.get().confirmation!;
  if (operation.kind === 'empty-trash') operation.targets.splice(0, 2, { id: NORMAL, revision: 999 });
  else { operation.id = NORMAL; operation.expectedRevision = 999; }
  expect(ticket.command).toMatchObject({ kind: 'mutate', operation: batch ? { kind: 'empty-trash', targets: targets() }
    : { kind: 'permanent-delete', id: MEMO, expectedRevision: 3 } });
  expect(single).not.toHaveBeenCalled(); expect(bulk).not.toHaveBeenCalled();
  const pending = f.send({ kind: 'confirm', token: ticket.token, accepted: true });
  await f.send({ kind: 'confirm', token: ticket.token, accepted: true }); await pending;
  await f.send({ kind: 'confirm', token: ticket.token, accepted: true });
  if (batch) {
    expect(bulk).toHaveBeenCalledExactlyOnceWith({ targets: targets(), requestId: token(501) }); expect(single).not.toHaveBeenCalled();
  } else {
    expect(single).toHaveBeenCalledExactlyOnceWith({ id: MEMO, expectedRevision: 3, requestId: token(501) }); expect(bulk).not.toHaveBeenCalled();
  }
  expect(f.storage.writes).toHaveLength(1);
});
it('unknown後の再読込でも旧確認・旧集合を拡張せず、別の明示確認だけが新集合を送る', async () => {
  const f = fixture(), bulk = vi.spyOn(f.store, 'emptyTrash'); await prepare(f, true);
  const oldTicket = f.get().confirmation!;
  f.storage.beforeSet = () => { throw new Error('quota'); }; await confirm(f); delete f.storage.beforeSet;
  expect(f.get().write.kind).toBe('unknown'); expect(bulk).toHaveBeenCalledExactlyOnceWith({ targets: targets(), requestId: token(501) });
  change(f, value => { value.memos[2]!.deletedAt = NOW; }); await f.send({ kind: 'load' });
  expect(await f.send({ kind: 'confirm', token: oldTicket.token, accepted: true })).toMatchObject({ reason: 'stale-confirmation' });
  await f.send({ kind: 'mutate', operation: { kind: 'empty-trash', targets: targets() } });
  expect(await confirm(f)).toMatchObject({ reason: 'target-changed' });
  expect(bulk).toHaveBeenCalledTimes(1); expect(f.storage.writes).toHaveLength(0);
  const current = [...targets(), { id: NORMAL, revision: 1 }];
  await f.send({ kind: 'mutate', operation: { kind: 'empty-trash', targets: current } });
  const newTicket = f.get().confirmation!; expect(newTicket.token).not.toBe(oldTicket.token);
  expect(bulk).toHaveBeenCalledTimes(1); await confirm(f);
  expect(bulk).toHaveBeenNthCalledWith(2, { targets: current, requestId: token(502) });
  expect(f.get().unresolved[0]!.input).toEqual({ targets: targets(), requestId: token(501) });
  expect(f.storage.writes).toHaveLength(1);
});

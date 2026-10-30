import { expect, it } from 'vitest';
import { identifyLocalJson, parseLocalFormatJson, validateLocalV3 } from '../src/local-format';
import { parseLocalV2Json } from '../src/local-validation';
import { createLocalDataStore } from '../src/local-data-store';
import { createLocalMemoStore } from '../src/local-memo-store';
import { createLocalMemoController } from '../src/local-memo-controller';
import { inspectLocalMigration, migrateLocalData, recoverLocalMigration, NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';
import { createPendingMigration } from '../src/migration';
import { createControlledUpgrade } from './format/controlled-upgrade';
import { createLocalDataStore as createOldStore } from './format/old-v2-store';
import { MEMO, TAG, NOW, state, token, saveFixture, request } from './local-save-fixtures';
import { oldRows } from './migration-fixtures';

const DELETED = 'abcdefab-0000-4000-8000-000000000700';
const v3 = () => ({ ...state(), version: 3 as const, deletedMemoIds: [DELETED.toUpperCase()] });
function managed() {
  const f = saveFixture(); const env = {};
  const boundary = createControlledUpgrade(f.deps, env);
  boundary.issuer.producedV2(f.storage.values.get(NEW_STORAGE_KEY)!);
  return { ...f, env, ...boundary };
}
async function approve(f: ReturnType<typeof managed>) {
  const result = await f.port.inspect();
  if (result.kind !== 'approval-required') throw new Error('Expected approval');
  return result.approval;
}
it('v2／v3を区別し、v3を旧検証器へフォールバックしない', () => {
  expect(identifyLocalJson(JSON.stringify(state()))).toBe('v2');
  expect(identifyLocalJson(JSON.stringify(v3()))).toBe('v3');
  expect(() => parseLocalV2Json(JSON.stringify(v3()))).toThrow();
});
it.each(['extra', 'missing', 'duplicate', 'current', 'uuid', 'relation', 'migration', 'array'] as const)('v3 %sを補正せず拒否', kind => {
  const input: any = v3();
  if (kind === 'extra') input.extra = true;
  if (kind === 'missing') delete input.deletedMemoIds;
  if (kind === 'duplicate') input.deletedMemoIds = [DELETED, DELETED.toUpperCase()];
  if (kind === 'current') input.deletedMemoIds = [MEMO.toUpperCase()];
  if (kind === 'uuid') input.deletedMemoIds = ['old-non-uuid'];
  if (kind === 'relation') input.memoTags[0].memoId = token(999);
  if (kind === 'migration') input.migration = { status: 'complete', legacySnapshot: '{' };
  if (kind === 'array') input.deletedMemoIds = '[]';
  expect(() => validateLocalV3(input)).toThrow();
});
it.each(['{', JSON.stringify({ ...state(), deletedMemoIds: [] }), JSON.stringify({ ...v3(), version: 9 })])('異常形式を初期化しない', raw => {
  expect(['invalid', 'unknown-version']).toContain(identifyLocalJson(raw));
  expect(() => parseLocalFormatJson(raw)).toThrow();
});
it('検証成功値は入力の後続変更と独立し、UUID原表記を保持', () => {
  const input = v3(), value = validateLocalV3(input).value;
  input.deletedMemoIds.length = 0; input.memos[0]!.body = 'changed';
  expect(value.deletedMemoIds).toEqual([DELETED.toUpperCase()]); expect(value.memos[0]!.body).toBe(' 本文\n');
});
it('正しい許可でも診断だけは無変更、明示更新は全既存値を保持', async () => {
  const f = managed(); const old = state();
  const ticket = await approve(f); expect(f.storage.writes).toHaveLength(0);
  expect(await f.port.confirm(ticket)).toEqual({ kind: 'updated' });
  expect(JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!)).toEqual({ ...old, version: 3, deletedMemoIds: [] });
  expect(f.storage.writes).toHaveLength(1);
  expect((await f.port.confirm(ticket)).kind).toBe('rejected');
  expect((await f.port.inspect()).kind).toBe('v3');
});
it('未登録バックアップ相当は正常v2でも許可せず、同形オブジェクトも拒否', async () => {
  const f = saveFixture(), boundary = createControlledUpgrade(f.deps, {});
  expect((await boundary.port.inspect()).kind).toBe('untrusted-v2');
  expect((await boundary.port.confirm({ token: 1 })).kind).toBe('rejected');
  expect(f.storage.writes).toHaveLength(0);
});
it('別環境・同じ保存領域の別発行器・別保存領域へ許可を流用できない', async () => {
  const f = managed(), ticket = await approve(f), other = managed();
  for (const port of [other.port, createControlledUpgrade(f.deps, {}).port, createControlledUpgrade(other.deps, f.env).port]) {
    expect((await port.confirm(ticket)).kind).toBe('rejected');
  }
  expect(f.storage.writes).toHaveLength(0); expect(other.storage.writes).toHaveLength(0);
});
it.each(['cancel', 'inspect', 'changed', 'legacy'] as const)('許可後の%sで旧承認を使わない', async mode => {
  const f = managed(), ticket = await approve(f);
  if (mode === 'cancel') f.port.revoke(ticket);
  if (mode === 'inspect') await f.port.inspect();
  if (mode === 'changed') f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify({ ...state(), tags: [] , memoTags: [] }));
  if (mode === 'legacy') f.storage.values.set(OLD_STORAGE_KEY, '[]');
  expect((await f.port.confirm(ticket)).kind).toBe('rejected'); expect(f.storage.writes).toHaveLength(0);
});
it.each(['quota', 'after', 'readback'] as const)('%s後は結果不明、旧許可を戻さず再診断を要求', async mode => {
  const f = managed(), ticket = await approve(f);
  if (mode === 'quota') f.storage.beforeSet = () => { throw new Error('quota'); };
  if (mode === 'after') f.storage.afterSet = () => { throw new Error('after'); };
  if (mode === 'readback') f.storage.afterSet = () => { f.storage.beforeGet = () => { throw new Error('readback'); }; };
  expect((await f.port.confirm(ticket)).kind).toBe('unknown');
  delete f.storage.beforeSet; delete f.storage.afterSet; delete f.storage.beforeGet;
  expect((await f.port.confirm(ticket)).kind).toBe('rejected');
  const diagnostic = await f.port.inspect();
  if (mode === 'quota') {
    expect(diagnostic.kind).toBe('approval-required');
    if (diagnostic.kind === 'approval-required') expect((await f.port.confirm(diagnostic.approval)).kind).toBe('updated');
  } else expect(diagnostic.kind).toBe('v3');
});
it('二重確認・待機中の別操作をロックとスナップショットで停止', async () => {
  const f = managed(), ticket = await approve(f);
  let release!: () => void;
  const hold = f.locks.request('myhomepage.memo.data.v2.write', { mode: 'exclusive' }, () => new Promise<void>(yes => { release = yes; }));
  await Promise.resolve(); const write = f.port.confirm(ticket);
  expect((await f.port.confirm(ticket)).kind).toBe('rejected');
  f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify({ ...state(), memos: [], memoTags: [] }));
  release(); await hold; expect((await write).kind).toBe('rejected'); expect(f.storage.writes).toHaveLength(0);
});
it.each(['migrate', 'recover'] as const)('%sはv2完了後に別許可・別承認で更新しsnapshotを保持', async mode => {
  const f = saveFixture(null), raw = JSON.stringify(oldRows()); f.storage.values.set(OLD_STORAGE_KEY, raw);
  let sequence = 800; const deps = { ...f.deps, createId: () => token(++sequence) };
  const boundary = createControlledUpgrade(deps, {});
  if (mode === 'recover') {
    f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(createPendingMigration(raw, deps.createId)));
    expect((await boundary.port.inspect()).kind).toBe('recovery-required');
  }
  const pending = f.storage.values.get(NEW_STORAGE_KEY)!;
  const result = mode === 'migrate' ? await migrateLocalData(deps, raw) : await recoverLocalMigration(deps, raw, pending);
  expect(result.kind).toBe(mode === 'migrate' ? 'migrated' : 'recovered');
  expect((await boundary.port.inspect()).kind).toBe('untrusted-v2');
  boundary.issuer.producedV2(f.storage.values.get(NEW_STORAGE_KEY)!);
  const prepared = await boundary.port.inspect();
  if (prepared.kind !== 'approval-required') throw new Error('Expected approval');
  expect((await boundary.port.confirm(prepared.approval)).kind).toBe('updated');
  expect(f.storage.values.get(OLD_STORAGE_KEY)).toBe(raw);
  expect(parseLocalFormatJson(f.storage.values.get(NEW_STORAGE_KEY)!).value.migration).toEqual({ status: 'complete', legacySnapshot: raw });
});
it('v3 pendingへ旧復旧を適用せず、未書込で停止', async () => {
  const f = saveFixture(), legacy = JSON.stringify(oldRows()); f.storage.values.set(OLD_STORAGE_KEY, legacy);
  const raw = JSON.stringify({ ...createPendingMigration(legacy, (() => { let n = 900; return () => token(++n); })()), version: 3, deletedMemoIds: [] });
  f.storage.values.set(NEW_STORAGE_KEY, raw);
  expect((await createControlledUpgrade(f.deps, {}).port.inspect()).kind).toBe('v3-pending');
  expect((await recoverLocalMigration({ ...f.deps, createId: () => token(900) }, legacy, raw)).kind).toBe('stopped');
  expect(f.storage.writes).toHaveLength(0);
});
it('旧v2コードと旧移行診断はv3を上書きしない', async () => {
  const f = saveFixture(); const raw = JSON.stringify(v3()); f.storage.values.set(NEW_STORAGE_KEY, raw);
  const old = createOldStore(f.deps);
  expect((await old.load()).kind).toBe('unavailable');
  expect((await old.transact(value => ({ ...value, memos: [] }))).kind).toBe('rejected');
  expect((await inspectLocalMigration({ ...f.deps, createId: () => token(900) })).kind).toBe('stopped');
  expect(f.storage.values.get(NEW_STORAGE_KEY)).toBe(raw); expect(f.storage.writes).toHaveLength(0);
});
it.each(['save', 'create', 'pin', 'unpin', 'trash', 'restore', 'tag-save', 'tag-create', 'tag-delete'] as const)('%sは履歴と形式を保持', async action => {
  const f = saveFixture(); const input = v3();
  if (action === 'restore') input.memos[0]!.deletedAt = NOW;
  f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(input));
  const store = f.store;
  const result = action === 'save' ? await store.save(request())
    : action === 'create' ? await store.save({ ...request(), id: token(50), expectedRevision: null })
    : action === 'tag-create' ? await store.saveTag({ id: token(50), name: 'new-tag', expectedRevision: null, requestId: token(1) })
    : action === 'tag-save' ? await store.saveTag({ id: TAG, name: 'rename', expectedRevision: 1, requestId: token(1) })
    : action === 'tag-delete' ? await store.deleteTag({ id: TAG, expectedRevision: 1, requestId: token(1) })
    : await store.changeState({ id: MEMO, action, expectedRevision: 3, requestId: token(1) });
  expect(['saved', 'written']).toContain(result.kind);
  const after = JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!);
  expect(after.version).toBe(3); expect(after.deletedMemoIds).toEqual(input.deletedMemoIds);
});
it('新規作成と履歴消去変換を未書込拒否する', async () => {
  const f = saveFixture(); f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(v3()));
  expect(await f.store.save({ ...request(), id: DELETED.toLowerCase(), expectedRevision: null })).toMatchObject({ kind: 'rejected', reason: 'deleted-id' });
  const data = createLocalDataStore(f.deps);
  expect((await data.transact(value => value.version === 3 ? { ...value, deletedMemoIds: [] } : value)).kind).toBe('rejected');
  expect(f.storage.writes).toHaveLength(0);
});
it('v3通常controllerの読込・編集・保存と一覧条件で履歴を失わない', async () => {
  const f = saveFixture(); f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(v3()));
  let n = 100; const controller = createLocalMemoController({ store: f.store, createId: () => token(++n) });
  expect((await controller.dispatch({ kind: 'load' })).kind).toBe('done');
  await controller.dispatch({ kind: 'query', options: { text: '元', selectedTagIds: [TAG] }, scrollTop: 15 });
  await controller.dispatch({ kind: 'edit', id: MEMO });
  await controller.dispatch({ kind: 'draft', value: { title: '元v3編集', body: '', tagIds: [TAG] } });
  await controller.dispatch({ kind: 'save' });
  expect(controller.getState().write.kind).toBe('succeeded');
  expect(controller.getState().read.kind).toBe('ready');
  expect(JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!).deletedMemoIds).toEqual([DELETED.toUpperCase()]);
});
it('ロック非対応では更新許可があっても書込なし', async () => {
  const f = saveFixture(), boundary = createControlledUpgrade({ storage: f.storage, locks: undefined }, {});
  boundary.issuer.producedV2(f.storage.values.get(NEW_STORAGE_KEY)!);
  await expect(boundary.port.inspect()).rejects.toThrow(); expect(f.storage.writes).toHaveLength(0);
});
it('大量履歴を間引かず保持し、容量例外でも履歴を消して再送しない', async () => {
  const f = saveFixture(), input = { ...v3(), deletedMemoIds: Array.from({ length: 10000 }, (_, n) => token(n + 1000)) };
  const raw = JSON.stringify(input); f.storage.values.set(NEW_STORAGE_KEY, raw);
  expect((await f.store.load()).kind).toBe('loaded');
  f.storage.beforeSet = () => { throw new Error('Synthetic bounded quota'); };
  expect((await f.store.save(request())).kind).toBe('unknown');
  expect(f.storage.values.get(NEW_STORAGE_KEY)).toBe(raw); expect(f.storage.writes).toHaveLength(0);
});
it('許可発行後の依存オブジェクト差替えでも別保存領域へ書かない', async () => {
  const original = saveFixture(), other = saveFixture(), deps = { ...original.deps };
  const boundary = createControlledUpgrade(deps, {});
  boundary.issuer.producedV2(original.storage.values.get(NEW_STORAGE_KEY)!);
  const diagnostic = await boundary.port.inspect();
  if (diagnostic.kind !== 'approval-required') throw new Error('Expected approval');
  deps.storage = other.storage;
  expect((await boundary.port.confirm(diagnostic.approval)).kind).toBe('updated');
  expect(original.storage.writes).toHaveLength(1); expect(other.storage.writes).toHaveLength(0);
  expect(JSON.parse(other.storage.values.get(NEW_STORAGE_KEY)!).version).toBe(2);
});

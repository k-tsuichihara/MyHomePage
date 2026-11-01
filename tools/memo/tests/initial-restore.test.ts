import { describe, it, expect } from 'vitest';
import { parseInitialBackup, validateInitialCandidate } from '../src/initial-restore';
import { createInitialRestoreController } from '../src/initial-restore-controller';
import { createLocalMemoStore } from '../src/local-memo-store';
import { createLocalDataStore } from '../src/local-data-store';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';
import { state, token, NOW, saveFixture } from './local-save-fixtures';
import { createPendingMigration } from '../src/migration';

function data() { return { ...state(), version: 3 as const, deletedMemoIds: [token(90), token(91)] }; }
function envelope() {
  const d = data(); return { format: 'myhomepage.memo.local-backup', backupVersion: 1, sourceStorageVersion: 3, exportedAt: NOW,
    data: { memos: d.memos, tags: d.tags, memoTags: d.memoTags, deletedMemoIds: d.deletedMemoIds } };
}
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const input = () => encode(envelope());
function controllerFixture() {
  const f = saveFixture(null); let n = 1000;
  const controller = createInitialRestoreController({ store: f.store, createId: () => token(++n), openNormal: async () => true });
  const prepare = async () => { await controller.dispatch({ kind: 'file', bytes: input() }); await controller.dispatch({ kind: 'prepare' }); };
  const confirm = () => controller.dispatch({ kind: 'confirm', generation: controller.getState().generation });
  return { ...f, controller, prepare, confirm };
}

describe('初期復元の全件厳格検証', () => {
  it('全属性・原順序・原表記を保持し、管理情報だけnot-requiredにする', () => {
    const source = envelope(); source.data.memos[0]!.deletedAt = NOW;
    source.data.tags[0]!.id = source.data.tags[0]!.id.toUpperCase();
    const before = JSON.stringify(source), bytes = encode(source), checked = parseInitialBackup(bytes);
    expect(checked.candidate).toEqual({ version: 3, migration: { status: 'not-required' }, ...source.data });
    expect(JSON.stringify(source)).toBe(before); bytes.fill(0); expect(checked.candidate.memos[0]!.title).toBe(source.data.memos[0]!.title);
    expect(() => { checked.candidate.deletedMemoIds.push(token(92)); }).toThrow();
  });
  it.each(['bad-memo', 'bad-tag', 'duplicate-memo', 'duplicate-name', 'duplicate-link', 'missing-link', 'history-collision', 'duplicate-history', 'unknown-field'])('不正%sは全体拒否', mode => {
    const e = envelope();
    if (mode === 'bad-memo') e.data.memos[0]!.title = '';
    if (mode === 'bad-tag') e.data.tags[0]!.name = '';
    if (mode === 'duplicate-memo') e.data.memos.push({ ...e.data.memos[0]! });
    if (mode === 'duplicate-name') e.data.tags[1]!.name = e.data.tags[0]!.name.toUpperCase();
    if (mode === 'duplicate-link') e.data.memoTags.push({ ...e.data.memoTags[0]! });
    if (mode === 'missing-link') e.data.memoTags[0]!.tagId = token(999);
    if (mode === 'history-collision') e.data.deletedMemoIds.push(e.data.memos[0]!.id.toUpperCase());
    if (mode === 'duplicate-history') e.data.deletedMemoIds.push(e.data.deletedMemoIds[0]!);
    if (mode === 'unknown-field') Object.assign(e.data.tags[0]!, { color: 'red' });
    expect(() => parseInitialBackup(encode(e))).toThrow();
  });
  it.each([['memos', 10001], ['tags', 5001], ['memoTags', 100001], ['deletedMemoIds', 100001]] as const)('件数%s超過を停止', (key, count) => {
    const e = envelope(); Object.assign(e.data, { [key]: Array(count).fill(null) }); expect(() => parseInitialBackup(encode(e))).toThrow('count');
  });
  it.each(['format', 'backupVersion', 'sourceStorageVersion'])('未知識別%sを拒否', key => {
    const e = envelope(); Object.assign(e, { [key]: 'unknown' }); expect(() => parseInitialBackup(encode(e))).toThrow('format');
  });
  it('空の正常バックアップも全件復元可能', () => {
    const e = envelope(); e.data = { memos: [], tags: [], memoTags: [], deletedMemoIds: [] };
    expect(parseInitialBackup(encode(e)).candidate).toEqual({ version: 3, migration: { status: 'not-required' }, ...e.data });
  });
  it('入力上限・BOM・不正UTF8・重複キー・深度超過を共用走査で拒否', () => {
    for (const bytes of [new Uint8Array(10_485_761), new Uint8Array([239,187,191,123,125]), new Uint8Array([0xc0,0xaf]),
      new TextEncoder().encode('{"a":1,"a":2}'), new TextEncoder().encode('['.repeat(33) + '0' + ']'.repeat(33))]) expect(() => parseInitialBackup(bytes)).toThrow();
  });
  it('候補16 MiB超過・pending/complete管理情報を拒否', () => {
    const d = data(); d.memos = Array.from({ length: 1700 }, (_, i) => ({ ...d.memos[0]!, id: token(2000 + i), body: 'x'.repeat(10000) })); d.memoTags = [];
    expect(() => validateInitialCandidate(d)).toThrow('candidate-size');
    for (const status of ['pending', 'complete']) expect(() => validateInitialCandidate({ ...data(), migration: { status, legacySnapshot: '[]' } })).toThrow('migration');
  });
});

describe('不在時専用の保存入口', () => {
  it('確認前0書込、全件単一書込、共有requestIdと一回限り候補', async () => {
    const f = saveFixture(null), plan = await f.store.prepareInitial(input()); expect(f.storage.writes).toHaveLength(0);
    expect(await f.store.applyInitial({ token: plan.token, requestId: token(1) })).toMatchObject({ kind: 'written' });
    expect(f.storage.writes).toHaveLength(1); expect(JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!)).toEqual(data());
    expect(f.storage.values.has(OLD_STORAGE_KEY)).toBe(false);
    expect(await f.store.applyInitial({ token: plan.token, requestId: token(2) })).toMatchObject({ kind: 'rejected' });
    expect(await f.store.saveTag({ requestId: token(1) })).toMatchObject({ reason: 'request-id-reused' });
    expect(f.storage.writes).toHaveLength(1);
  });
  it.each([['old', '[]'], ['old', ''], ['new', '{'], ['new', JSON.stringify(state())], ['new', JSON.stringify(data())],
    ['new', JSON.stringify({ ...data(), memos: [], tags: [], memoTags: [] })], ['new', JSON.stringify(createPendingMigration('[]', () => token(3)))], ['new', '{"version":99}']])('存在する%s値は無書込拒否', async (key, raw) => {
    const f = saveFixture(null); f.storage.values.set(key === 'old' ? OLD_STORAGE_KEY : NEW_STORAGE_KEY, raw);
    await expect(f.store.prepareInitial(input())).rejects.toThrow(); expect(f.storage.writes).toHaveLength(0);
    expect(f.storage.values.get(key === 'old' ? OLD_STORAGE_KEY : NEW_STORAGE_KEY)).toBe(raw);
  });
  it.each([OLD_STORAGE_KEY, NEW_STORAGE_KEY])('確認後の%s出現は上書きしない', async key => {
    const f = saveFixture(null), plan = await f.store.prepareInitial(input()); f.storage.values.set(key, 'external');
    expect(await f.store.applyInitial({ token: plan.token, requestId: token(1) })).toMatchObject({ kind: 'rejected', writeOutcome: 'not-attempted' });
    expect(f.storage.values.get(key)).toBe('external'); expect(f.storage.writes).toHaveLength(0);
  });
  it('書込直前の新キー出現を検出する', async () => {
    const f = saveFixture(null), plan = await f.store.prepareInitial(input()); let reads = 0;
    f.storage.beforeGet = () => { if (++reads === 3) f.storage.values.set(NEW_STORAGE_KEY, 'external'); };
    expect(await f.store.applyInitial({ token: plan.token, requestId: token(1) })).toMatchObject({ kind: 'rejected' }); expect(f.storage.writes).toHaveLength(0);
  });
  it.each(['quota', 'after-write', 'mismatch', 'readback', 'legacy'])('書込試行後%sはunknown、再書込なし', async mode => {
    const f = saveFixture(null), plan = await f.store.prepareInitial(input());
    if (mode === 'quota') f.storage.beforeSet = () => { throw Error('PRIVATE'); };
    if (mode === 'after-write') f.storage.afterSet = () => { throw Error('PRIVATE'); };
    if (mode === 'mismatch') f.storage.afterSet = () => { f.storage.values.set(NEW_STORAGE_KEY, '{}'); };
    if (mode === 'legacy') f.storage.afterSet = () => { f.storage.values.set(OLD_STORAGE_KEY, 'external'); };
    if (mode === 'readback') f.storage.beforeGet = () => { if (f.storage.writes.length) throw Error('PRIVATE'); };
    const result = await f.store.applyInitial({ token: plan.token, requestId: token(1) }); expect(result).toMatchObject({ kind: 'unknown', writeOutcome: 'unverified' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE'); expect(f.storage.writes).toHaveLength(mode === 'quota' ? 0 : 1);
  });
  it('共有ロックの別ストア初期復元は一方だけ保存', async () => {
    const f = saveFixture(null), second = createLocalMemoStore(f.deps);
    const a = await f.store.prepareInitial(input()), b = await second.prepareInitial(input());
    const results = await Promise.all([f.store.applyInitial({ token: a.token, requestId: token(1) }), second.applyInitial({ token: b.token, requestId: token(2) })]);
    expect(results.map(r => r.kind)).toEqual(['written', 'rejected']); expect(f.storage.writes).toHaveLength(1);
  });
  it('保存領域の依存差替えでは別領域に書かず、候補失効で拒否', async () => {
    const f = saveFixture(null), other = saveFixture(null), plan = await f.store.prepareInitial(input());
    f.deps.storage = other.storage;
    expect((await f.store.applyInitial({ token: plan.token, requestId: token(1) })).kind).toBe('written'); expect(other.storage.writes).toHaveLength(0);
    const g = saveFixture(null), pending = g.store.prepareInitial(input()); g.store.invalidateInitial(); await expect(pending).rejects.toThrow();
  });
  it('読取例外・ロック非対応は不在認定せず、通常transactは依然v3初期化を拒否', async () => {
    const f = saveFixture(null); f.storage.beforeGet = () => { throw Error('PRIVATE'); };
    expect(await f.store.inspectInitial()).toMatchObject({ kind: 'unavailable' });
    expect(await createLocalDataStore({ storage: f.storage, locks: undefined }).inspectInitial()).toMatchObject({ kind: 'unavailable', reason: 'locks-unavailable' });
    delete f.storage.beforeGet; expect(await createLocalDataStore(f.deps).transact(() => data())).toMatchObject({ kind: 'rejected' }); expect(f.storage.writes).toHaveLength(0);
  });
});

describe('初期復元controllerの安全性', () => {
  it('確認中の依存差替えは別保存領域への書込を起こさない', async () => {
    const f = saveFixture(null), other = saveFixture(null), deps = { store: f.store, createId: () => token(100) };
    const c = createInitialRestoreController(deps);
    await c.dispatch({ kind: 'file', bytes: input() }); await c.dispatch({ kind: 'prepare' }); deps.store = other.store;
    await c.dispatch({ kind: 'confirm', generation: c.getState().generation });
    expect(f.storage.writes).toHaveLength(1); expect(other.storage.writes).toHaveLength(0);
  });
  it('結果不明後の破損・旧キー出現・読取不能は手動診断でも再操作を許可しない', async () => {
    for (const fault of ['invalid', 'legacy', 'unreadable']) {
      const f = controllerFixture(); await f.prepare(); f.storage.beforeSet = () => { throw Error(); }; await f.confirm();
      if (fault === 'invalid') f.storage.values.set(NEW_STORAGE_KEY, '{');
      if (fault === 'legacy') f.storage.values.set(OLD_STORAGE_KEY, '[]');
      if (fault === 'unreadable') f.storage.beforeGet = () => { throw Error(); };
      await f.controller.dispatch({ kind: 'inspect' }); await f.controller.dispatch({ kind: 'prepare' });
      expect(f.controller.getState()).toMatchObject({ phase: 'unknown', hadUnknown: true }); expect(f.storage.writes).toHaveLength(0);
    }
  });
  it('取消・離脱・ファイル差替え・古い世代は書込0件', async () => {
    const f = controllerFixture(); await f.prepare(); const generation = f.controller.getState().generation;
    await f.controller.dispatch({ kind: 'cancel' }); await f.controller.dispatch({ kind: 'confirm', generation });
    await f.prepare(); await f.controller.dispatch({ kind: 'confirm', generation });
    await f.controller.dispatch({ kind: 'leave' }); await f.confirm(); expect(f.storage.writes).toHaveLength(0);
  });
  it('二重確認を抑止し、保存成功と通常画面失敗を分離する', async () => {
    const f = saveFixture(null); let n = 1;
    const c = createInitialRestoreController({ store: f.store, createId: () => token(n++), openNormal: async () => { throw Error(); } });
    await c.dispatch({ kind: 'file', bytes: input() }); await c.dispatch({ kind: 'prepare' }); const generation = c.getState().generation;
    await Promise.all([c.dispatch({ kind: 'confirm', generation }), c.dispatch({ kind: 'confirm', generation })]);
    expect(c.getState()).toMatchObject({ phase: 'success', result: 'written', navigation: 'failed' }); expect(f.storage.writes).toHaveLength(1);
  });
  it.each(['absent', 'v3'])('unknown後の明示診断%sを過去結果の確定に使わない', async observed => {
    const f = controllerFixture(); await f.prepare();
    let diagnoses = 0; const original = f.store.inspectInitial; f.store.inspectInitial = async () => { diagnoses++; return original(); };
    if (observed === 'absent') f.storage.beforeSet = () => { throw Error(); }; else f.storage.afterSet = () => { throw Error(); };
    await f.confirm(); expect(diagnoses).toBe(0); expect(f.controller.getState()).toMatchObject({ phase: 'unknown', hadUnknown: true });
    await f.controller.dispatch({ kind: 'prepare' }); expect(f.controller.getState().phase).toBe('unknown');
    await f.controller.dispatch({ kind: 'inspect' }); expect(diagnoses).toBe(1);
    expect(f.controller.getState()).toMatchObject({ observed, hadUnknown: true, result: 'unknown' });
    const writes = f.storage.writes.length;
    await f.controller.dispatch({ kind: 'prepare' });
    expect(f.controller.getState().phase).toBe(observed === 'absent' ? 'confirmation' : 'unknown'); expect(f.storage.writes).toHaveLength(writes);
    await f.controller.dispatch({ kind: 'leave' }); await f.controller.dispatch({ kind: 'file', bytes: input() });
    expect(f.controller.getState().hadUnknown).toBe(true);
  });
  it('過去unknownは後続拒否でも保持し、新しいrequestIdだけで再操作する', async () => {
    const f = controllerFixture(); await f.prepare(); f.storage.beforeSet = () => { throw Error(); }; await f.confirm();
    delete f.storage.beforeSet; await f.controller.dispatch({ kind: 'inspect' }); await f.controller.dispatch({ kind: 'prepare' });
    f.storage.values.set(OLD_STORAGE_KEY, '[]'); await f.confirm();
    expect(f.controller.getState()).toMatchObject({ result: 'rejected', hadUnknown: true }); expect(f.storage.writes).toHaveLength(0);
  });
});

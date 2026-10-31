import { describe, it, expect } from 'vitest';
import { recoverMemo, recoverableTags, canRecover } from '../src/deleted-recovery';
import { createDeletedRecoveryController } from '../src/deleted-recovery-controller';
import { diagnoseBackup } from '../src/local-restore';
import type { RestoreV3 } from '../src/local-restore';
import { createLocalMemoStore } from '../src/local-memo-store';
import { state, saveFixture, token, NOW, TAG, TAG2 } from './local-save-fixtures';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';
import { createPendingMigration } from '../src/migration';

const source = () => state().memos[0]!;
function current(): RestoreV3 {
  const original = state();
  return { ...original, version: 3, memos: original.memos.slice(1), memoTags: original.memoTags.slice(1),
    migration: { status: 'complete', legacySnapshot: '[]' }, deletedMemoIds: [source().id.toUpperCase()] };
}
const bytes = () => new TextEncoder().encode(JSON.stringify({ format: 'myhomepage.memo.local-backup', backupVersion: 1,
  sourceStorageVersion: 3, exportedAt: NOW, data: { memos: [source()], tags: state().tags, memoTags: [{ memoId: source().id, tagId: TAG }], deletedMemoIds: [] } }));
const input = (n = 100) => ({ source: source(), sourceTags: [TAG], expectedTags: [TAG], id: token(n), requestId: token(n + 1) });
function fixture() { const f = saveFixture(current()); f.storage.values.set(OLD_STORAGE_KEY, '[]'); return f; }
function controllerFixture(options: { store?: ReturnType<typeof createLocalMemoStore>; openCreated?: (id: string) => Promise<boolean>; canStart?: () => boolean } = {}) {
  const f = fixture(); let sequence = 500;
  const controller = createDeletedRecoveryController({ store: options.store ?? f.store, createId: () => token(++sequence), ...options });
  const preview = async () => { await controller.dispatch({ kind: 'file', bytes: bytes() }); await controller.dispatch({ kind: 'select', index: 0 }); };
  return { ...f, controller, preview };
}

describe('単件回復の純粋変換', () => {
  it('正常行と現在履歴の対象判定を分離する', () => {
    const row = diagnoseBackup(bytes()).rows[0]!;
    expect(canRecover(row, current())).toBe(true);
    expect(canRecover(row, { ...current(), deletedMemoIds: [] })).toBe(false);
    expect(canRecover({ ...row, memo: null }, current())).toBe(false);
  });
  it('新しい通常・非ピンメモと現在ID関連だけ追加し、全既存値・原本を保持', () => {
    const c = current(), s = source(), before = JSON.stringify(c), original = JSON.stringify(s);
    c.tags[0]!.name = '現在名称'; const actualBefore = JSON.stringify(c);
    const next = recoverMemo(c, s, [TAG.toUpperCase(), token(99)], [TAG], token(100), NOW);
    expect(next.memos.at(-1)).toEqual({ ...s, id: token(100), createdAt: NOW, updatedAt: NOW, pinnedAt: null, deletedAt: null, revision: 1, lastRequestId: null });
    expect(next.memos.slice(0, -1)).toEqual(c.memos); expect(next.tags).toEqual(c.tags);
    expect(next.memoTags.slice(0, -1)).toEqual(c.memoTags); expect(next.memoTags.at(-1)).toEqual({ memoId: token(100), tagId: TAG });
    expect(next.deletedMemoIds).toEqual(c.deletedMemoIds); expect(next.migration).toEqual(c.migration);
    expect(JSON.stringify(c)).toBe(actualBefore); expect(JSON.stringify(s)).toBe(original); expect(before).not.toBe(actualBefore);
  });
  it('同名異IDは付け替えず、不在タグは新規作成しない', () => {
    const c = current(); c.tags = [{ ...c.tags[0]!, id: token(88) }]; c.memoTags = [];
    expect(recoverableTags([TAG], c)).toEqual([]);
    const next = recoverMemo(c, source(), [TAG], [], token(100), NOW);
    expect(next.tags).toEqual(c.tags); expect(next.memoTags).toEqual([]);
  });
  it.each(['id-exists', 'deleted-id', 'invalid-tag', 'not-found'])('拒否 %s', reason => {
    const c = current();
    if (reason === 'not-found') c.deletedMemoIds = [];
    const id = reason === 'id-exists' ? c.memos[0]!.id.toUpperCase() : reason === 'deleted-id' ? source().id : token(100);
    expect(() => recoverMemo(c, source(), [TAG], reason === 'invalid-tag' ? [] : [TAG], id, NOW)).toThrow(reason);
  });
  it('16 MiB超過は切り詰めず拒否', () => {
    const c = current(); c.memoTags = [];
    c.memos = Array.from({ length: 1700 }, (_, i) => ({ ...c.memos[0]!, id: token(2000 + i), body: 'x'.repeat(10000) }));
    expect(() => recoverMemo(c, source(), [TAG], [TAG], token(100), NOW)).toThrow('invalid-input');
  });
});

describe('共通ストアと単件回復', () => {
  it('単一書込・共有requestId予約・旧キーと履歴とmetadata不変', async () => {
    const f = fixture(), before = current();
    expect(await f.store.recoverDeleted(input())).toMatchObject({ kind: 'saved', value: { memo: { revision: 1, lastRequestId: null } } });
    expect(f.storage.writes).toHaveLength(1); const next = JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!);
    expect(next.deletedMemoIds).toEqual(before.deletedMemoIds); expect(next.migration).toEqual(before.migration); expect(f.storage.values.get(OLD_STORAGE_KEY)).toBe('[]');
    expect(await f.store.save({ requestId: input().requestId })).toMatchObject({ kind: 'rejected', reason: 'request-id-reused' });
    expect(f.storage.writes).toHaveLength(1);
  });
  it('書込前の入力拒否でもrequestIdを戻さない', async () => {
    const f = fixture(); expect(await f.store.recoverDeleted({ ...input(), source: {} })).toMatchObject({ kind: 'rejected' });
    expect(await f.store.recoverDeleted(input())).toMatchObject({ reason: 'request-id-reused' }); expect(f.storage.writes).toHaveLength(0);
  });
  it.each(['delete-tag', 'add-tag'])('プレビュー後の集合変化%sは無書込拒否', async mode => {
    const f = fixture(), c = current();
    if (mode === 'delete-tag') { c.tags = c.tags.filter(t => t.id !== TAG); c.memoTags = []; }
    f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(c));
    expect(await f.store.recoverDeleted({ ...input(), expectedTags: mode === 'delete-tag' ? [TAG] : [] })).toMatchObject({ reason: 'invalid-tag', writeOutcome: 'not-attempted' });
    expect(f.storage.writes).toHaveLength(0);
  });
  it('名前変更・無関係タグ変更・他メモ変更を許容し現在値を保持', async () => {
    const f = fixture(), c = current(); c.tags[0]!.name = '改名'; c.tags[1]!.revision++; c.memos[0]!.body = '別タブ編集';
    f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(c));
    expect((await f.store.recoverDeleted(input())).kind).toBe('saved');
    const next = JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!); expect(next.tags).toEqual(c.tags); expect(next.memos[0]).toEqual(c.memos[0]);
  });
  it.each(['quota', 'after-write', 'readback'])('試行後%sはunknown・再送なし', async mode => {
    const f = fixture();
    if (mode === 'quota') f.storage.beforeSet = () => { throw Error('private'); };
    if (mode === 'after-write') f.storage.afterSet = () => { throw Error('private'); };
    if (mode === 'readback') f.storage.beforeGet = () => { if (f.storage.writes.length) throw Error('private'); };
    expect(await f.store.recoverDeleted(input())).toMatchObject({ kind: 'unknown', writeOutcome: 'unverified' });
    expect(f.storage.writes).toHaveLength(mode === 'quota' ? 0 : 1);
  });
  it.each([state(), createPendingMigration('[]', () => token(10)), { version: 99 }, null])('非正常v3は書込前停止 %j', async data => {
    const f = fixture(); data === null ? f.storage.values.delete(NEW_STORAGE_KEY) : f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(data));
    expect(await f.store.recoverDeleted(input())).toMatchObject({ kind: 'rejected', writeOutcome: 'not-attempted' }); expect(f.storage.writes).toHaveLength(0);
  });
  it('別ストアが同新UUIDへ同時回復した場合、ロック内で後続を拒否', async () => {
    const f = fixture(), second = createLocalMemoStore(f.deps);
    const results = await Promise.all([f.store.recoverDeleted(input()), second.recoverDeleted({ ...input(), requestId: token(300) })]);
    expect(results.map(r => r.kind)).toEqual(['saved', 'rejected']); expect(f.storage.writes).toHaveLength(1);
  });
});

describe('単件回復の状態・結果再診断', () => {
  it('未選択・プレビュー・戻るは0書込、通常編集中は開始不可', async () => {
    const f = controllerFixture(); await f.controller.dispatch({ kind: 'restore' }); await f.preview();
    expect(f.controller.getState().phase).toBe('preview'); expect(f.storage.writes).toHaveLength(0);
    await f.controller.dispatch({ kind: 'back' }); expect(f.controller.getState().selected).toBeNull();
    expect(f.storage.writes).toHaveLength(0);
    const blocked = controllerFixture({ canStart: () => false }); await blocked.preview(); expect(blocked.controller.getState().phase).toBe('idle');
  });
  it('連打でも一書込、成功後の遷移失敗は作成確認を保持', async () => {
    const f = controllerFixture({ openCreated: async () => { throw Error('private'); } }); await f.preview();
    await Promise.all([f.controller.dispatch({ kind: 'restore' }), f.controller.dispatch({ kind: 'restore' })]);
    expect(f.controller.getState()).toMatchObject({ phase: 'created', outcome: 'created', navigation: 'failed' }); expect(f.storage.writes).toHaveLength(1);
  });
  it('タグ集合変化は未保存確定・最新プレビューを表示し、次の明示操作だけ保存', async () => {
    const f = controllerFixture(); await f.preview(); const c = current(); c.tags = c.tags.filter(t => t.id !== TAG); c.memoTags = [];
    f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(c)); await f.controller.dispatch({ kind: 'restore' });
    expect(f.controller.getState()).toMatchObject({ phase: 'preview', outcome: 'not-saved', tagIds: [] }); expect(f.storage.writes).toHaveLength(0);
    await f.controller.dispatch({ kind: 'restore' }); expect(f.storage.writes).toHaveLength(1);
  });
  it('書込後例外は即時一回の診断で現在UUIDの作成確認、再書込なし', async () => {
    const f = controllerFixture(); await f.preview(); let loads = 0;
    const original = f.store.load; f.store.load = async () => { loads++; return original(); };
    f.storage.afterSet = () => { throw Error('private'); };
    await f.controller.dispatch({ kind: 'restore' }); expect(loads).toBe(1);
    expect(f.controller.getState().outcome).toBe('created'); expect(f.storage.writes).toHaveLength(1);
  });
  it('後続の正常な別タブ編集を初回内容と比較せず作成確認', async () => {
    const f = controllerFixture(); await f.preview(); f.storage.afterSet = () => {
      const c = JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!); const m = c.memos.at(-1); m.title = '後続編集'; m.revision = 9; m.updatedAt = '2026-10-30T00:00:00Z';
      f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(c)); throw Error('private');
    };
    await f.controller.dispatch({ kind: 'restore' }); expect(f.controller.getState().outcome).toBe('created'); expect(f.storage.writes).toHaveLength(1);
  });
  it.each(['absent', 'broken', 'read-failure'])('結果不明%s・任意回数の読取診断、成功や未保存へ誤昇格しない', async mode => {
    const f = controllerFixture(); await f.preview();
    f.storage.beforeSet = () => { throw Error('private'); };
    if (mode === 'broken') f.storage.afterSet = () => {};
    await f.controller.dispatch({ kind: 'restore' }); expect(f.controller.getState().outcome).toBe('unknown');
    if (mode === 'broken') f.storage.values.set(NEW_STORAGE_KEY, '{');
    if (mode === 'read-failure') f.storage.beforeGet = () => { throw Error('private'); };
    await f.controller.dispatch({ kind: 'inspect' }); await f.controller.dispatch({ kind: 'inspect' });
    expect(f.controller.getState().outcome).toBe('unknown'); expect(f.storage.writes).toHaveLength(0);
    if (mode === 'broken') expect(f.controller.getState().message).toContain('整合性');
    if (mode === 'read-failure') expect(f.controller.getState().message).toContain('読取');
  });
  it('結果不明からの明示再復元は新UUID・新要求、破損保存先では再書込不可', async () => {
    const f = controllerFixture(); await f.preview(); f.storage.beforeSet = () => { throw Error('private'); };
    await f.controller.dispatch({ kind: 'restore' }); const id = f.controller.getState().newId;
    delete f.storage.beforeSet; await f.controller.dispatch({ kind: 'retry' });
    expect(f.controller.getState().outcome).toBe('created'); expect(f.controller.getState().newId).not.toBe(id); expect(f.controller.getState().unresolvedIds).toContain(id);
    const other = controllerFixture(); await other.preview(); other.storage.beforeSet = () => { throw Error(); };
    await other.controller.dispatch({ kind: 'restore' }); other.storage.values.set(NEW_STORAGE_KEY, '{');
    await other.controller.dispatch({ kind: 'retry' }); expect(other.storage.writes).toHaveLength(0); expect(other.controller.getState().outcome).toBe('unknown');
  });
  it('遅延書込中と診断中は戻る・差替え・連打を受け付けず、一回だけ診断する', async () => {
    const f = fixture(); let releaseWrite!: () => void, releaseRead!: () => void;
    const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
    const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
    let loads = 0, writes = 0;
    const store = { ...f.store, load: async () => { loads++; if (loads > 1) await readGate; return f.store.load(); },
      recoverDeleted: async (raw: unknown) => { writes++; await writeGate; return f.store.recoverDeleted(raw); } };
    let n = 500; const c = createDeletedRecoveryController({ store, createId: () => token(++n) });
    await c.dispatch({ kind: 'file', bytes: bytes() }); await c.dispatch({ kind: 'select', index: 0 });
    f.storage.beforeSet = () => { throw Error(); };
    const operation = c.dispatch({ kind: 'restore' });
    await Promise.all([c.dispatch({ kind: 'restore' }), c.dispatch({ kind: 'back' }), c.dispatch({ kind: 'file', bytes: bytes() })]);
    expect(c.getState().phase).toBe('writing'); expect(writes).toBe(1);
    releaseWrite();
    // 条件成立をマイクロタスク単位で待ち、時間待ちによる順序の推測をしない。
    for (let i = 0; i < 30 && c.getState().phase !== 'diagnosing'; i++) await Promise.resolve();
    expect(c.getState().phase).toBe('diagnosing');
    await Promise.all([c.dispatch({ kind: 'inspect' }), c.dispatch({ kind: 'retry' }), c.dispatch({ kind: 'back' })]);
    expect(loads).toBe(2); expect(writes).toBe(1); releaseRead(); await operation;
    expect(c.getState().outcome).toBe('unknown'); expect(f.storage.writes).toHaveLength(0);
  });
  it('診断UUIDの別ID同内容では成功認定せず、壊れた現在データも成功にしない', async () => {
    const f = controllerFixture(); await f.preview(); f.storage.beforeSet = () => { throw Error(); };
    await f.controller.dispatch({ kind: 'restore' }); const next = current();
    next.memos.push({ ...source(), id: token(999), pinnedAt: null, deletedAt: null });
    f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(next)); await f.controller.dispatch({ kind: 'inspect' });
    expect(f.controller.getState().outcome).toBe('unknown');
    next.memos[1]!.id = f.controller.getState().newId!; next.memoTags.push({ memoId: token(777), tagId: TAG2 });
    f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(next)); await f.controller.dispatch({ kind: 'inspect' });
    expect(f.controller.getState().outcome).toBe('unknown'); expect(f.controller.getState().message).toContain('整合性');
  });
});

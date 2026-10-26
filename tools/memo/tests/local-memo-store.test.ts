import { describe, expect, it } from 'vitest';
import { createLocalMemoStore } from '../src/local-memo-store';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';
import { completeMigration, createPendingMigration } from '../src/migration';
import { LOCAL_DATA_LOCK_NAME } from '../src/local-lock';
import { saveFixture, state, request, MEMO, OTHER, TAG, TAG2, PREVIOUS, NOW, BEFORE, token } from './local-save-fixtures';

describe('メモ作成・更新と関連の単一JSON保存', () => {
  it('初回の明示保存だけnot-requiredを含む新メモを書き込む', async () => {
    const f = saveFixture(null), input = { ...request(), expectedRevision: null, title: ' ', body: '本文', tagIds: [] };
    const result = await f.store.save(input);
    expect(result).toEqual({ kind: 'saved', value: { memo: { id: MEMO, title: '無題', body: '本文', createdAt: NOW, updatedAt: NOW,
      pinnedAt: null, deletedAt: null, revision: 1, lastRequestId: null }, tagIds: [] } });
    expect(f.storage.writes).toHaveLength(1);
    expect(JSON.parse(f.storage.writes[0]![1]).migration).toEqual({ status: 'not-required' });
    expect(f.storage.values.has(OLD_STORAGE_KEY)).toBe(false);
  });
  it('更新は対象メモとその関連だけを変更しlastRequestIdを保持する', async () => {
    const f = saveFixture(); f.storage.values.set(OLD_STORAGE_KEY, '変更しない旧値');
    const result = await f.store.save(request());
    expect(result).toEqual({ kind: 'saved', value: { memo: { ...state().memos[0], title: '新タイトル', body: ' \t新本文\n ', updatedAt: NOW, revision: 4 }, tagIds: [TAG2] } });
    const stored = JSON.parse(f.storage.writes[0]![1]);
    expect(stored.memos[1]).toEqual(state().memos[1]); expect(stored.tags).toEqual(state().tags);
    expect(stored.memoTags).toEqual([{ memoId: OTHER, tagId: TAG }, { memoId: MEMO, tagId: TAG2 }]);
    expect(stored.memos[0].lastRequestId).toBe(PREVIOUS); expect(stored.memos[0].createdAt).toBe(BEFORE);
    expect(f.storage.values.get(OLD_STORAGE_KEY)).toBe('変更しない旧値');
    expect(f.locks.calls).toEqual([{ name: LOCAL_DATA_LOCK_NAME, mode: 'exclusive' }]);
  });
  it('UUIDの大小文字は同値で、元のメモ・タグ表記を保持する', async () => {
    const f = saveFixture();
    expect(await f.store.save({ ...request(), id: MEMO.toUpperCase(), tagIds: [TAG2.toUpperCase(), TAG.toUpperCase()] })).toMatchObject({ kind: 'saved', value: { memo: { id: MEMO }, tagIds: [TAG, TAG2] } });
  });
  it('completeのlegacySnapshotは通常保存で変更しない', async () => {
    const f = saveFixture({ ...state(), migration: completeMigration(createPendingMigration('[]', () => MEMO)).migration });
    expect((await f.store.save(request())).kind).toBe('saved');
    expect(JSON.parse(f.storage.writes[0]![1]).migration).toEqual({ status: 'complete', legacySnapshot: '[]' });
  });
  it('同じ内容でも通常更新はrevisionを一度増やし、nullのlastRequestIdも維持する', async () => {
    const f = saveFixture();
    expect(await f.store.save({ ...request(), id: OTHER, expectedRevision: 1, title: '対象外', body: '', tagIds: [TAG] })).toMatchObject({ kind: 'saved', value: { memo: { revision: 2, lastRequestId: null } } });
  });
  it.each(['create-existing', 'not-found', 'trashed', 'conflict', 'limit', 'missing-tag'])('保存前に拒否し全体を保持: %s', async mode => {
    const initial = state(), input = request();
    const reasons = { 'create-existing': 'id-exists', 'not-found': 'not-found', trashed: 'trashed', conflict: 'conflict', limit: 'revision-limit', 'missing-tag': 'invalid-tag' };
    if (mode === 'create-existing') input.expectedRevision = null;
    if (mode === 'not-found') input.id = token(99);
    if (mode === 'trashed') initial.memos[0]!.deletedAt = BEFORE;
    if (mode === 'conflict') input.expectedRevision = 2;
    if (mode === 'limit') initial.memos[0]!.revision = input.expectedRevision = Number.MAX_SAFE_INTEGER;
    if (mode === 'missing-tag') input.tagIds = [token(99)];
    const f = saveFixture(initial), before = f.storage.values.get(NEW_STORAGE_KEY);
    expect(await f.store.save(input)).toEqual({ kind: 'rejected', reason: reasons[mode as keyof typeof reasons], writeOutcome: 'not-attempted' });
    expect(f.storage.values.get(NEW_STORAGE_KEY)).toBe(before); expect(f.storage.writes).toEqual([]);
  });
  it('revision上限の直前までは更新できる', async () => {
    const initial = state(); initial.memos[0]!.revision = Number.MAX_SAFE_INTEGER - 1;
    const f = saveFixture(initial);
    expect(await f.store.save({ ...request(), expectedRevision: Number.MAX_SAFE_INTEGER - 1 })).toMatchObject({ kind: 'saved', value: { memo: { revision: Number.MAX_SAFE_INTEGER } } });
  });
  it('保存済みlastRequestIdと同じIDでも成功照合や再利用判定に使わない', async () => {
    const initial = state(); initial.memos[0]!.lastRequestId = token(1);
    const f = saveFixture(initial);
    expect(await f.store.save(request())).toMatchObject({ kind: 'saved', value: { memo: { revision: 4, lastRequestId: token(1) } } });
  });
  it.each([
    { title: '😀'.repeat(100), body: '😀'.repeat(10000), accepted: true },
    { title: '😀'.repeat(101), body: '', accepted: false },
    { title: '有効', body: '😀'.repeat(10001), accepted: false },
    { title: 'x\u2028y', body: '', accepted: false },
    { title: '有効', body: '\r\n', accepted: false },
    { title: '有効', body: '\ud800', accepted: false },
  ])('入力契約の境界・禁止文字を保存入口でも適用する %#', async ({ title, body, accepted }) => {
    const f = saveFixture(), result = await f.store.save({ ...request(), title, body });
    expect(result.kind).toBe(accepted ? 'saved' : 'rejected');
    expect(f.storage.writes).toHaveLength(accepted ? 1 : 0);
  });
});

describe('入力固定と同時保存', () => {
  it('ロック待機中の呼出側編集を保存要求へ混入させない', async () => {
    const f = saveFixture(); let release!: () => void;
    const first = f.locks.request(LOCAL_DATA_LOCK_NAME, { mode: 'exclusive' }, () => new Promise<void>(resolve => { release = resolve; }));
    await Promise.resolve(); const input = request(), result = f.store.save(input);
    input.title = '後続の編集'; input.tagIds[0] = TAG; input.expectedRevision = 100;
    release(); await first;
    expect(await result).toMatchObject({ kind: 'saved', value: { memo: { title: '新タイトル' }, tagIds: [TAG2] } });
  });
  it('同revisionの別インスタンスからの更新は片方だけ成功する', async () => {
    const f = saveFixture(), other = createLocalMemoStore(f.deps);
    const result = await Promise.all([f.store.save(request()), other.save(request(2))]);
    expect(result.map(row => row.kind)).toEqual(['saved', 'rejected']); expect(result[1]).toMatchObject({ reason: 'conflict' });
    expect(f.storage.writes).toHaveLength(1);
  });
  it('ロック待機中の別メモ更新を再読込して保持する', async () => {
    const f = saveFixture();
    const result = await Promise.all([f.store.save({ ...request(), id: OTHER, expectedRevision: 1 }), f.store.save(request(2))]);
    expect(result.map(row => row.kind)).toEqual(['saved', 'saved']);
    expect(JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!).memos.map((row: { revision: number }) => row.revision)).toEqual([4, 2]);
  });
});

describe('requestIdは受付で使用済みとし履歴は保存しない', () => {
  it.each(['same', 'changed', 'upper'])('成功後の%s再利用を拒否する', async mode => {
    const f = saveFixture(), input = request(); expect((await f.store.save(input)).kind).toBe('saved');
    const again = { ...input, expectedRevision: 4 };
    if (mode === 'changed') again.body = '別内容';
    if (mode === 'upper') { input.requestId = 'abcdef00-0000-4000-8000-000000000099'; const g = saveFixture(); await g.store.save(input); expect(await g.store.save({ ...input, requestId: input.requestId.toUpperCase() })).toMatchObject({ reason: 'request-id-reused' }); return; }
    expect(await f.store.save(again)).toMatchObject({ kind: 'rejected', reason: 'request-id-reused' }); expect(f.storage.writes).toHaveLength(1);
  });
  it.each(['title', 'missing', 'extra', 'tag', 'revision', 'id'])('入力の%s不正でも形式有効なrequestIdを消費する', async field => {
    const f = saveFixture(), input: Record<string, unknown> = { ...request() };
    if (field === 'title') { input.title = ''; input.body = ''; }
    if (field === 'missing') delete input.body;
    if (field === 'extra') input.extra = true;
    if (field === 'tag') input.tagIds = [TAG, TAG.toUpperCase()];
    if (field === 'revision') input.expectedRevision = '3';
    if (field === 'id') input.id = 'invalid';
    expect((await f.store.save(input)).kind).toBe('rejected');
    expect(await f.store.save(request())).toMatchObject({ reason: 'request-id-reused' }); expect(f.storage.writes).toEqual([]);
    expect((await f.store.save(request(2))).kind).toBe('saved');
  });
  it('形式不正なrequestIdは書込せず拒否し、有効な別IDでは保存できる', async () => {
    const f = saveFixture();
    expect(await f.store.save({ ...request(), requestId: 'bad' })).toMatchObject({ reason: 'invalid-input' });
    expect((await f.store.save(request())).kind).toBe('saved');
  });
  it('アクセサを実行せず拒否し、予約済みIDは戻さない', async () => {
    const f = saveFixture(); let accessed = false;
    const input = { ...request(), get title() { accessed = true; throw new Error('PRIVATE'); } };
    expect(await f.store.save(input)).toMatchObject({ kind: 'rejected', reason: 'invalid-input' });
    expect(accessed).toBe(false); expect(f.storage.writes).toEqual([]);
    expect(await f.store.save(request())).toMatchObject({ reason: 'request-id-reused' });
  });
  it('進行中の同IDも、ロックを二重取得せず拒否する', async () => {
    const f = saveFixture(), first = f.store.save(request()), second = f.store.save(request());
    expect(await second).toMatchObject({ reason: 'request-id-reused' }); await first; expect(f.locks.calls).toHaveLength(1);
  });
  it('競合・ロック非対応・結果不明でもIDを再利用できない', async () => {
    for (const mode of ['conflict', 'locks', 'unknown']) {
      const f = saveFixture();
      const store = mode === 'locks' ? createLocalMemoStore({ ...f.deps, locks: undefined }) : f.store;
      if (mode === 'unknown') f.storage.afterSet = () => { throw new Error('中断'); };
      const input = mode === 'conflict' ? { ...request(), expectedRevision: 1 } : request();
      expect((await store.save(input)).kind).toBe(mode === 'unknown' ? 'unknown' : 'rejected');
      expect(await store.save(request())).toMatchObject({ reason: 'request-id-reused' });
    }
  });
  it('別インスタンスをまたぐ再利用は検出しないがrevision照合は行う', async () => {
    const f = saveFixture(); await f.store.save(request());
    expect(await createLocalMemoStore(f.deps).save(request())).toMatchObject({ reason: 'conflict' });
    expect((await createLocalMemoStore(f.deps).save({ ...request(), expectedRevision: 4 })).kind).toBe('saved');
    const stored = JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!);
    expect(Object.keys(stored).sort()).toEqual(['memoTags', 'memos', 'migration', 'tags', 'version']);
    expect(stored.memos[0].lastRequestId).toBe(PREVIOUS);
  });
});

describe('異常時は保存成功と断定しない', () => {
  it.each(['legacy', 'pending', 'broken'])('%s状態は保存を拒否し自動修復しない', async mode => {
    const f = saveFixture(null);
    if (mode === 'legacy') f.storage.values.set(OLD_STORAGE_KEY, '[]');
    if (mode === 'pending') f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(createPendingMigration('[]', () => MEMO)));
    if (mode === 'broken') f.storage.values.set(NEW_STORAGE_KEY, '{}');
    expect((await f.store.save(request())).kind).toBe('rejected'); expect(f.storage.writes).toEqual([]);
  });
  it('書込後例外はunknownで、再読込しても履歴成功という結果を返さない', async () => {
    const f = saveFixture(); f.storage.afterSet = () => { throw new Error('PRIVATE'); };
    expect(await f.store.save(request())).toMatchObject({ kind: 'unknown', writeOutcome: 'unverified' });
    delete f.storage.afterSet;
    expect(await f.store.load()).toMatchObject({ kind: 'loaded', value: { memos: [{ revision: 4 }, {}] } });
    expect(await f.store.save({ ...request(), expectedRevision: 4 })).toMatchObject({ reason: 'request-id-reused' });
    expect(f.storage.writes).toHaveLength(1);
  });
  it('読戻し不一致で保存を再試行せず、入力内容をエラーに含めない', async () => {
    const f = saveFixture(); f.storage.afterSet = () => { f.storage.values.set(NEW_STORAGE_KEY, '{}'); };
    const input = { ...request(), title: 'PRIVATE-TITLE', body: 'PRIVATE-BODY' };
    const result = await f.store.save(input);
    expect(result).toMatchObject({ kind: 'unknown' }); expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(f.storage.writes).toHaveLength(1);
  });
  it('不正時計や時計例外は未書込で拒否し実値を含めない', async () => {
    for (const now of [() => 'PRIVATE', () => { throw new Error('PRIVATE'); }]) {
      const f = saveFixture(), result = await createLocalMemoStore({ ...f.deps, now }).save(request());
      expect(result.kind).toBe('rejected'); expect(JSON.stringify(result)).not.toContain('PRIVATE'); expect(f.storage.writes).toEqual([]);
    }
  });
});

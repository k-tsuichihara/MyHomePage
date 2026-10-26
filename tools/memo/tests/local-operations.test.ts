import { describe, expect, it } from 'vitest';
import { createLocalMemoStore } from '../src/local-memo-store';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';
import { createPendingMigration } from '../src/migration';
import { countTagUsage } from '../src/tag-usage';
import { state, saveFixture, request, token, MEMO, OTHER, TAG, TAG2, PREVIOUS, BEFORE, NOW } from './local-save-fixtures';

const stateRequest = (action = 'pin', n = 1) => ({ id: MEMO, action, expectedRevision: 3, requestId: token(n) });
const tagRequest = (n = 1) => ({ id: TAG, name: '名前変更', expectedRevision: 1 as number | null, requestId: token(n) });
const deleteRequest = (n = 1) => ({ id: TAG, expectedRevision: 1, requestId: token(n) });

describe('ピン・ゴミ箱状態の変更', () => {
  it.each(['pin', 'unpin', 'trash', 'restore'])('%sで正式SQLと同じフィールドを変更しlastRequestIdを保持する', async action => {
    const initial = state(); if (action === 'restore') initial.memos[0]!.deletedAt = BEFORE;
    const before = structuredClone(initial), f = saveFixture(initial);
    const result = await f.store.changeState(stateRequest(action));
    expect(result.kind).toBe('written');
    const after = JSON.parse(f.storage.writes[0]![1]);
    expect(after).toEqual({ ...before, memos: [{ ...before.memos[0], updatedAt: NOW, revision: 4,
      pinnedAt: action === 'pin' ? NOW : action === 'unpin' ? null : BEFORE,
      deletedAt: action === 'trash' ? NOW : null }, before.memos[1]] });
    expect(after.memos[0].lastRequestId).toBe(PREVIOUS); expect(f.storage.writes).toHaveLength(1);
  });
  it('pin済みのtrash→restoreでも元のpinnedAtと全関連を維持し、件数は減少・復帰する', async () => {
    const initial = state(), f = saveFixture(initial);
    expect(countTagUsage({ memos: initial.memos, tags: initial.tags, memoTags: initial.memoTags })[0]!.count).toBe(2);
    const trashed = await f.store.changeState(stateRequest('trash'));
    if (trashed.kind !== 'written') throw new Error('移動成功');
    expect(countTagUsage({ memos: trashed.value.memos, tags: trashed.value.tags, memoTags: trashed.value.memoTags })[0]!.count).toBe(1);
    const restored = await f.store.changeState({ ...stateRequest('restore', 2), expectedRevision: 4 });
    if (restored.kind !== 'written') throw new Error('復元成功');
    expect(restored.value.memos[0]!.pinnedAt).toBe(BEFORE);
    expect(restored.value.memoTags).toEqual(initial.memoTags);
    expect(countTagUsage({ memos: restored.value.memos, tags: restored.value.tags, memoTags: restored.value.memoTags })[0]!.count).toBe(2);
  });
  it.each(['pin', 'unpin', 'trash'])('ゴミ箱内で%sを拒否する', async action => {
    const initial = state(); initial.memos[0]!.deletedAt = BEFORE;
    const f = saveFixture(initial);
    expect(await f.store.changeState(stateRequest(action))).toMatchObject({ kind: 'rejected', reason: 'invalid-state' });
    expect(f.storage.writes).toEqual([]);
  });
  it.each(['restore', 'invalid', 'not-found', 'conflict', 'limit'])('不適合な状態操作を未書込拒否: %s', async mode => {
    const initial = state(), input = stateRequest();
    let reason = 'invalid-input';
    if (mode === 'restore') { input.action = 'restore'; reason = 'invalid-state'; }
    if (mode === 'invalid') input.action = 'permanent-delete';
    if (mode === 'not-found') { input.id = token(88); reason = 'not-found'; }
    if (mode === 'conflict') { input.expectedRevision = 2; reason = 'conflict'; }
    if (mode === 'limit') { input.expectedRevision = initial.memos[0]!.revision = Number.MAX_SAFE_INTEGER; reason = 'revision-limit'; }
    const f = saveFixture(initial);
    expect(await f.store.changeState(input)).toMatchObject({ kind: 'rejected', reason }); expect(f.storage.writes).toEqual([]);
  });
  it('未ピンのunpinやpin済みへのpinでもSQL同様revisionを増やす', async () => {
    const initial = state(); initial.memos[0]!.pinnedAt = null;
    const f = saveFixture(initial);
    expect(await f.store.changeState(stateRequest('unpin'))).toMatchObject({ kind: 'written', value: { memos: [{ revision: 4 }, {}] } });
    expect(await f.store.changeState({ ...stateRequest('pin', 2), expectedRevision: 4 })).toMatchObject({ kind: 'written' });
    expect(await f.store.changeState({ ...stateRequest('pin', 3), expectedRevision: 5 })).toMatchObject({ kind: 'written', value: { memos: [{ revision: 6 }, {}] } });
  });
});

describe('タグ作成・改名', () => {
  it('タグの明示初回作成でも空JSONの事前保存なしでnot-requiredを1回書く', async () => {
    const f = saveFixture(null);
    expect(await f.store.saveTag({ ...tagRequest(), name: ' 新タグ ', expectedRevision: null })).toMatchObject({ kind: 'written', value: {
      migration: { status: 'not-required' }, memos: [], memoTags: [], tags: [{ id: TAG, name: '新タグ', revision: 1, createdAt: NOW }] } });
    expect(f.storage.writes).toHaveLength(1); expect(f.storage.values.has(OLD_STORAGE_KEY)).toBe(false);
  });
  it('改名はタグrevisionだけ増やし、createdAt・メモ・関連を保持する', async () => {
    const f = saveFixture(); expect((await f.store.saveTag(tagRequest())).kind).toBe('written');
    expect(JSON.parse(f.storage.writes[0]![1])).toEqual({ ...state(), tags: [{ ...state().tags[0], name: '名前変更', revision: 2 }, state().tags[1]] });
  });
  it.each(['create-id', 'not-found', 'conflict', 'limit', 'duplicate-name'])('不適合なタグ保存を拒否する: %s', async mode => {
    const initial = state(), input = tagRequest(); let reason = 'invalid-input';
    if (mode === 'create-id') { input.expectedRevision = null; input.id = TAG.toUpperCase(); reason = 'id-exists'; }
    if (mode === 'not-found') { input.id = token(88); reason = 'not-found'; }
    if (mode === 'conflict') { input.expectedRevision = 2; reason = 'conflict'; }
    if (mode === 'limit') { initial.tags[0]!.revision = input.expectedRevision = Number.MAX_SAFE_INTEGER; reason = 'revision-limit'; }
    if (mode === 'duplicate-name') { input.id = TAG2; input.expectedRevision = 2; input.name = 'tAG'; reason = 'duplicate-tag'; }
    const f = saveFixture(initial);
    expect(await f.store.saveTag(input)).toMatchObject({ kind: 'rejected', reason }); expect(f.storage.writes).toEqual([]);
  });
  it('作成でもASCIIキー重複を拒否する', async () => {
    const f = saveFixture();
    expect(await f.store.saveTag({ ...tagRequest(), id: token(88), expectedRevision: null, name: 'tag' })).toMatchObject({ reason: 'duplicate-tag' });
    expect(f.storage.writes).toEqual([]);
  });
  it('非ASCII大小文字は別名、自己のASCII大小文字だけの改名は許可する', async () => {
    const initial = state(); initial.tags[0]!.name = 'Ä';
    const f = saveFixture(initial);
    expect((await f.store.saveTag({ ...tagRequest(), id: TAG2, expectedRevision: 2, name: 'ä' })).kind).toBe('written');
    const g = saveFixture();
    expect((await g.store.saveTag({ ...tagRequest(), name: 'tAG' })).kind).toBe('written');
  });
  it.each(['', ' ', '\ud800', 'x\ny', 'x\u2028y', '😀'.repeat(31)])('不正名を整形規則で拒否する %#', async name => {
    const f = saveFixture(); expect((await f.store.saveTag({ ...tagRequest(), name })).kind).toBe('rejected'); expect(f.storage.writes).toEqual([]);
  });
  it('30コードポイントと本文正規化なしを区別する', async () => {
    const f = saveFixture();
    expect(await f.store.saveTag({ ...tagRequest(), name: '😀'.repeat(30) })).toMatchObject({ kind: 'written', value: { tags: [{ name: '😀'.repeat(30) }, {}] } });
  });
});

describe('タグ削除の全件事前検証', () => {
  it('通常・ゴミ箱の全関連メモを更新しSQLと異なりlastRequestIdを保持する', async () => {
    const initial = state(); initial.memos[1]!.deletedAt = BEFORE;
    initial.memos.push({ ...initial.memos[1]!, id: token(88), title: '非対象' });
    const f = saveFixture(initial);
    expect((await f.store.deleteTag(deleteRequest())).kind).toBe('written');
    expect(JSON.parse(f.storage.writes[0]![1])).toEqual({ ...initial, tags: [initial.tags[1]], memoTags: [], memos: [
      { ...initial.memos[0], revision: 4, updatedAt: NOW, lastRequestId: PREVIOUS },
      { ...initial.memos[1], revision: 2, updatedAt: NOW, lastRequestId: null }, initial.memos[2]] });
    expect(f.storage.writes).toHaveLength(1);
  });
  it.each([0, 1])('関連メモ%sがrevision上限なら全件・関連・タグを保持し時計も呼ばない', async index => {
    const initial = state(); initial.memos[index]!.revision = Number.MAX_SAFE_INTEGER; initial.memos[1]!.deletedAt = BEFORE;
    const f = saveFixture(initial); let clockCalls = 0;
    const store = createLocalMemoStore({ ...f.deps, now: () => { clockCalls++; return NOW; } });
    const before = f.storage.values.get(NEW_STORAGE_KEY);
    expect(await store.deleteTag(deleteRequest())).toMatchObject({ kind: 'rejected', reason: 'revision-limit' });
    expect(clockCalls).toBe(0); expect(f.storage.values.get(NEW_STORAGE_KEY)).toBe(before); expect(f.storage.writes).toEqual([]);
  });
  it.each(['orphan', 'duplicate', 'unsafe', 'unknown-field'])('全体の%s不整合があればタグ削除前に停止する', async mode => {
    const initial = state();
    if (mode === 'orphan') initial.memoTags[1]!.memoId = token(88);
    if (mode === 'duplicate') initial.memoTags.push(initial.memoTags[0]!);
    if (mode === 'unsafe') initial.memos[1]!.revision = Number.MAX_SAFE_INTEGER + 1;
    if (mode === 'unknown-field') Object.assign(initial.memos[1]!, { extra: true });
    const f = saveFixture(initial), before = f.storage.values.get(NEW_STORAGE_KEY);
    expect(await f.store.deleteTag(deleteRequest())).toMatchObject({ kind: 'rejected', reason: 'invalid-data' });
    expect(f.storage.writes).toEqual([]); expect(f.storage.values.get(NEW_STORAGE_KEY)).toBe(before);
  });
  it('未使用タグは時計なしで削除でき、メモ全件を保持する', async () => {
    const f = saveFixture(); const store = createLocalMemoStore({ ...f.deps, now: () => { throw new Error('呼出禁止'); } });
    expect((await store.deleteTag({ ...deleteRequest(), id: TAG2, expectedRevision: 2 })).kind).toBe('written');
    expect(JSON.parse(f.storage.writes[0]![1]).memos).toEqual(state().memos);
  });
  it('関連メモの上限直前は加算可能で、タグ自身のrevisionは削除時に加算しない', async () => {
    const initial = state(); initial.memos[1]!.revision = Number.MAX_SAFE_INTEGER - 1; initial.tags[0]!.revision = Number.MAX_SAFE_INTEGER;
    const f = saveFixture(initial);
    expect(await f.store.deleteTag({ ...deleteRequest(), expectedRevision: Number.MAX_SAFE_INTEGER })).toMatchObject({ kind: 'written', value: {
      memos: [{ revision: 4 }, { revision: Number.MAX_SAFE_INTEGER }], tags: [{ id: TAG2 }] } });
  });
  it.each(['not-found', 'conflict'])('削除の%sを未書込拒否する', async reason => {
    const f = saveFixture(); const input = reason === 'not-found' ? { ...deleteRequest(), id: token(88) } : { ...deleteRequest(), expectedRevision: 2 };
    expect(await f.store.deleteTag(input)).toMatchObject({ reason }); expect(f.storage.writes).toEqual([]);
  });
});

const calls = {
  save: (f: ReturnType<typeof saveFixture>, n: number) => f.store.save(request(n)),
  state: (f: ReturnType<typeof saveFixture>, n: number) => f.store.changeState(stateRequest('pin', n)),
  tag: (f: ReturnType<typeof saveFixture>, n: number) => f.store.saveTag(tagRequest(n)),
  delete: (f: ReturnType<typeof saveFixture>, n: number) => f.store.deleteTag(deleteRequest(n)),
};
describe('全操作で共用するA案・排他・失敗分類', () => {
  for (const first of Object.keys(calls) as Array<keyof typeof calls>) {
    it.each(Object.keys(calls) as Array<keyof typeof calls>)(`${first}受付後の%sで同requestIdを拒否する`, async second => {
      const f = saveFixture(); await calls[first](f, 1);
      expect(await calls[second](f, 1)).toMatchObject({ kind: 'rejected', reason: 'request-id-reused' });
      expect(f.storage.writes).toHaveLength(1);
    });
  }
  it.each(['state', 'tag', 'delete'] as const)('%sの入力不正・未知項目でも予約を戻さない', async method => {
    const f = saveFixture();
    const input = method === 'state' ? stateRequest() : method === 'tag' ? tagRequest() : deleteRequest();
    const result = method === 'state' ? f.store.changeState({ ...input, extra: true }) : method === 'tag' ? f.store.saveTag({ ...input, extra: true }) : f.store.deleteTag({ ...input, extra: true });
    expect((await result).kind).toBe('rejected');
    expect(await f.store.save(request())).toMatchObject({ reason: 'request-id-reused' }); expect(f.storage.writes).toEqual([]);
  });
  it('保存と状態操作の同revision競合を直列化する', async () => {
    const f = saveFixture();
    const result = await Promise.all([f.store.save(request()), f.store.changeState(stateRequest('trash', 2))]);
    expect(result.map(row => row.kind)).toEqual(['saved', 'rejected']); expect(result[1]).toMatchObject({ reason: 'conflict' });
    expect(f.storage.writes).toHaveLength(1);
  });
  it('タグ削除の関連revision更新で古いメモ保存を拒否する', async () => {
    const f = saveFixture();
    expect((await f.store.deleteTag(deleteRequest())).kind).toBe('written');
    expect(await f.store.save(request(2))).toMatchObject({ reason: 'conflict' }); expect(f.storage.writes).toHaveLength(1);
  });
  it('タグ改名はメモ保存の期待revisionを無効化しない', async () => {
    const f = saveFixture(); await f.store.saveTag(tagRequest());
    expect((await f.store.save(request(2))).kind).toBe('saved');
  });
  it('同じタグrevisionからの改名と削除は片方だけ成功する', async () => {
    const f = saveFixture();
    const results = await Promise.all([f.store.saveTag(tagRequest()), f.store.deleteTag(deleteRequest(2))]);
    expect(results.map(row => row.kind)).toEqual(['written', 'rejected']); expect(results[1]).toMatchObject({ reason: 'conflict' });
    expect(f.storage.writes).toHaveLength(1);
  });
  it('タグ改名のロック待機中に呼出側が編集しても受付時の値を使う', async () => {
    const f = saveFixture(), input = tagRequest();
    const result = f.store.saveTag(input); input.name = '後続編集'; input.expectedRevision = 99;
    expect(await result).toMatchObject({ kind: 'written', value: { tags: [{ name: '名前変更', revision: 2 }, {}] } });
  });
  it('状態変更・削除でも入力を受付時に固定する', async () => {
    const f = saveFixture(), input = stateRequest('trash'); const result = f.store.changeState(input);
    input.action = 'unpin'; input.id = OTHER;
    expect(await result).toMatchObject({ kind: 'written', value: { memos: [{ id: MEMO, deletedAt: NOW, pinnedAt: BEFORE }, {}] } });
    const deletion = deleteRequest(2), removed = f.store.deleteTag(deletion); deletion.id = TAG2;
    expect(await removed).toMatchObject({ kind: 'written', value: { tags: [{ id: TAG2 }] } });
  });
  it.each(['state', 'tag', 'delete'] as const)('%sでも書込後例外はunknownで再利用・自動再送なし', async method => {
    const f = saveFixture(); f.storage.afterSet = () => { throw new Error('PRIVATE'); };
    const result = await calls[method](f, 1);
    expect(result).toMatchObject({ kind: 'unknown', writeOutcome: 'unverified' }); expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(await calls.save(f, 1)).toMatchObject({ reason: 'request-id-reused' }); expect(f.storage.writes).toHaveLength(1);
  });
  it.each(['state', 'tag', 'delete'] as const)('%sでも読戻し不一致を成功にしない', async method => {
    const f = saveFixture(); f.storage.afterSet = () => { f.storage.values.set(NEW_STORAGE_KEY, '{}'); };
    expect(await calls[method](f, 1)).toMatchObject({ kind: 'unknown' }); expect(f.storage.writes).toHaveLength(1);
  });
  it('ロック非対応では追加操作も書き込まない', async () => {
    const f = saveFixture(); const store = createLocalMemoStore({ ...f.deps, locks: undefined });
    expect(await store.saveTag(tagRequest())).toMatchObject({ reason: 'locks-unavailable' }); expect(f.storage.writes).toEqual([]);
  });
  it('pendingは追加操作から自動復旧しない', async () => {
    const f = saveFixture(); f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(createPendingMigration('[]', () => MEMO)));
    expect(await f.store.saveTag(tagRequest())).toMatchObject({ reason: 'recovery-required' }); expect(f.storage.writes).toEqual([]);
  });
  it('旧キー・移行メタデータを追加操作でも保持する', async () => {
    const initial = state(); initial.migration = { status: 'complete', legacySnapshot: '[]' };
    const f = saveFixture(initial); f.storage.values.set(OLD_STORAGE_KEY, '保護対象');
    await f.store.saveTag(tagRequest()); await f.store.changeState(stateRequest('trash', 2)); await f.store.deleteTag(deleteRequest(3));
    expect(f.storage.values.get(OLD_STORAGE_KEY)).toBe('保護対象');
    expect(JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!).migration).toEqual(initial.migration);
  });
});

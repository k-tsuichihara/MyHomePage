import { describe, expect, it } from 'vitest';
import { beginSave, confirmResave, createEditor, editDraft, isDirty, settleSave } from '../src/editor-state';
import type { EditorState, SaveAttempt } from '../src/editor-state';
import { MEMO, TAG, TAG2, NOW, state, token, saveFixture } from './local-save-fixtures';

function editor() { return createEditor(MEMO, 'screen-1', { memo: state().memos[0]!, tagIds: [TAG] }); }
function start(input: EditorState = editor(), n = 1, confirmed = false) {
  const result = beginSave(input, { operationId: `operation-${n}`, requestId: token(n) }, confirmed ? confirmResave(input) : undefined);
  expect(result.kind).toBe('submit');
  if (result.kind !== 'submit') throw new Error('Expected submit');
  return result;
}
function saved(attempt: SaveAttempt) {
  const request = attempt.request;
  return { kind: 'saved', value: { memo: { ...state().memos[0]!, id: request.id, title: request.title, body: request.body,
    updatedAt: NOW, revision: request.expectedRevision === null ? 1 : request.expectedRevision + 1 }, tagIds: [...request.tagIds] } };
}
const failure = (kind: 'rejected' | 'unknown', reason = 'conflict') => ({ kind, reason,
  writeOutcome: kind === 'rejected' ? 'not-attempted' : 'unverified' });

describe('整形前ドラフトと保存済み基準', () => {
  it('既存・新規編集の初期状態はcleanで副作用なし', () => {
    expect(isDirty(editor())).toBe(false);
    const fresh = createEditor(MEMO, 'new');
    expect(isDirty(fresh)).toBe(false); expect(fresh.expectedRevision).toBeNull(); expect(fresh.draft.title).toBe('');
  });
  it.each([' 文字列 ', '\u0000', '\ud800', '\r\n', ' '.repeat(101), ''])('入力途中の文字列を補正しない %s', title => {
    const source = editor(), input = { title, body: ' \t\r\n ', tagIds: [TAG] };
    const next = editDraft(source, input);
    expect(next.draft).toEqual(input); expect(source.draft.title).toBe('元のタイトル'); expect(isDirty(next)).toBe(true);
  });
  it('タグ順序・大小文字だけは同値だがタグ追加はdirty', () => {
    const source = editor();
    expect(isDirty(editDraft(source, { ...source.draft, tagIds: [TAG.toUpperCase()] }))).toBe(false);
    expect(isDirty(editDraft(source, { ...source.draft, tagIds: [TAG, TAG2] }))).toBe(true);
    const two = createEditor(MEMO, 'two', { memo: state().memos[0]!, tagIds: [TAG, TAG2] });
    expect(isDirty(editDraft(two, { ...two.draft, tagIds: [TAG2, TAG] }))).toBe(false);
  });
  it('呼出側の後続変更から独立し、状態は深く凍結される', () => {
    const initial = { memo: state().memos[0]!, tagIds: [TAG] }, value = createEditor(MEMO, 's', initial);
    initial.memo.title = '変更'; initial.tagIds.length = 0;
    expect(value.draft.title).toBe('元のタイトル'); expect(value.draft.tagIds).toEqual([TAG]);
    const input = { title: '変更前', body: '', tagIds: [TAG] }, next = editDraft(value, input);
    input.title = '変更後'; input.tagIds.length = 0;
    expect(next.draft.title).toBe('変更前'); expect(Object.isFrozen(next.draft.tagIds)).toBe(true);
    expect(() => { (next.draft as { title: string }).title = '改変'; }).toThrow();
  });
  it.each(['unknown-id', 'trashed'])('不適切な編集対象%sは拒否する', mode => {
    const memo = state().memos[0]!;
    if (mode === 'trashed') memo.deletedAt = NOW;
    expect(() => createEditor(mode === 'unknown-id' ? token(80) : MEMO, 's', { memo, tagIds: [] })).toThrow();
  });
  it.each([{ tagIds: [TAG, TAG.toUpperCase()] }, { tagIds: ['bad'] }])('不正タグ選択を黙って変更しない', ({ tagIds }) => {
    expect(() => editDraft(editor(), { title: '', body: '', tagIds })).toThrow();
  });
});

describe('保存スナップショットと追加編集', () => {
  it('整形前の値と送信値を分離し、追加編集なしの成功はclean', () => {
    const raw = editDraft(editor(), { title: ' 保存タイトル ', body: ' 本文\n ', tagIds: [TAG2] });
    const operation = start(raw);
    expect(operation.attempt.request.title).toBe('保存タイトル'); expect(operation.attempt.rawDraft.title).toBe(' 保存タイトル ');
    const result = settleSave(operation.state, operation.attempt.context, saved(operation.attempt));
    expect(isDirty(result)).toBe(false); expect(result.draft).toEqual(raw.draft);
    expect(result.expectedRevision).toBe(4); expect(result.screen).toBe('detail');
  });
  it('新規保存の成功後はrevision=1で、無題補完をドラフトへ強制しない', () => {
    const raw = editDraft(createEditor(MEMO, 'new'), { title: ' ', body: '本文', tagIds: [] });
    const operation = start(raw), result = settleSave(operation.state, operation.attempt.context, saved(operation.attempt));
    expect(operation.attempt.request.title).toBe('無題'); expect(result.draft.title).toBe(' ');
    expect(result.expectedRevision).toBe(1); expect(isDirty(result)).toBe(false);
  });
  it('保存中の追加編集を成功応答で消さず、次の保存で新revisionを使う', () => {
    const operation = start(), changed = editDraft(operation.state, { title: '追加入力', body: '\u0000', tagIds: [TAG2] });
    const result = settleSave(changed, operation.attempt.context, saved(operation.attempt));
    expect(result.draft).toEqual(changed.draft); expect(isDirty(result)).toBe(true); expect(result.expectedRevision).toBe(4);
    const valid = editDraft(result, { ...result.draft, body: '次の本文' });
    expect(start(valid, 2).attempt.request.expectedRevision).toBe(4);
  });
  it('追加編集を送信値へ戻していたら成功後clean', () => {
    const operation = start(), changed = editDraft(operation.state, { ...operation.state.draft, title: '追加' });
    const restored = editDraft(changed, operation.attempt.rawDraft);
    expect(isDirty(settleSave(restored, operation.attempt.context, saved(operation.attempt)))).toBe(false);
  });
  it('保存中の二重保存ではsubmitを返さない', () => {
    const operation = start();
    expect(beginSave(operation.state, { operationId: 'next', requestId: token(2) })).toMatchObject({ kind: 'blocked', reason: 'saving' });
  });
  it.each(['\u0000', '\ud800', 'x'.repeat(101)])('保存前の不正入力は保持して拒否 %s', title => {
    const input = editDraft(editor(), { title, body: '', tagIds: [] });
    expect(beginSave(input, { operationId: 'op', requestId: token(1) })).toMatchObject({ kind: 'blocked', reason: 'invalid-input', state: input });
    expect(input.usedRequestIds).toEqual([]);
  });
  it('保存前に拒否したIDはストアへ未送信で、修正後に開始できる', () => {
    const input = editDraft(editor(), { title: '', body: '', tagIds: [] });
    expect(beginSave(input, { operationId: 'operation-1', requestId: token(1) }).kind).toBe('blocked');
    expect(start(editDraft(input, { title: '修正', body: '', tagIds: [] })).attempt.request.requestId).toBe(token(1));
  });
});

describe('拒否・結果不明・遅延応答', () => {
  it.each(['conflict', 'invalid-input', 'locks-unavailable', 'revision-limit'])('未試行の拒否%sはドラフトとrevisionを保持', reason => {
    const operation = start(), result = settleSave(operation.state, operation.attempt.context, failure('rejected', reason));
    expect(result.save).toEqual({ kind: 'rejected', reason }); expect(result.draft).toEqual(operation.state.draft);
    expect(result.expectedRevision).toBe(3); expect(result.unresolved).toEqual([]);
  });
  it('結果不明の内容とrequestIdを保持し、自動再送も成功扱いもしない', () => {
    const operation = start(), result = settleSave(operation.state, operation.attempt.context, failure('unknown', 'storage-failure'));
    expect(result.save.kind).toBe('unknown'); expect(result.unresolved).toEqual([operation.attempt]);
    expect(result.unresolved[0]!.request.requestId).toBe(token(1)); expect(result.expectedRevision).toBe(3);
    expect(beginSave(result, { operationId: 'new', requestId: token(2) })).toMatchObject({ kind: 'blocked', reason: 'confirmation-required' });
  });
  it('明示確認後の再保存は新IDだけ、後の成功でも元不明要求を解決済みにしない', () => {
    const operation = start(), unknown = settleSave(operation.state, operation.attempt.context, failure('unknown'));
    expect(beginSave(unknown, { operationId: 'operation-1', requestId: token(2) }, confirmResave(unknown))).toMatchObject({ reason: 'identifier-reused' });
    expect(beginSave(unknown, { operationId: 'new', requestId: token(1).toUpperCase() }, confirmResave(unknown))).toMatchObject({ reason: 'identifier-reused' });
    const second = start(unknown, 2, true), result = settleSave(second.state, second.attempt.context, saved(second.attempt));
    expect(result.unresolved).toEqual([operation.attempt]); expect(result.save.kind).toBe('saved');
  });
  it('再保存の確認後に編集したら再確認が必要', () => {
    const operation = start(), unknown = settleSave(operation.state, operation.attempt.context, failure('unknown'));
    const ticket = confirmResave(unknown), edited = editDraft(unknown, unknown.draft);
    expect(beginSave(edited, { operationId: 'new', requestId: token(2) }, ticket)).toMatchObject({ reason: 'confirmation-required' });
  });
  it('requestIdの英字大小文字違いも再利用できない', () => {
    const operation = beginSave(editor(), { operationId: 'first', requestId: TAG });
    if (operation.kind !== 'submit') throw new Error('Expected submit');
    const rejected = settleSave(operation.state, operation.attempt.context, failure('rejected'));
    expect(beginSave(rejected, { operationId: 'second', requestId: TAG.toUpperCase() })).toMatchObject({ reason: 'identifier-reused' });
  });
  it.each(['rejected', 'unknown'] as const)('%sでも送信中の追加編集を保持する', kind => {
    const operation = start(editDraft(editor(), { title: '送信', body: '送信本文', tagIds: [TAG] }));
    const edited = editDraft(operation.state, { title: ' 追加 ', body: '\ud800', tagIds: [TAG2] });
    const result = settleSave(edited, operation.attempt.context, failure(kind));
    expect(result.draft).toEqual(edited.draft); expect(isDirty(result)).toBe(true);
    expect(result.baseline).toEqual(editor().baseline);
  });
  it('読出し時に例外となる応答も元例外を公開せず結果不明にする', () => {
    const operation = start();
    const response = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('PRIVATE'); } });
    const result = settleSave(operation.state, operation.attempt.context, response);
    expect(result.save).toMatchObject({ kind: 'unknown', reason: 'invalid-response' });
    expect(JSON.stringify(result.save)).not.toContain('PRIVATE');
  });
  it.each(['operation', 'session', 'source'])('古い%sコンテキストの応答を無視する', field => {
    const operation = start(), context = { ...operation.attempt.context };
    if (field === 'operation') context.operationId = 'other';
    if (field === 'session') context.sessionId = 'old-screen';
    if (field === 'source') Object.assign(context, { source: 'cloud' });
    expect(settleSave(operation.state, context, saved(operation.attempt))).toBe(operation.state);
  });
  it('逆順・二重応答を現在の保存へ流用しない', () => {
    const first = start(), rejected = settleSave(first.state, first.attempt.context, failure('rejected'));
    const second = start(rejected, 2);
    expect(settleSave(second.state, first.attempt.context, saved(first.attempt))).toBe(second.state);
    const result = settleSave(second.state, second.attempt.context, saved(second.attempt));
    expect(settleSave(result, second.attempt.context, failure('unknown'))).toBe(result);
  });
  it.each(['id', 'title', 'body', 'revision', 'tags', 'deleted', 'extra', 'private-reason', 'outcome'])('不正応答%sは結果不明、ドラフトを保持', mode => {
    const operation = start(), response = saved(operation.attempt);
    if (mode === 'id') response.value.memo.id = token(99);
    if (mode === 'title') response.value.memo.title = '別内容';
    if (mode === 'body') response.value.memo.body = '別本文';
    if (mode === 'revision') response.value.memo.revision = 99;
    if (mode === 'tags') response.value.tagIds = [TAG2];
    if (mode === 'deleted') response.value.memo.deletedAt = NOW;
    if (mode === 'extra') Object.assign(response.value.memo, { extra: true });
    const input = mode === 'private-reason' ? failure('unknown', 'PRIVATE') : mode === 'outcome' ? { kind: 'rejected', reason: 'conflict', writeOutcome: 'unverified' } : response;
    const result = settleSave(operation.state, operation.attempt.context, input);
    expect(result.save).toMatchObject({ kind: 'unknown', reason: 'invalid-response' }); expect(result.draft).toEqual(operation.state.draft);
    expect(JSON.stringify(result.save)).not.toContain('PRIVATE');
  });
  it.each([null, undefined, {}, { kind: 'previously-applied-deleted' }])('不正応答を成功へ補正しない', input => {
    const operation = start(); expect(settleSave(operation.state, operation.attempt.context, input).save.kind).toBe('unknown');
  });
});

describe('既存ローカルAPIとの合成結合', () => {
  it('ストアの確定成功を反映し、追加編集を保持する', async () => {
    const f = saveFixture(), operation = start();
    const response = await f.store.save(operation.attempt.request);
    const edited = editDraft(operation.state, { ...operation.state.draft, body: '送信後' });
    const result = settleSave(edited, operation.attempt.context, response);
    expect(response.kind).toBe('saved'); expect(isDirty(result)).toBe(true); expect(result.draft.body).toBe('送信後');
    expect(f.storage.writes).toHaveLength(1);
  });
  it('ストアの競合を拒否として保持し、再取得を自動実行しない', async () => {
    const f = saveFixture();
    const stale = createEditor(MEMO, 's', { memo: { ...state().memos[0]!, revision: 2 }, tagIds: [] });
    const operation = start(stale), response = await f.store.save(operation.attempt.request);
    expect(settleSave(operation.state, operation.attempt.context, response).save).toEqual({ kind: 'rejected', reason: 'conflict' });
    expect(f.storage.writes).toHaveLength(0);
  });
  it('書込後例外の結果不明を保持し、実際に書かれていても自動再送しない', async () => {
    const f = saveFixture(); f.storage.afterSet = () => { throw new Error('PRIVATE'); };
    const operation = start(), response = await f.store.save(operation.attempt.request);
    const result = settleSave(operation.state, operation.attempt.context, response);
    expect(result.save.kind).toBe('unknown'); expect(f.storage.writes).toHaveLength(1);
    expect(result.unresolved[0]!.request).toEqual(operation.attempt.request);
    expect(await f.store.save(operation.attempt.request)).toMatchObject({ reason: 'request-id-reused' });
  });
});

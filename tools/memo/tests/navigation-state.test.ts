import { describe, expect, it } from 'vitest';
import { beginSave, createEditor, editDraft, isDirty, settleSave } from '../src/editor-state';
import { confirmNavigation, listNeighbors, prepareLocalList, requestNavigation } from '../src/navigation-state';
import type { NavigationTarget } from '../src/navigation-state';
import { MEMO, OTHER, TAG, state, token } from './local-save-fixtures';
import { createPendingMigration } from '../src/migration';

const editor = () => createEditor(MEMO, 's', { memo: state().memos[0]!, tagIds: [TAG] });
const dirty = () => editDraft(editor(), { title: ' 未保存 ', body: '\u0000', tagIds: [TAG] });
const targets: NavigationTarget[] = [{ kind: 'list' }, { kind: 'detail', id: OTHER }, { kind: 'switch-source' }, { kind: 'logout' }];

describe('ドラフト保護と遷移確認', () => {
  it.each(targets)('保存拒否後のcleanでも失敗確認を要求する: %j', target => {
    const operation = beginSave(editor(), { operationId: 'op', requestId: token(1) });
    if (operation.kind !== 'submit') throw new Error('Expected submit');
    const rejected = settleSave(operation.state, operation.attempt.context, { kind: 'rejected', reason: 'conflict', writeOutcome: 'not-attempted' });
    expect(isDirty(rejected)).toBe(false); expect(rejected.unresolved).toEqual([]);
    const decision = requestNavigation(rejected, target);
    expect(decision.kind).toBe('confirmation-required');
    if (decision.kind !== 'confirmation-required') throw new Error('Expected confirmation');
    expect(decision.reason).toBe('rejected');
    expect(confirmNavigation(rejected, decision.ticket, false)).toEqual({ kind: 'cancelled', retained: rejected });
    expect(confirmNavigation(rejected, decision.ticket, true)).toEqual({ kind: 'allowed', target, retained: rejected });
    expect(rejected.save).toEqual({ kind: 'rejected', reason: 'conflict' });
  });
  it('正常保存後のcleanは失敗確認なしで遷移できる', () => {
    const operation = beginSave(editor(), { operationId: 'op', requestId: token(1) });
    if (operation.kind !== 'submit') throw new Error('Expected submit');
    const saved = settleSave(operation.state, operation.attempt.context, { kind: 'saved', value: {
      memo: { ...state().memos[0]!, revision: 4 }, tagIds: [TAG] } });
    expect(saved.save.kind).toBe('saved'); expect(isDirty(saved)).toBe(false);
    expect(requestNavigation(saved, { kind: 'list' }).kind).toBe('allowed');
  });
  it.each(['invalid-input', 'locks-unavailable', 'revision-limit'])('競合以外の拒否%sでもcleanなまま失敗確認を要求する', reason => {
    const operation = beginSave(editor(), { operationId: 'op', requestId: token(1) });
    if (operation.kind !== 'submit') throw new Error('Expected submit');
    const rejected = settleSave(operation.state, operation.attempt.context, { kind: 'rejected', reason, writeOutcome: 'not-attempted' });
    expect(isDirty(rejected)).toBe(false);
    expect(requestNavigation(rejected, { kind: 'list' })).toMatchObject({ kind: 'confirmation-required', reason: 'rejected' });
  });
  it('保存拒否の確認も追加編集で失効し、拒否状態を黙って解除しない', () => {
    const operation = beginSave(editor(), { operationId: 'op', requestId: token(1) });
    if (operation.kind !== 'submit') throw new Error('Expected submit');
    const rejected = settleSave(operation.state, operation.attempt.context, { kind: 'rejected', reason: 'conflict', writeOutcome: 'not-attempted' });
    const decision = requestNavigation(rejected, { kind: 'list' });
    if (decision.kind !== 'confirmation-required') throw new Error('Expected confirmation');
    const edited = editDraft(rejected, { ...rejected.draft, title: '追加編集' });
    expect(confirmNavigation(edited, decision.ticket, true)).toEqual({ kind: 'blocked', reason: 'stale-confirmation' });
    expect(requestNavigation(edited, { kind: 'list' })).toMatchObject({ kind: 'confirmation-required', reason: 'rejected' });
  });
  it.each(targets)('cleanなら$kindへの判定だけを許可', target => {
    const source = editor(), decision = requestNavigation(source, target);
    expect(decision).toEqual({ kind: 'allowed', target, retained: source });
    expect(source.source).toBe('local');
  });
  it.each(targets)('dirtyなら$kindを確認し、キャンセルで保持', target => {
    const source = dirty(), decision = requestNavigation(source, target);
    if (decision.kind !== 'confirmation-required') throw new Error('Expected confirmation');
    expect(decision.reason).toBe('unsaved');
    expect(confirmNavigation(source, decision.ticket, false)).toEqual({ kind: 'cancelled', retained: source });
    expect(confirmNavigation(source, decision.ticket, true)).toEqual({ kind: 'allowed', target, retained: source });
    expect(source.draft.body).toBe('\u0000');
  });
  it.each(targets)('保存中は$kindも確認の確定も抑止', target => {
    const source = dirty(), confirmation = requestNavigation(source, target);
    if (confirmation.kind !== 'confirmation-required') throw new Error('Expected confirmation');
    const valid = editDraft(source, { ...source.draft, body: '保存可能' });
    const operation = beginSave(valid, { operationId: 'op', requestId: token(1) });
    if (operation.kind !== 'submit') throw new Error('Expected submit');
    expect(requestNavigation(operation.state, target)).toEqual({ kind: 'blocked', reason: 'saving' });
    expect(confirmNavigation(operation.state, confirmation.ticket, true)).toEqual({ kind: 'blocked', reason: 'saving' });
  });
  it('確認後の編集・元へ戻す操作でも古い確認は流用不可', () => {
    const source = dirty(), decision = requestNavigation(source, { kind: 'list' });
    if (decision.kind !== 'confirmation-required') throw new Error('Expected confirmation');
    const changed = editDraft(source, { ...source.draft, title: '変更' });
    const restored = editDraft(changed, source.draft);
    for (const next of [changed, restored]) expect(confirmNavigation(next, decision.ticket, true)).toEqual({ kind: 'blocked', reason: 'stale-confirmation' });
    expect(requestNavigation(restored, { kind: 'list' }).kind).toBe('confirmation-required');
  });
  it('別の画面セッションの確認は流用しない', () => {
    const decision = requestNavigation(dirty(), { kind: 'list' });
    if (decision.kind !== 'confirmation-required') throw new Error('Expected confirmation');
    expect(confirmNavigation(dirty(), decision.ticket, true)).toEqual({ kind: 'blocked', reason: 'stale-confirmation' });
  });
  it('保存結果が反映された後は保存前の確認を流用しない', () => {
    const source = editDraft(editor(), { title: '保存前', body: '', tagIds: [] });
    const decision = requestNavigation(source, { kind: 'list' });
    if (decision.kind !== 'confirmation-required') throw new Error('Expected confirmation');
    const operation = beginSave(source, { operationId: 'op', requestId: token(1) });
    if (operation.kind !== 'submit') throw new Error('Expected submit');
    const rejected = settleSave(operation.state, operation.attempt.context, { kind: 'rejected', reason: 'conflict', writeOutcome: 'not-attempted' });
    expect(confirmNavigation(rejected, decision.ticket, true)).toEqual({ kind: 'blocked', reason: 'stale-confirmation' });
  });
  it('cleanでも結果不明の要求があれば破棄・切替に明示確認が必要', () => {
    const operation = beginSave(editor(), { operationId: 'op', requestId: token(1) });
    if (operation.kind !== 'submit') throw new Error('Expected submit');
    const unknown = settleSave(operation.state, operation.attempt.context, { kind: 'unknown', reason: 'storage-failure', writeOutcome: 'unverified' });
    const decision = requestNavigation(unknown, { kind: 'logout' });
    if (decision.kind !== 'confirmation-required') throw new Error('Expected confirmation');
    expect(decision.reason).toBe('unknown');
    const allowed = confirmNavigation(unknown, decision.ticket, true);
    if (allowed.kind !== 'allowed') throw new Error('Expected allowed');
    expect(allowed.retained.unresolved).toEqual([operation.attempt]);
  });
});

describe('読込結果と一覧復帰の接続境界', () => {
  it('検索・タグ・ソート・スクロール・前後順を保持する', () => {
    const input = state(), options = { text: '', selectedTagIds: [TAG], sort: 'created-asc' };
    const result = prepareLocalList({ kind: 'loaded', value: input }, options, 123.5);
    if (result.kind !== 'ready') throw new Error('Expected list');
    const context = result.context;
    expect(context.scrollTop).toBe(123.5); expect(context.result.query).toEqual({ view: 'normal', ...options });
    expect(context.result.orderedIds).toEqual([MEMO, OTHER]);
    expect(listNeighbors(context, MEMO)).toMatchObject({ previousId: null, nextId: OTHER });
    expect(listNeighbors(context, token(90))).toEqual({ kind: 'not-in-result', total: 2 });
    input.memos.length = 0; options.selectedTagIds.length = 0;
    expect(context.result.orderedIds).toEqual([MEMO, OTHER]); expect(context.result.query.selectedTagIds).toEqual([TAG]);
    expect(Object.isFrozen(context.result.query.selectedTagIds)).toBe(true);
  });
  it('不在タグの選択を保持して通知する', () => {
    const result = prepareLocalList({ kind: 'loaded', value: state() }, { selectedTagIds: [token(90)] });
    if (result.kind !== 'ready') throw new Error('Expected list');
    expect(result.context.result.missingSelectedTagIds).toEqual([token(90)]);
    expect(result.context.result.resultCount).toBe(0);
  });
  it('明示的emptyだけを正常な空一覧にする', () => {
    const result = prepareLocalList({ kind: 'empty' });
    if (result.kind !== 'ready') throw new Error('Expected list');
    expect(result.context.result.resultCount).toBe(0); expect(result.context.scrollTop).toBe(0);
  });
  it.each([null, undefined, {}, { kind: 'loaded', value: null }, { kind: 'empty', extra: true },
    { kind: 'loaded', value: { ...state(), extra: true } }])('失敗・破損を空一覧へ変換しない', input => {
    expect(prepareLocalList(input).kind).toBe('blocked');
  });
  it.each(['storage-failure', 'migration-required', 'recovery-required', 'locks-unavailable'])('取得不可%sはblocked', reason => {
    expect(prepareLocalList({ kind: 'unavailable', reason })).toEqual({ kind: 'blocked', reason: 'unavailable' });
  });
  it('構造検証成功のpendingも通常一覧へ進めない', () => {
    expect(prepareLocalList({ kind: 'loaded', value: createPendingMigration('[]', () => MEMO) })).toEqual({ kind: 'blocked', reason: 'pending' });
  });
  it.each([-1, NaN, Infinity, -Infinity])('不正スクロール座標%sは拒否', scroll => {
    expect(prepareLocalList({ kind: 'empty' }, {}, scroll).kind).toBe('blocked');
  });
  it('不正検索条件も一覧取得成功として扱わない', () => {
    expect(prepareLocalList({ kind: 'empty' }, { sort: 'unknown' }).kind).toBe('blocked');
  });
});

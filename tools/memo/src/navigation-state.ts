import { immutable, isDirty } from './editor-state';
import type { EditorState } from './editor-state';
import { getMemoNeighbors, queryMemos } from './memo-query';
import type { MemoQueryResult } from './memo-query';
import { validateLocalV2 } from './local-validation';
import { record, uuid } from './read-primitives';

export type NavigationTarget = { readonly kind: 'list' } | { readonly kind: 'detail'; readonly id: string }
  | { readonly kind: 'switch-source' } | { readonly kind: 'logout' };
export interface LeaveConfirmation { readonly state: EditorState; readonly target: NavigationTarget }
export type NavigationDecision = { kind: 'blocked'; reason: 'saving' | 'stale-confirmation' }
  | { kind: 'cancelled'; retained: EditorState }
  | { kind: 'confirmation-required'; reason: 'unsaved' | 'unknown'; ticket: LeaveConfirmation }
  | { kind: 'allowed'; target: NavigationTarget; retained: EditorState };

function target(input: NavigationTarget): NavigationTarget {
  if (input.kind === 'detail') return { kind: 'detail', id: uuid(input.id) };
  if (input.kind === 'list' || input.kind === 'switch-source' || input.kind === 'logout') return { kind: input.kind };
  throw new Error('Invalid navigation target');
}
/** 遷移の許可だけを返す。認証・画面変更・ドラフト消去・保存先間の転送は行わない。 */
export function requestNavigation(state: EditorState, input: NavigationTarget): NavigationDecision {
  if (state.save.kind === 'saving') return { kind: 'blocked', reason: 'saving' };
  const destination = immutable(target(input));
  if (isDirty(state) || state.unresolved.length) {
    return { kind: 'confirmation-required', reason: state.unresolved.length ? 'unknown' : 'unsaved',
      ticket: immutable({ state, target: destination }) };
  }
  return { kind: 'allowed', target: destination, retained: state };
}
/** 確認後の追加編集や保存結果反映を、同じ内容に戻った場合も参照世代で検出する。 */
export function confirmNavigation(state: EditorState, ticket: LeaveConfirmation, accepted: boolean): NavigationDecision {
  if (state.save.kind === 'saving') return { kind: 'blocked', reason: 'saving' };
  if (ticket.state !== state) return { kind: 'blocked', reason: 'stale-confirmation' };
  return accepted ? { kind: 'allowed', target: ticket.target, retained: state } : { kind: 'cancelled', retained: state };
}

export interface ListContext { readonly result: MemoQueryResult; readonly scrollTop: number }
export type PreparedList = { kind: 'ready'; context: ListContext } | { kind: 'blocked'; reason: 'unavailable' | 'pending' | 'invalid-data' };
/** loadのemptyだけを空として受理する。失敗やpendingで既存一覧・ドラフトを破棄させない。 */
export function prepareLocalList(input: unknown, options?: unknown, scrollTop = 0): PreparedList {
  try {
    if (!Number.isFinite(scrollTop) || scrollTop < 0) return { kind: 'blocked', reason: 'invalid-data' };
    if (!input || typeof input !== 'object') return { kind: 'blocked', reason: 'invalid-data' };
    const kind = Object.getOwnPropertyDescriptor(input, 'kind')?.value as unknown;
    if (kind === 'unavailable') return { kind: 'blocked', reason: 'unavailable' };
    let data;
    if (kind === 'empty') {
      record(input, ['kind']); data = { memos: [], tags: [], memoTags: [] };
    } else {
      const row = record(input, ['kind', 'value']);
      if (row.kind !== 'loaded') return { kind: 'blocked', reason: 'invalid-data' };
      const checked = validateLocalV2(row.value);
      if (checked.kind === 'validated-pending') return { kind: 'blocked', reason: 'pending' };
      const { memos, tags, memoTags } = checked.value; data = { memos, tags, memoTags };
    }
    return { kind: 'ready', context: immutable({ result: queryMemos(data, options), scrollTop }) };
  } catch { return { kind: 'blocked', reason: 'invalid-data' }; }
}
/** 詳細へ入った時点の一覧順を使う。更新後の存在確認は呼出側で別途行う。 */
export function listNeighbors(context: ListContext, currentId: string) {
  return getMemoNeighbors(context.result.orderedIds, currentId);
}

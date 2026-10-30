import { normalizeMemoInput } from './input';
import { array, record, string, unique, uuid, uuidKey } from './read-primitives';
import { validateMemoData } from './snapshot-validation';
import type { LocalFailureReason } from './local-data-store';
import type { Memo } from './types';

export interface Draft { readonly title: string; readonly body: string; readonly tagIds: readonly string[] }
export interface SaveContext { readonly operationId: string; readonly source: 'local'; readonly sessionId: string }
export interface SaveAttempt {
  readonly context: SaveContext;
  readonly rawDraft: Draft;
  readonly request: { readonly id: string; readonly title: string; readonly body: string; readonly tagIds: readonly string[];
    readonly expectedRevision: number | null; readonly requestId: string };
}
type FailureReason = LocalFailureReason | 'invalid-response';
export type SaveStatus = { readonly kind: 'idle' } | { readonly kind: 'saving'; readonly attempt: SaveAttempt }
  | { readonly kind: 'rejected'; readonly reason: LocalFailureReason }
  | { readonly kind: 'unknown'; readonly reason: FailureReason; readonly attempt: SaveAttempt }
  | { readonly kind: 'saved' };
export interface EditorState {
  readonly id: string;
  readonly sessionId: string;
  readonly source: 'local';
  readonly screen: 'edit' | 'detail';
  readonly draft: Draft;
  readonly baseline: Draft;
  readonly expectedRevision: number | null;
  readonly save: SaveStatus;
  readonly unresolved: readonly SaveAttempt[];
  readonly usedRequestIds: readonly string[];
  readonly usedOperationIds: readonly string[];
}

/** 入力由来の値を持つ状態はメモリ専用。参照共有による後続変更も防ぐ。 */
export function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(immutable); Object.freeze(value);
  }
  return value;
}
function opaque(value: string): string {
  if (typeof value !== 'string' || !value.length) throw new Error('Invalid editor identifier');
  return value;
}
function tags(input: unknown): string[] {
  const result = array(input).map(uuid); unique(result.map(uuidKey)); return result;
}
function draft(input: Draft): Draft {
  return { title: string(input.title), body: string(input.body), tagIds: tags(input.tagIds) };
}
function tagKeys(ids: readonly string[]): string { return ids.map(uuidKey).sort().join('/'); }
function equalDraft(a: Draft, b: Draft): boolean {
  return a.title === b.title && a.body === b.body && tagKeys(a.tagIds) === tagKeys(b.tagIds);
}
export function isDirty(state: EditorState): boolean { return !equalDraft(state.draft, state.baseline); }

/** 既存の通常メモまたは未保存の新規編集を開始する。保存先の読込は行わない。 */
export function createEditor(id: string, sessionId: string, initial?: { memo: Memo; tagIds: string[] }): EditorState {
  let value: Draft = { title: '', body: '', tagIds: [] }, expectedRevision: number | null = null;
  if (initial) {
    const memo = validateMemoData({ memos: [initial.memo], tags: [], memoTags: [] }).memos[0]!;
    if (uuidKey(memo.id) !== uuidKey(uuid(id)) || memo.deletedAt !== null) throw new Error('Invalid editor target');
    value = { title: memo.title, body: memo.body, tagIds: tags(initial.tagIds) }; expectedRevision = memo.revision;
  }
  return immutable({ id: uuid(id), sessionId: opaque(sessionId), source: 'local', screen: 'edit',
    draft: draft(value), baseline: draft(value), expectedRevision, save: { kind: 'idle' },
    unresolved: [], usedRequestIds: [], usedOperationIds: [] });
}

/** 整形・保存可否の検証は保存開始時だけ。編集中の不正文字も消去しない。 */
export function editDraft(state: EditorState, input: Draft): EditorState {
  return immutable({ ...state, draft: draft(input), screen: 'edit' });
}

export interface ResaveConfirmation { readonly kind: 'resave-after-unknown'; readonly state: EditorState }
export function confirmResave(state: EditorState): ResaveConfirmation {
  return immutable({ kind: 'resave-after-unknown', state });
}
export type BeginSaveResult = { kind: 'submit'; state: EditorState; attempt: SaveAttempt }
  | { kind: 'blocked'; state: EditorState; reason: 'saving' | 'confirmation-required' | 'invalid-input' | 'identifier-reused' };

/**
 * 書込は行わず、一度だけstore.saveへ渡す不変要求を返す。
 * 結果不明後の再保存確認は現状態へ結び付け、旧要求を自動再送しない。
 */
export function beginSave(state: EditorState, ids: { operationId: string; requestId: string }, confirmation?: ResaveConfirmation): BeginSaveResult {
  if (state.save.kind === 'saving') return { kind: 'blocked', state, reason: 'saving' };
  if (state.unresolved.length && (confirmation?.kind !== 'resave-after-unknown' || confirmation.state !== state)) {
    return { kind: 'blocked', state, reason: 'confirmation-required' };
  }
  try {
    const operationId = opaque(ids.operationId), requestId = uuid(ids.requestId);
    if (state.usedOperationIds.includes(operationId) || state.usedRequestIds.includes(uuidKey(requestId))) {
      return { kind: 'blocked', state, reason: 'identifier-reused' };
    }
    const normalized = normalizeMemoInput(state.draft.title, state.draft.body);
    const attempt: SaveAttempt = immutable({ context: { operationId, source: state.source, sessionId: state.sessionId },
      rawDraft: draft(state.draft), request: { id: state.id, ...normalized, tagIds: tags(state.draft.tagIds),
        expectedRevision: state.expectedRevision, requestId } });
    const next: EditorState = immutable({ ...state, save: { kind: 'saving', attempt },
      usedRequestIds: [...state.usedRequestIds, uuidKey(requestId)], usedOperationIds: [...state.usedOperationIds, operationId] });
    return { kind: 'submit', state: next, attempt };
  } catch { return { kind: 'blocked', state, reason: 'invalid-input' }; }
}

const reasons: readonly LocalFailureReason[] = ['invalid-input', 'request-id-reused', 'locks-unavailable', 'lock-failure',
  'storage-failure', 'invalid-data', 'migration-required', 'recovery-required', 'snapshot-changed', 'id-exists',
  'not-found', 'trashed', 'conflict', 'revision-limit', 'invalid-tag', 'invalid-state', 'duplicate-tag', 'deleted-id', 'v3-required', 'delete-conflict', 'trash-conflict'];

/**
 * LocalSaveResultの接続境界。要求に対応しない応答は無視し、壊れた成功応答も不明とする。
 * 呼出側の例外も元例外を渡さず、unknown/unverifiedとして通知する。
 */
export function settleSave(state: EditorState, context: SaveContext, input: unknown): EditorState {
  if (state.save.kind !== 'saving') return state;
  const attempt = state.save.attempt;
  if (context.operationId !== attempt.context.operationId || context.source !== state.source
    || context.sessionId !== state.sessionId) return state;
  const unknown = (reason: FailureReason): EditorState => immutable({ ...state,
    save: { kind: 'unknown', reason, attempt }, unresolved: [...state.unresolved, attempt] });
  try {
    if (!input || typeof input !== 'object') return unknown('invalid-response');
    const kind = Object.getOwnPropertyDescriptor(input, 'kind')?.value as unknown;
    if (kind === 'rejected' || kind === 'unknown') {
      const row = record(input, ['kind', 'reason', 'writeOutcome']);
      if (!reasons.includes(row.reason as LocalFailureReason)) return unknown('invalid-response');
      if (kind === 'unknown' && row.writeOutcome === 'unverified') return unknown(row.reason as LocalFailureReason);
      if (kind === 'rejected' && row.writeOutcome === 'not-attempted') {
        return immutable({ ...state, save: { kind: 'rejected', reason: row.reason as LocalFailureReason } });
      }
      return unknown('invalid-response');
    }
    const row = record(input, ['kind', 'value']);
    if (row.kind !== 'saved') return unknown('invalid-response');
    const value = record(row.value, ['memo', 'tagIds']);
    const memo = validateMemoData({ memos: [value.memo], tags: [], memoTags: [] }).memos[0]!;
    const tagIds = tags(value.tagIds), request = attempt.request;
    if (uuidKey(memo.id) !== uuidKey(state.id) || memo.title !== request.title || memo.body !== request.body
      || memo.deletedAt !== null || memo.revision !== (request.expectedRevision === null ? 1 : request.expectedRevision + 1)
      || tagKeys(tagIds) !== tagKeys(request.tagIds)) return unknown('invalid-response');
    // 成功は送信した値だけに対応する。送信後の編集内容を返却値で置き換えない。
    return immutable({ ...state, baseline: draft(attempt.rawDraft), expectedRevision: memo.revision, screen: 'detail', save: { kind: 'saved' } });
  } catch { return unknown('invalid-response'); }
}

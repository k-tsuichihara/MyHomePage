/** Memo Tool Ver1.1.0 — review-4 contract; implementation proposal, not deployed. */
export type UUID = string;
export type ISOInstant = string;
export type StorageMode = 'local' | 'cloud';
export const OLD_STORAGE_KEY = 'myhomepage.memo.items.v1' as const;
export const NEW_STORAGE_KEY = 'myhomepage.memo.data.v2' as const;

export interface Memo {
  id: UUID;
  title: string;
  body: string;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
  pinnedAt: ISOInstant | null;
  deletedAt: ISOInstant | null;
  revision: number; // positive JS safe integer only; reject unsafe bigint conversion
  lastRequestId: UUID | null; // cloud mutation idempotency / unknown response resolution
}
export interface Tag { id: UUID; name: string; createdAt: ISOInstant; revision: number; }
export interface MemoTagRelation { memoId: UUID; tagId: UUID; }
export interface MemoData { memos: Memo[]; tags: Tag[]; memoTags: MemoTagRelation[]; }
/** Migration metadata is in the SAME atomic localStorage value as data. */
export type MemoStorageV2 =
  | ({ version: 2; migration: { status: 'pending'; legacySnapshot: string }; } & MemoData)
  | ({ version: 2; migration: { status: 'complete'; legacySnapshot: string }; } & MemoData)
  | ({ version: 2; migration: { status: 'not-required' }; } & MemoData);
export interface MemoItemV1 {
  id: string; title: string; text: string; createdAt: string; updatedAt: string;
}

/** One immutable attempt: changing the draft requires a NEW requestId after resolution. */
export interface SubmittedSave {
  memoId: UUID;
  title: string;
  body: string;
  tagIds: UUID[]; // canonical sorted unique IDs
  expectedRevision: number | null;
  requestId: UUID;
}
export interface MutationContext {
  /** null = create only; number = update only if current revision matches */
  expectedRevision: number | null;
  /** Reuse unchanged on retry; generated once per user action. */
  requestId: UUID;
}
export interface SavedMemo { memo: Memo; tagIds: UUID[]; }
export type SaveResolution =
  | { kind: 'saved'; value: SavedMemo; currentMayDiffer: boolean }
  | { kind: 'previously-applied-deleted' }
  | { kind: 'not-applied' }
  | { kind: 'conflict'; current: SavedMemo | null }
  | { kind: 'unknown' };

/** Explicit exceptions: ConflictError, NotFoundError, PermissionError, UnknownResultError. */
export interface MemoRepository {
  load(): Promise<MemoData>;
  /** Create/update + replace tag relations atomically. Never upsert deleted IDs. */
  saveMemoWithTags(draft: Pick<Memo, 'id'|'title'|'body'>, tagIds: UUID[], ctx: MutationContext): Promise<SavedMemo>;
  /** Durable request receipt; compare immutable request via server-side digest; after permanent deletion, only a redacted receipt survives. */
  resolveSave(submitted: Readonly<SubmittedSave>): Promise<SaveResolution>;
  setPinned(memoId: UUID, pinned: boolean, ctx: MutationContext): Promise<Memo>;
  moveToTrash(memoId: UUID, ctx: MutationContext): Promise<Memo>;
  restoreMemo(memoId: UUID, ctx: MutationContext): Promise<Memo>;
  permanentlyDeleteMemo(memoId: UUID, ctx: MutationContext): Promise<void>;
  /** Snapshot list of {id,revision} shown in confirmation; all or nothing. */
  emptyTrash(expected: Array<{ id: UUID; revision: number }>, requestId: UUID): Promise<void>;
  saveTag(tag: Pick<Tag,'id'|'name'>, expectedRevision: number | null): Promise<Tag>;
  deleteTag(tagId: UUID, expectedRevision: number): Promise<void>;
}

/** App/DB conversion is explicit, not a direct cast. */
export interface DbMemoRow {
  id: UUID; user_id: UUID; title: string; body: string;
  created_at: ISOInstant; updated_at: ISOInstant;
  pinned_at: ISOInstant | null; deleted_at: ISOInstant | null;
  revision: number | string; last_request_id: UUID | null;
}
export interface DbTagRow { id: UUID; user_id: UUID; name: string; created_at: ISOInstant; revision: number | string; }
export interface DbMemoTagRow { user_id: UUID; memo_id: UUID; tag_id: UUID; }

/** Validated by shared runtime validators before storage or RPC. */
export function normalizeMemoInput(title: string, body: string): { title: string; body: string } {
  const t = title.trim();
  if (!t && !body.trim()) throw new Error('タイトルまたは本文を入力してください');
  const normalizedTitle = t || '無題';
  if ([...normalizedTitle].length > 100 || [...body].length > 10000) throw new Error('文字数の上限を超えています');
  return { title: normalizedTitle, body };
}

/** DB bigint must parse as positive Number.isSafeInteger; otherwise fail closed. */
export function parseRevision(raw: number | string): number {
  const n = typeof raw === 'string' && /^[1-9][0-9]*$/.test(raw) ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) throw new Error('revision out of safe range');
  return n;
}

/** REVIEW4: SQL memo_load_snapshot returns all 3 collections from one statement snapshot. */
export interface CloudSnapshot { memos: DbMemoRow[]; tags: DbTagRow[]; memoTags: DbMemoTagRow[]; }
export type RedactedReceipt = { status: 'previously-applied-deleted' };
/** For deleted memos, successful historical requests must not return body/title/tag content. */
export interface RequestResolutionEnvelope {
  operation: 'save' | 'pin' | 'unpin' | 'trash' | 'restore';
  payloadHash: string;
  result: SavedMemo | DbMemoRow | null;
  deletedRedacted: boolean;
}
/** A hash is a verifier, not a secret or reversible backup. Verify input contract in DB tests. */

/** Memo Tool Ver1.1.0 — review-2 contract; implementation proposal, not deployed. */
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
  revision: number; // new: 1, every mutation increments; optimistic concurrency
  lastRequestId: UUID | null; // cloud mutation idempotency / unknown response resolution
}
export interface Tag { id: UUID; name: string; createdAt: ISOInstant; revision: number; }
export interface MemoTagRelation { memoId: UUID; tagId: UUID; }
export interface MemoData { memos: Memo[]; tags: Tag[]; memoTags: MemoTagRelation[]; }
/** Migration metadata is in the SAME atomic localStorage value as data. */
export type MemoStorageV2 =
  | ({ version: 2; migration: { status: 'pending'; legacySnapshot: string }; } & MemoData)
  | ({ version: 2; migration: { status: 'complete'; legacySnapshot: string }; } & MemoData);
export interface MemoItemV1 {
  id: string; title: string; text: string; createdAt: string; updatedAt: string;
}

export interface MutationContext {
  /** null = create only; number = update only if current revision matches */
  expectedRevision: number | null;
  /** Reuse unchanged on retry; generated once per user action. */
  requestId: UUID;
}
export interface SavedMemo { memo: Memo; tagIds: UUID[]; }
export type SaveResolution =
  | { kind: 'saved'; value: SavedMemo }
  | { kind: 'not-applied' }
  | { kind: 'conflict'; current: SavedMemo | null }
  | { kind: 'unknown' };

/** Explicit exceptions: ConflictError, NotFoundError, PermissionError, UnknownResultError. */
export interface MemoRepository {
  load(): Promise<MemoData>;
  /** Create/update + replace tag relations atomically. Never upsert deleted IDs. */
  saveMemoWithTags(draft: Pick<Memo, 'id'|'title'|'body'>, tagIds: UUID[], ctx: MutationContext): Promise<SavedMemo>;
  /** Read after ambiguous network error; compare requestId and persisted state. */
  resolveSave(memoId: UUID, requestId: UUID): Promise<SaveResolution>;
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
  revision: number; last_request_id: UUID | null;
}
export interface DbTagRow { id: UUID; user_id: UUID; name: string; created_at: ISOInstant; revision: number; }
export interface DbMemoTagRow { user_id: UUID; memo_id: UUID; tag_id: UUID; }

/** Validated by shared runtime validators before storage or RPC. */
export function normalizeMemoInput(title: string, body: string): { title: string; body: string } {
  const t = title.trim();
  if (!t && !body.trim()) throw new Error('タイトルまたは本文を入力してください');
  const normalizedTitle = t || '無題';
  if ([...normalizedTitle].length > 100 || [...body].length > 10000) throw new Error('文字数の上限を超えています');
  return { title: normalizedTitle, body };
}

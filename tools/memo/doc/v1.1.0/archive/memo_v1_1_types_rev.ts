/** Memo Tool Ver1.1.0 — reviewed design contract (not yet deployed). */
export type ISODateTime = string; // runtime: valid ISO 8601 instant
export type UUID = string; // runtime: canonical UUID, generated via crypto.randomUUID()

export interface Memo {
  id: UUID;
  title: string;
  body: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  pinnedAt: ISODateTime | null;
  deletedAt: ISODateTime | null;
}
export interface Tag { id: UUID; name: string; createdAt: ISODateTime; }
export interface MemoTagRelation { memoId: UUID; tagId: UUID; }
export interface MemoStorageV2 {
  version: 2;
  memos: Memo[];
  tags: Tag[];
  memoTags: MemoTagRelation[];
}
export interface MemoItemV1 {
  id: string;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

/** All mutations are confirmed by persistence before UI shows success. */
export interface MemoRepository {
  load(): Promise<MemoStorageV2>; // throws on missing permissions, corrupt data, network errors
  /** Atomic memo + tag association replacement. No partial success. */
  saveMemoWithTags(memo: Memo, tagIds: UUID[]): Promise<void>;
  /** pinnedAt = current time for pin, null for unpin; updates updatedAt. */
  setPinned(memoId: UUID, pinnedAt: ISODateTime | null): Promise<void>;
  moveToTrash(memoId: UUID, deletedAt: ISODateTime): Promise<void>;
  restoreMemo(memoId: UUID): Promise<void>;
  permanentlyDeleteMemo(memoId: UUID): Promise<void>;
  /** Bulk delete must be atomic (or explicitly report per-item failures). */
  emptyTrash(): Promise<void>;
  saveTag(tag: Tag): Promise<void>;
  deleteTag(tagId: UUID): Promise<void>;
}

export type StorageMode = 'local' | 'cloud';
export const OLD_STORAGE_KEY = 'myhomepage.memo.items.v1';
export const NEW_STORAGE_KEY = 'myhomepage.memo.data.v2';

/** UI policy: trim before save, use 無題 for blank title only when body nonblank. */
export function normalizeMemoInput(title: string, body: string): { title: string; body: string } {
  const t = title.trim();
  const b = body.trim();
  if (!t && !b) throw new Error('タイトルまたは本文を入力してください');
  const normalizedTitle = t || '無題';
  if (Array.from(normalizedTitle).length > 100 || Array.from(body).length > 10000) {
    throw new Error('文字数の上限を超えています');
  }
  return { title: normalizedTitle, body }; // preserve body whitespace
}

/** Domain subset of doc/v1.1.0/memo_v1_1_types_review8.ts.
 * Aliases do not validate external data; runtime snapshot validation is a later PR.
 */
export type UUID = string;
export type ISOInstant = string;

export interface Memo {
  id: UUID;
  title: string;
  body: string;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
  pinnedAt: ISOInstant | null;
  deletedAt: ISOInstant | null;
  revision: number;
  lastRequestId: UUID | null;
}

export interface Tag {
  id: UUID;
  name: string;
  createdAt: ISOInstant;
  revision: number;
}

export interface MemoTagRelation { memoId: UUID; tagId: UUID; }
export interface MemoData { memos: Memo[]; tags: Tag[]; memoTags: MemoTagRelation[]; }
export interface ValidatedMemoInput { title: string; body: string; }

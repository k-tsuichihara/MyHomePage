import type { MemoData } from './types';

/** 旧IDはUUIDとは限らない。移行前の値を保持するための旧形式。 */
export interface MemoItemV1 {
  id: string; title: string; text: string; createdAt: string; updatedAt: string;
}
export type MemoStorageV2 =
  | (MemoData & { version: 2; migration: { status: 'pending'; legacySnapshot: string } })
  | (MemoData & { version: 2; migration: { status: 'complete'; legacySnapshot: string } })
  | (MemoData & { version: 2; migration: { status: 'not-required' } });
/** DBからの生の表現を保持する型。camelCase変換やrevision数値化は後続アダプタの責務。 */
export interface DbMemoRow {
  id: string; user_id: string; title: string; body: string;
  created_at: string; updated_at: string; pinned_at: string | null; deleted_at: string | null;
  revision: number | string; last_request_id: string | null;
}
export interface DbTagRow {
  id: string; user_id: string; name: string; created_at: string; revision: number | string;
}
export interface DbMemoTagRow { user_id: string; memo_id: string; tag_id: string }
export interface CloudSnapshot { memos: DbMemoRow[]; tags: DbTagRow[]; memoTags: DbMemoTagRow[] }

/**
 * 検証成功と通常利用可能な状態を区別する。pendingのまま通常画面へ進めない。
 * complete／not-requiredも書込・移行の許可や実localStorageの状態を保証するものではない。
 * legacyItemsはlegacySnapshotの解析・全件検証結果で、現データとの移行照合は後続の責務。
 */
export type LocalV2ValidationResult =
  | { kind: 'validated-pending'; value: Extract<MemoStorageV2, { migration: { status: 'pending' } }>; legacyItems: MemoItemV1[] }
  | { kind: 'validated-complete'; value: Extract<MemoStorageV2, { migration: { status: 'complete' } }>; legacyItems: MemoItemV1[] }
  | { kind: 'validated-not-required'; value: Extract<MemoStorageV2, { migration: { status: 'not-required' } }> };

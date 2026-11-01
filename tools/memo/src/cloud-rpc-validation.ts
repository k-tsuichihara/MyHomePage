import { array, record, reject, unique, uuid, uuidKey } from './read-primitives';
import { validateCloudSnapshot } from './snapshot-validation';
import type { DbMemoRow, DbTagRow } from './read-types';
import type { Memo, MemoData, Tag } from './types';

/** 固定理由だけを上位へ渡し、DB行や元例外を診断文字列に含めない。 */
export class CloudOwnerMismatch extends Error { constructor() { super('Cloud owner mismatch'); } }
function checkOwner(raw: unknown, owner: string): void {
  if (raw === null || typeof raw !== 'object') return reject('structure');
  const descriptor = Object.getOwnPropertyDescriptor(raw, 'user_id');
  if (!descriptor || !('value' in descriptor)) return reject('structure');
  if (uuidKey(uuid(descriptor.value)) !== uuidKey(owner)) throw new CloudOwnerMismatch();
}
function memo(row: DbMemoRow): Memo {
  return { id: row.id, title: row.title, body: row.body, createdAt: row.created_at, updatedAt: row.updated_at,
    pinnedAt: row.pinned_at, deletedAt: row.deleted_at, revision: Number(row.revision), lastRequestId: row.last_request_id };
}
function tag(row: DbTagRow): Tag { return { id: row.id, name: row.name, createdAt: row.created_at, revision: Number(row.revision) }; }

/** 所有者を含む全行を検証してから変換する。無効行の除外やunsafe bigintの丸めは行わない。 */
export function cloudSnapshot(raw: unknown, owner: string): MemoData {
  const root = record(raw, ['memos', 'tags', 'memoTags']);
  for (const rows of [root.memos, root.tags, root.memoTags]) for (const row of array(rows)) checkOwner(row, owner);
  const valid = validateCloudSnapshot(raw, owner);
  return { memos: valid.memos.map(memo), tags: valid.tags.map(tag),
    memoTags: valid.memoTags.map(row => ({ memoId: row.memo_id, tagId: row.tag_id })) };
}
/** 単独行はsnapshot検証器の全フィールド制約を再利用する。現在のタグ存在照会はしない。 */
export function cloudMemo(raw: unknown, owner: string): Memo {
  return cloudSnapshot({ memos: [raw], tags: [], memoTags: [] }, owner).memos[0]!;
}
export function cloudTag(raw: unknown, owner: string): Tag {
  return cloudSnapshot({ memos: [], tags: [raw], memoTags: [] }, owner).tags[0]!;
}
export function tagIds(raw: unknown): string[] {
  const values = array(raw).map(uuid); unique(values.map(uuidKey)); return values;
}
/** 比較だけUUIDを大小文字同値にする。受理したDB値の原表記は保持する。 */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.map(uuidKey).sort().join('/') === b.map(uuidKey).sort().join('/');
}
/** 検証で再構築した値だけを凍結し、利用者の元オブジェクトは凍結しない。 */
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

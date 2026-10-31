import { LocalDataError } from './local-data-store';
import { uuidKey, uuid, instant } from './read-primitives';
import { validateLocalV3 } from './local-format';
import { MAX_RESTORE_BYTES } from './local-restore';
import type { RestoreRow, RestoreV3 } from './local-restore';
import type { Memo } from './types';

/** 正常なバックアップ行でも、現在履歴にない元IDは単件回復の対象にしない。 */
export function canRecover(row: RestoreRow, current: RestoreV3): boolean {
  return row.memo !== null && current.deletedMemoIds.some(id => uuidKey(id) === uuidKey(row.memo!.id));
}
export function recoverableTags(ids: readonly string[], current: RestoreV3): string[] {
  const wanted = new Set(ids.map(uuidKey));
  return current.tags.filter(tag => wanted.has(uuidKey(tag.id))).map(tag => tag.id);
}
export const recoveryTagSet = (ids: readonly string[]) => ids.map(uuidKey).sort().join('/');

/** 最新値を基に一件だけ追加する。プレビュー全体の不変は要求せず、対象集合だけ照合する。 */
export function recoverMemo(current: RestoreV3, source: Memo, sourceTags: readonly string[], expectedTags: readonly string[], idValue: string, nowValue: string): RestoreV3 {
  if (!current.deletedMemoIds.some(id => uuidKey(id) === uuidKey(source.id))) throw new LocalDataError('not-found');
  const tags = recoverableTags(sourceTags, current);
  if (recoveryTagSet(tags) !== recoveryTagSet(expectedTags)) throw new LocalDataError('invalid-tag');
  const id = uuid(idValue), key = uuidKey(id);
  if (current.memos.some(m => uuidKey(m.id) === key)) throw new LocalDataError('id-exists');
  if (current.deletedMemoIds.some(value => uuidKey(value) === key)) throw new LocalDataError('deleted-id');
  const now = instant(nowValue);
  const memo: Memo = { ...source, id, createdAt: now, updatedAt: now, pinnedAt: null, deletedAt: null, revision: 1, lastRequestId: null };
  const checked = validateLocalV3({ ...current, memos: [...current.memos, memo],
    memoTags: [...current.memoTags, ...tags.map(tagId => ({ memoId: id, tagId }))] });
  if (checked.kind === 'validated-pending') throw new LocalDataError('recovery-required');
  if (new TextEncoder().encode(JSON.stringify(checked.value)).byteLength > MAX_RESTORE_BYTES) throw new LocalDataError('invalid-input');
  return checked.value as RestoreV3;
}

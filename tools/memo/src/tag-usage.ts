import { validateMemoData } from './snapshot-validation';
import { uuidKey } from './read-primitives';

/** 件数を永続化せず、整合したスナップショットから通常メモの関連だけを数える。 */
export function countTagUsage(input: unknown): Array<{ tagId: string; count: number }> {
  const data = validateMemoData(input);
  const normal = new Set(data.memos.filter(row => row.deletedAt === null).map(row => uuidKey(row.id)));
  const counts = new Map<string, number>();
  for (const relation of data.memoTags) {
    if (normal.has(uuidKey(relation.memoId))) {
      const key = uuidKey(relation.tagId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return data.tags.map(tag => ({ tagId: tag.id, count: counts.get(uuidKey(tag.id)) ?? 0 }));
}

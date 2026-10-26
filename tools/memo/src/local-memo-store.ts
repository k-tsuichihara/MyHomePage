import { normalizeMemoInput } from './input';
import { createLocalDataStore, LocalDataError } from './local-data-store';
import type { LocalDataDependencies, LocalWriteFailure } from './local-data-store';
import { array, instant, nullable, record, revision, uuid, uuidKey } from './read-primitives';
import type { Memo } from './types';

interface LocalSaveRequest {
  id: string; title: string; body: string; tagIds: string[]; expectedRevision: number | null; requestId: string;
}
export type LocalSaveResult = { kind: 'saved'; value: { memo: Memo; tagIds: string[] } } | LocalWriteFailure;

/** 完全なMemoRepositoryではなく、今回承認されたload/saveだけを提供する。 */
export function createLocalMemoStore(deps: LocalDataDependencies & { now: () => string }) {
  const data = createLocalDataStore(deps);
  // requestIdだけをインスタンス寿命中保持する。内容・receiptの永続化や暗黙の追い出しはしない。
  const used = new Set<string>();

  function accept(input: unknown): LocalSaveRequest {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new LocalDataError('invalid-input');
    const descriptor = Object.getOwnPropertyDescriptor(input, 'requestId');
    if (!descriptor || !('value' in descriptor)) throw new LocalDataError('invalid-input');
    const requestId = uuid(descriptor.value);
    const key = uuidKey(requestId);
    if (used.has(key)) throw new LocalDataError('request-id-reused');
    // 他の検証や最初のawaitより前に予約する。入力不正・ロック失敗でも予約は戻さない。
    used.add(key);
    const row = record(input, ['id', 'title', 'body', 'tagIds', 'expectedRevision', 'requestId']);
    const normalized = normalizeMemoInput(row.title as string, row.body as string);
    const tagIds = array(row.tagIds).map(uuid);
    if (new Set(tagIds.map(uuidKey)).size !== tagIds.length) throw new LocalDataError('invalid-tag');
    return { id: uuid(row.id), ...normalized, tagIds, expectedRevision: nullable(row.expectedRevision, raw => revision(raw) as number), requestId };
  }

  return {
    load: data.load,
    /**
     * 受付時に入力を独立した値へ固定する。書込後の異常を同一要求の自動再送で回避しない。
     * lastRequestIdは新規ではnull、更新では既存値保持とし、試行の判定には使わない。
     */
    async save(input: unknown): Promise<LocalSaveResult> {
      let request: LocalSaveRequest;
      try { request = accept(input); }
      catch (error) {
        return { kind: 'rejected', reason: error instanceof LocalDataError ? error.reason : 'invalid-input', writeOutcome: 'not-attempted' };
      }
      const result = await data.transact(current => {
        const key = uuidKey(request.id);
        const index = current.memos.findIndex(row => uuidKey(row.id) === key);
        const existing = current.memos[index];
        if (request.expectedRevision === null) {
          if (existing) throw new LocalDataError('id-exists');
        } else {
          if (!existing) throw new LocalDataError('not-found');
          if (existing.deletedAt !== null) throw new LocalDataError('trashed');
          if (existing.revision !== request.expectedRevision) throw new LocalDataError('conflict');
          if (existing.revision === Number.MAX_SAFE_INTEGER) throw new LocalDataError('revision-limit');
        }
        const tagMap = new Map(current.tags.map(row => [uuidKey(row.id), row.id]));
        const tagIds = request.tagIds.map(id => {
          const stored = tagMap.get(uuidKey(id));
          if (!stored) throw new LocalDataError('invalid-tag');
          return stored;
        }).sort((a, b) => uuidKey(a) < uuidKey(b) ? -1 : uuidKey(a) > uuidKey(b) ? 1 : 0);
        const now = instant(deps.now());
        const memo: Memo = existing
          ? { ...existing, title: request.title, body: request.body, updatedAt: now, revision: existing.revision + 1 }
          : { id: request.id, title: request.title, body: request.body, createdAt: now, updatedAt: now,
            pinnedAt: null, deletedAt: null, revision: 1, lastRequestId: null };
        const memos = [...current.memos];
        if (existing) memos[index] = memo; else memos.push(memo);
        return { ...current, memos, memoTags: [...current.memoTags.filter(row => uuidKey(row.memoId) !== key),
          ...tagIds.map(tagId => ({ memoId: memo.id, tagId }))] };
      });
      if (result.kind !== 'written') return result;
      const memo = result.value.memos.find(row => uuidKey(row.id) === uuidKey(request.id))!;
      return { kind: 'saved', value: { memo, tagIds: result.value.memoTags.filter(row => uuidKey(row.memoId) === uuidKey(memo.id)).map(row => row.tagId) } };
    },
  };
}

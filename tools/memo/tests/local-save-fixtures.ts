import { createLocalMemoStore } from '../src/local-memo-store';
import { NEW_STORAGE_KEY } from '../src/local-migration';
import type { ReadyLocalData } from '../src/local-data-store';
import { MemoryStorage, QueueLocks } from './migration-fixtures';

/** 実データに由来しない固定IDと時計を使い、期待する保存内容を独立に記述する。 */
export const MEMO = 'abcdef00-0000-4000-8000-000000000001';
export const OTHER = 'abcdef00-0000-4000-8000-000000000002';
export const TAG = 'abcdef00-0000-4000-8000-000000000003';
export const TAG2 = 'abcdef00-0000-4000-8000-000000000004';
export const PREVIOUS = 'abcdef00-0000-4000-8000-000000000005';
export const NOW = '2026-10-26T12:00:00.123Z';
export const BEFORE = '2024-02-29T00:00:00+09:00';
export const token = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
export function state(): ReadyLocalData {
  return { version: 2, migration: { status: 'not-required' },
    memos: [{ id: MEMO, title: '元のタイトル', body: ' 本文\n', createdAt: BEFORE, updatedAt: BEFORE,
      pinnedAt: BEFORE, deletedAt: null, revision: 3, lastRequestId: PREVIOUS },
    { id: OTHER, title: '対象外', body: '', createdAt: BEFORE, updatedAt: BEFORE,
      pinnedAt: null, deletedAt: null, revision: 1, lastRequestId: null }],
    tags: [{ id: TAG, name: 'Tag', createdAt: BEFORE, revision: 1 }, { id: TAG2, name: '別タグ', createdAt: BEFORE, revision: 2 }],
    memoTags: [{ memoId: MEMO, tagId: TAG }, { memoId: OTHER, tagId: TAG }] };
}
export function request(n = 1) {
  return { id: MEMO, title: ' 新タイトル ', body: ' \t新本文\n ', tagIds: [TAG2], expectedRevision: 3 as number | null, requestId: token(n) };
}
export function saveFixture(initial: ReadyLocalData | null = state()) {
  const storage = new MemoryStorage(), locks = new QueueLocks();
  if (initial) storage.values.set(NEW_STORAGE_KEY, JSON.stringify(initial));
  const deps = { storage, locks, now: () => NOW };
  return { storage, locks, deps, store: createLocalMemoStore(deps) };
}

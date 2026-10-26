import { LocalDataError } from './local-data-store';
import type { ReadyLocalData } from './local-data-store';
import { instant, record, revision, uuid, uuidKey } from './read-primitives';

type Action = 'pin' | 'unpin' | 'trash' | 'restore';
export function parseStateRequest(input: unknown) {
  const row = record(input, ['id', 'action', 'expectedRevision', 'requestId']);
  if (!['pin', 'unpin', 'trash', 'restore'].includes(row.action as string)) throw new LocalDataError('invalid-input');
  return { id: uuid(row.id), action: row.action as Action, expectedRevision: revision(row.expectedRevision) as number };
}

/** review8 SQLと同じ状態遷移。trash/restoreでピン日時やタグ関連を消さない。 */
export function changeLocalState(current: ReadyLocalData, request: ReturnType<typeof parseStateRequest>, clock: () => string): ReadyLocalData {
  const index = current.memos.findIndex(row => uuidKey(row.id) === uuidKey(request.id));
  const memo = current.memos[index];
  if (!memo) throw new LocalDataError('not-found');
  if (memo.revision !== request.expectedRevision) throw new LocalDataError('conflict');
  if ((request.action === 'restore') !== (memo.deletedAt !== null)) throw new LocalDataError('invalid-state');
  if (memo.revision === Number.MAX_SAFE_INTEGER) throw new LocalDataError('revision-limit');
  const now = instant(clock());
  const memos = [...current.memos];
  memos[index] = { ...memo, updatedAt: now, revision: memo.revision + 1,
    pinnedAt: request.action === 'pin' ? now : request.action === 'unpin' ? null : memo.pinnedAt,
    deletedAt: request.action === 'trash' ? now : request.action === 'restore' ? null : memo.deletedAt };
  return { ...current, memos };
}

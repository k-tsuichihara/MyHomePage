import { LocalDataError } from './local-data-store';
import type { ReadyLocalData } from './local-data-store';
import { array, record, revision, unique, uuid, uuidKey } from './read-primitives';

export interface DeleteTarget { id: string; revision: number }
export interface DeleteRequest { scope: 'single' | 'all'; targets: DeleteTarget[] }
export function parseDeleteTargets(input: unknown): DeleteTarget[] {
  const targets = array(input).map(raw => {
    const row = record(raw, ['id', 'revision']);
    return { id: uuid(row.id), revision: revision(row.revision) as number };
  });
  unique(targets.map(row => uuidKey(row.id))); return targets;
}
export function parsePermanentDelete(input: unknown): DeleteRequest {
  const row = record(input, ['id', 'expectedRevision', 'requestId']);
  return { scope: 'single', targets: [{ id: uuid(row.id), revision: revision(row.expectedRevision) as number }] };
}
export function parseEmptyTrash(input: unknown): DeleteRequest {
  const row = record(input, ['targets', 'requestId']);
  return { scope: 'all', targets: parseDeleteTargets(row.targets) };
}
/** 表示順・UUID表記差を除いて、IDとrevisionの全組を照合する。部分一致は許可しない。 */
export function sameTargets(a: readonly DeleteTarget[], b: readonly DeleteTarget[]): boolean {
  if (a.length !== b.length) return false;
  const expected = new Map(a.map(row => [uuidKey(row.id), row.revision]));
  return expected.size === a.length && new Set(b.map(row => uuidKey(row.id))).size === b.length
    && b.every(row => expected.get(uuidKey(row.id)) === row.revision);
}
/** 最新の検証済みv3だけを変換する。削除前に対象全件を検証し、メモと関連とID履歴を一体で返す。 */
export function removeTrash(current: ReadyLocalData, request: DeleteRequest): ReadyLocalData {
  if (current.version !== 3) throw new LocalDataError('v3-required');
  const trash = current.memos.filter(memo => memo.deletedAt !== null);
  if (request.scope === 'single' && request.targets.length !== 1) throw new LocalDataError('invalid-input');
  if (request.scope === 'all' && !sameTargets(request.targets, trash)) throw new LocalDataError('trash-conflict');
  const wanted = new Set(request.targets.map(row => uuidKey(row.id)));
  const byId = new Map(current.memos.map(row => [uuidKey(row.id), row]));
  for (const target of request.targets) {
    const memo = byId.get(uuidKey(target.id));
    if (!memo || memo.deletedAt === null || memo.revision !== target.revision) throw new LocalDataError('delete-conflict');
  }
  // 原表記と保存順で記録し、呼出側のID表記や並び替えで履歴を変えない。
  return { ...current, memos: current.memos.filter(row => !wanted.has(uuidKey(row.id))),
    memoTags: current.memoTags.filter(row => !wanted.has(uuidKey(row.memoId))),
    deletedMemoIds: [...current.deletedMemoIds, ...current.memos.filter(row => wanted.has(uuidKey(row.id))).map(row => row.id)] };
}

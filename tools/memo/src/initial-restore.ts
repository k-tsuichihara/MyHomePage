import { parseBackupBytes, BackupInputError } from './backup-json';
import { array, record, instant } from './read-primitives';
import { validateLocalV3 } from './local-format';
import type { RestoreV3 } from './local-restore';
import { MAX_RESTORE_BYTES } from './local-restore';
import { immutable } from './editor-state';

/** 全件を忠実に復元する専用入口。行除外・タグ統合を行う追加型診断を経由しない。 */
export function parseInitialBackup(bytes: Uint8Array): { candidate: RestoreV3; exportedAt: string } {
  try {
    const envelope = record(parseBackupBytes(bytes), ['format', 'backupVersion', 'sourceStorageVersion', 'exportedAt', 'data']);
    if (envelope.format !== 'myhomepage.memo.local-backup' || envelope.backupVersion !== 1 || envelope.sourceStorageVersion !== 3) throw new BackupInputError('format');
    const exportedAt = instant(envelope.exportedAt);
    const data = record(envelope.data, ['memos', 'tags', 'memoTags', 'deletedMemoIds']);
    for (const [key, limit] of [['memos', 10000], ['tags', 5000], ['memoTags', 100000], ['deletedMemoIds', 100000]] as const)
      if (array(data[key]).length > limit) throw new BackupInputError('count');
    const candidate = validateInitialCandidate({ version: 3, migration: { status: 'not-required' }, ...data });
    return immutable({ candidate, exportedAt });
  } catch (error) { throw error instanceof BackupInputError ? error : new BackupInputError('invalid-data'); }
}
/** 保存直前にも同じ候補制約を適用する。管理情報への任意項目追加は認めない。 */
export function validateInitialCandidate(raw: unknown): RestoreV3 {
  const checked = validateLocalV3(raw);
  if (checked.kind !== 'validated-not-required') throw new BackupInputError('migration');
  const value = checked.value as RestoreV3;
  if (value.memos.length > 10000 || value.tags.length > 5000 || value.memoTags.length > 100000 || value.deletedMemoIds.length > 100000) throw new BackupInputError('count');
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_RESTORE_BYTES) throw new BackupInputError('candidate-size');
  return immutable(value);
}

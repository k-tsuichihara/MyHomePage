import { withLocalDataLock, LocalLocksUnavailableError } from './local-lock';
import type { LocalLockManager } from './local-lock';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from './local-migration';
import { parseLocalFormatJson, validateLocalV3 } from './local-format';
import { instant } from './read-primitives';

export const MAX_BACKUP_BYTES = 10_485_760;
export type BackupFailure = 'locks-unavailable' | 'lock-failure' | 'read-failure' | 'missing-data'
  | 'invalid-data' | 'v3-required' | 'pending' | 'snapshot-changed' | 'generation-failure' | 'too-large';
export type BackupResult = { kind: 'prepared'; json: string; filename: string; bytes: number }
  | { kind: 'failed'; reason: BackupFailure };

/** 書込能力を受け取らず、共通ロック下で検証した時点の全体を出力する。 */
export function createLocalBackup(deps: {
  storage: { getItem(key: string): string | null }; locks: LocalLockManager | undefined; now: () => string;
}) {
  const { storage, locks, now } = deps;
  return async (): Promise<BackupResult> => {
    let reason: BackupFailure = 'lock-failure';
    try {
      const captured = await withLocalDataLock(locks, async () => {
        reason = 'read-failure';
        const legacy = storage.getItem(OLD_STORAGE_KEY), raw = storage.getItem(NEW_STORAGE_KEY);
        if (raw === null) return { kind: 'failed', reason: 'missing-data' } as const;
        reason = 'invalid-data';
        const checked = parseLocalFormatJson(raw);
        if (checked.value.version !== 3) return { kind: 'failed', reason: 'v3-required' } as const;
        if (checked.kind === 'validated-pending') return { kind: 'failed', reason: 'pending' } as const;
        reason = 'read-failure';
        if (storage.getItem(OLD_STORAGE_KEY) !== legacy || storage.getItem(NEW_STORAGE_KEY) !== raw)
          return { kind: 'failed', reason: 'snapshot-changed' } as const;
        return { kind: 'captured', value: checked.value } as const;
      });
      if (captured.kind === 'failed') return captured;
      reason = 'generation-failure';
      const exportedAt = instant(now());
      const { memos, tags, memoTags, deletedMemoIds } = captured.value;
      const json = JSON.stringify({ format: 'myhomepage.memo.local-backup', backupVersion: 1,
        sourceStorageVersion: 3, exportedAt, data: { memos, tags, memoTags, deletedMemoIds } });
      const bytes = new TextEncoder().encode(json).byteLength;
      if (bytes > MAX_BACKUP_BYTES) return { kind: 'failed', reason: 'too-large' };
      // 生成結果の再解析で全フィールドの値を再検証する。移行metadataはファイルへ含めない。
      const output = JSON.parse(json) as { data: Record<string, unknown> };
      validateLocalV3({ version: 3, migration: captured.value.migration, ...output.data });
      const timestamp = new Date(exportedAt).toISOString().replace(/[:.]/g, '-');
      return { kind: 'prepared', json, bytes, filename: `memo-backup-${timestamp}.json` };
    } catch (error) {
      return { kind: 'failed', reason: error instanceof LocalLocksUnavailableError ? 'locks-unavailable' : reason };
    }
  };
}

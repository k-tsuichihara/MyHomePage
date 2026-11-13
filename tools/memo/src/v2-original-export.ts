import { withLocalDataLock, LocalLocksUnavailableError } from './local-lock';
import type { LocalLockManager } from './local-lock';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from './local-migration';
import { parseLocalV2Json } from './local-validation';
import { instant } from './read-primitives';
import { MAX_BACKUP_BYTES } from './local-backup';
import type { BackupResult, BackupFailure } from './local-backup';

/** v3バックアップとは別の移行前原値退避。書込能力を受け取らない。 */
export function createV2OriginalExport(deps: {
  storage: { getItem(key: string): string | null };
  locks: LocalLockManager | undefined;
  now: () => string;
  /** 生値はUIへ渡さず、製品更新サービス内で退避対象を固定するためだけに使う。 */
  captured?: (value: Readonly<{ legacy: string | null; raw: string }>) => void;
}) {
  return async (): Promise<BackupResult> => {
    let reason: BackupFailure = 'lock-failure';
    try {
      const captured = await withLocalDataLock(deps.locks, async () => {
        reason = 'read-failure';
        const legacy = deps.storage.getItem(OLD_STORAGE_KEY), raw = deps.storage.getItem(NEW_STORAGE_KEY);
        if (raw === null) throw new Error('missing');
        reason = 'invalid-data';
        const checked = parseLocalV2Json(raw);
        if (checked.kind === 'validated-pending') { reason = 'pending'; throw new Error('pending'); }
        reason = 'read-failure';
        const unchanged = deps.storage.getItem(OLD_STORAGE_KEY) === legacy && deps.storage.getItem(NEW_STORAGE_KEY) === raw;
        if (!unchanged) { reason = 'snapshot-changed'; throw new Error('changed'); }
        return { legacy, raw };
      });
      reason = 'generation-failure';
      const exportedAt = instant(deps.now());
      const json = JSON.stringify({ format: 'myhomepage.memo.v2-original', exportVersion: 1, exportedAt,
        values: { [OLD_STORAGE_KEY]: captured.legacy, [NEW_STORAGE_KEY]: captured.raw } });
      const bytes = new TextEncoder().encode(json).byteLength;
      if (bytes > MAX_BACKUP_BYTES) return { kind: 'failed', reason: 'too-large' };
      deps.captured?.(Object.freeze(captured));
      return { kind: 'prepared', json, bytes, filename: `memo-v2-original-${new Date(exportedAt).toISOString().replace(/[:.]/g, '-')}.json` };
    } catch (error) {
      return { kind: 'failed', reason: error instanceof LocalLocksUnavailableError ? 'locks-unavailable' : reason };
    }
  };
}

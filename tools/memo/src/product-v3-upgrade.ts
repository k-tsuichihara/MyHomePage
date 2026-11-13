import { createV2OriginalExport } from './v2-original-export';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from './local-migration';
import type { MigrationStorage } from './local-migration';
import { withLocalDataLock } from './local-lock';
import type { LocalLockManager } from './local-lock';
import { parseLocalV2Json } from './local-validation';
import { parseLocalFormatJson, validateLocalV3 } from './local-format';

export type UpgradeState = 'idle' | 'prepared' | 'writing' | 'updated' | 'rejected' | 'unknown' | 'legacy-changed' | 'disposed';

/** 退避対象を閉包で固定し、更新後も同じ保存境界で旧キー変更を検出する。 */
export function createProductV3Upgrade(deps: { storage: MigrationStorage; locks: LocalLockManager | undefined; now: () => string }) {
  let state: UpgradeState = 'idle';
  let captured: Readonly<{ legacy: string | null; raw: string }> | null = null;
  let baseline: string | null | undefined;
  let epoch = 0;
  const checkLegacy = () => {
    if (state === 'disposed' || state === 'legacy-changed' || state === 'unknown') throw new Error('stopped');
    if (baseline !== undefined && deps.storage.getItem(OLD_STORAGE_KEY) !== baseline) {
      state = 'legacy-changed'; throw new Error('legacy-changed');
    }
  };
  const storage: MigrationStorage = {
    getItem(key) { checkLegacy(); return deps.storage.getItem(key); },
    setItem(key, value) { checkLegacy(); deps.storage.setItem(key, value); },
  };
  return {
    storage,
    getState: () => state,
    async prepare() {
      if (['writing', 'unknown', 'updated', 'legacy-changed', 'disposed'].includes(state)) return { kind: 'failed' as const, reason: 'read-failure' as const };
      const operation = ++epoch; captured = null; state = 'idle';
      const result = await createV2OriginalExport({ ...deps, captured(value) {
        if (operation === epoch && state !== 'disposed') captured = value;
      } })();
      if (operation !== epoch) return { kind: 'failed' as const, reason: 'read-failure' as const };
      state = result.kind === 'prepared' ? 'prepared' : 'rejected';
      return result;
    },
    async confirm() {
      if (state !== 'prepared' || !captured) return;
      const expected = captured; captured = null; state = 'writing'; const operation = ++epoch;
      let attempted = false;
      try {
        await withLocalDataLock(deps.locks, async () => {
          if (operation !== epoch) throw new Error('disposed');
          const assert = (raw: string) => {
            if (deps.storage.getItem(OLD_STORAGE_KEY) !== expected.legacy || deps.storage.getItem(NEW_STORAGE_KEY) !== raw) throw new Error('changed');
          };
          assert(expected.raw);
          const checked = parseLocalV2Json(expected.raw);
          if (checked.kind === 'validated-pending') throw new Error('pending');
          const candidate = validateLocalV3({ ...checked.value, version: 3, deletedMemoIds: [] });
          const next = JSON.stringify(candidate.value);
          assert(expected.raw); attempted = true;
          deps.storage.setItem(NEW_STORAGE_KEY, next);
          assert(next); parseLocalFormatJson(next);
          baseline = expected.legacy;
        });
        if (operation === epoch) state = 'updated';
      } catch { if (operation === epoch) state = attempted ? 'unknown' : 'rejected'; }
    },
    async diagnose() {
      try {
        if (state === 'disposed') return 'unavailable';
        if (state !== 'unknown') checkLegacy();
        return await withLocalDataLock(deps.locks, async () => {
          const raw = deps.storage.getItem(NEW_STORAGE_KEY);
          if (raw === null) return 'absent';
          const checked = parseLocalFormatJson(raw);
          return checked.kind === 'validated-pending' ? 'pending' : checked.value.version === 3 ? 'v3' : 'v2';
        });
      } catch { return 'unavailable'; }
    },
    dispose() { ++epoch; captured = null; state = 'disposed'; },
  };
}

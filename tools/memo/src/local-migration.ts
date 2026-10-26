import { parseLegacyJson } from './legacy-validation';
import { parseLocalV2Json } from './local-validation';
import { LocalLocksUnavailableError, withLocalDataLock } from './local-lock';
import type { LocalLockManager } from './local-lock';
import { completeMigration, createPendingMigration, validatePendingMigration } from './migration';
import type { CompleteMigration, PendingMigration } from './migration';
import type { LocalV2ValidationResult } from './read-types';

export const OLD_STORAGE_KEY = 'myhomepage.memo.items.v1';
export const NEW_STORAGE_KEY = 'myhomepage.memo.data.v2';

/** 旧キーへの書込・削除は呼出側からも要求しない。実保存先の取得は後続の接続層の責務。 */
export interface MigrationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface MigrationDependencies {
  storage: MigrationStorage;
  locks: LocalLockManager | undefined;
  createId: () => string;
}
type Phase = 'lock' | 'inspect' | 'prepare' | 'pending-write' | 'pending-readback' | 'complete-write' | 'complete-readback';
type Reason = 'locks-unavailable' | 'lock-failure' | 'approval-changed' | 'recovery-required'
  | 'invalid-data' | 'uuid-failure' | 'storage-failure' | 'snapshot-changed';
export interface RemainingState {
  legacy: 'absent' | 'present' | 'unreadable';
  v2: 'absent' | 'pending' | 'complete' | 'not-required' | 'invalid' | 'unreadable';
}
type Existing = Exclude<LocalV2ValidationResult, { kind: 'validated-pending' }>;
export type MigrationResult =
  | { kind: 'empty' }
  | { kind: 'existing'; data: Existing }
  | { kind: 'migration-required'; legacySnapshot: string }
  | { kind: 'recovery-ready'; legacySnapshot: string; pendingSnapshot: string }
  | { kind: 'migrated' | 'recovered'; value: CompleteMigration }
  | { kind: 'stopped'; reason: Reason; phase: Phase; writeOutcome: 'not-attempted' | 'unverified'; remaining: RemainingState };
type Action = { kind: 'inspect' }
  | { kind: 'migrate'; approvedLegacySnapshot: string }
  | { kind: 'recover'; approvedLegacySnapshot: string; approvedPendingSnapshot: string };

class MigrationStopped extends Error {
  constructor(readonly reason: Reason) { super(reason); }
}

/** 失敗後の観測だけを返す。元例外や保存データの内容を診断へ露出させない。 */
function remainingState(storage: MigrationStorage): RemainingState {
  let legacy: RemainingState['legacy'] = 'unreadable', v2: RemainingState['v2'] = 'unreadable';
  try { legacy = storage.getItem(OLD_STORAGE_KEY) === null ? 'absent' : 'present'; } catch { /* 読取不能のまま報告 */ }
  try {
    const raw = storage.getItem(NEW_STORAGE_KEY);
    if (raw === null) v2 = 'absent';
    else {
      v2 = 'invalid';
      try { v2 = parseLocalV2Json(raw).value.migration.status; } catch { /* 不正値を補修しない */ }
    }
  } catch { /* 読取不能のまま報告 */ }
  return { legacy, v2 };
}

async function run(deps: MigrationDependencies, action: Action): Promise<MigrationResult> {
  let phase: Phase = 'lock', writeAttempted = false;
  let fallback: Reason = 'lock-failure';
  try {
    return await withLocalDataLock(deps.locks, async (): Promise<MigrationResult> => {
      phase = 'inspect';
      fallback = 'storage-failure';
      const legacy = deps.storage.getItem(OLD_STORAGE_KEY);
      const current = deps.storage.getItem(NEW_STORAGE_KEY);
      // 承認した旧値が変わっていたら、既存新値があっても再承認を要求する。
      if (action.kind !== 'inspect' && legacy !== action.approvedLegacySnapshot) throw new MigrationStopped('approval-changed');
      let pending: PendingMigration;
      if (current !== null) {
        fallback = 'invalid-data';
        const checked = parseLocalV2Json(current);
        if (checked.kind !== 'validated-pending') return { kind: 'existing', data: checked };
        if (legacy === null) throw new MigrationStopped('invalid-data');
        pending = validatePendingMigration(current, legacy);
        if (action.kind === 'inspect') return { kind: 'recovery-ready', legacySnapshot: legacy, pendingSnapshot: current };
        if (action.kind !== 'recover') throw new MigrationStopped('recovery-required');
        if (action.approvedPendingSnapshot !== current) throw new MigrationStopped('approval-changed');
      } else {
        if (action.kind === 'recover') throw new MigrationStopped('approval-changed');
        if (legacy === null) return { kind: 'empty' };
        fallback = 'invalid-data';
        parseLegacyJson(legacy);
        if (action.kind === 'inspect') return { kind: 'migration-required', legacySnapshot: legacy };
        phase = 'prepare';
        fallback = 'uuid-failure';
        pending = createPendingMigration(legacy, deps.createId);
      }

      // 各書込直前と読戻しで両キーを確認する。複数キーの原子性は保証しない。
      const assertUnchanged = (expected: string | null): void => {
        fallback = 'storage-failure';
        if (deps.storage.getItem(OLD_STORAGE_KEY) !== legacy || deps.storage.getItem(NEW_STORAGE_KEY) !== expected) {
          throw new MigrationStopped('snapshot-changed');
        }
      };
      let pendingRaw = current;
      if (current === null) {
        pendingRaw = JSON.stringify(pending);
        phase = 'pending-write';
        assertUnchanged(null);
        writeAttempted = true;
        deps.storage.setItem(NEW_STORAGE_KEY, pendingRaw);
        phase = 'pending-readback';
        assertUnchanged(pendingRaw);
        fallback = 'invalid-data';
        validatePendingMigration(pendingRaw, legacy!);
      }
      const complete = completeMigration(pending);
      const completeRaw = JSON.stringify(complete);
      phase = 'complete-write';
      assertUnchanged(pendingRaw);
      writeAttempted = true;
      deps.storage.setItem(NEW_STORAGE_KEY, completeRaw);
      phase = 'complete-readback';
      assertUnchanged(completeRaw);
      fallback = 'invalid-data';
      const checked = parseLocalV2Json(completeRaw);
      if (checked.kind !== 'validated-complete') throw new MigrationStopped('invalid-data');
      return { kind: action.kind === 'recover' ? 'recovered' : 'migrated', value: complete };
    });
  } catch (error) {
    const reason = error instanceof LocalLocksUnavailableError ? 'locks-unavailable'
      : error instanceof MigrationStopped ? error.reason : fallback;
    return { kind: 'stopped', reason, phase, writeOutcome: writeAttempted ? 'unverified' : 'not-attempted', remaining: remainingState(deps.storage) };
  }
}

/** ロック内で判定だけを行う。承認材料には利用者データが含まれるのでログに出さない。 */
export function inspectLocalMigration(deps: MigrationDependencies): Promise<MigrationResult> { return run(deps, { kind: 'inspect' }); }

/** 明示操作の入口。確認時の旧生文字列に対する承認をロック内で再照合する。 */
export function migrateLocalData(deps: MigrationDependencies, approvedLegacySnapshot: string): Promise<MigrationResult> {
  return run(deps, { kind: 'migrate', approvedLegacySnapshot });
}

/** 判定だけでは復旧しない。承認したpendingと旧値が両方そのままの場合だけ書込を進める。 */
export function recoverLocalMigration(deps: MigrationDependencies, approvedLegacySnapshot: string, approvedPendingSnapshot: string): Promise<MigrationResult> {
  return run(deps, { kind: 'recover', approvedLegacySnapshot, approvedPendingSnapshot });
}

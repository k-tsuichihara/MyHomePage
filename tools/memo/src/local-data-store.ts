import { withLocalDataLock, LocalLocksUnavailableError } from './local-lock';
import type { LocalLockManager } from './local-lock';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from './local-migration';
import type { MigrationStorage } from './local-migration';
import { parseLocalV2Json, validateLocalV2 } from './local-validation';
import { ReadValidationError } from './read-primitives';
import type { LocalV2ValidationResult } from './read-types';

export type ReadyLocalData = Exclude<LocalV2ValidationResult, { kind: 'validated-pending' }>['value'];
export type LocalFailureReason = 'invalid-input' | 'request-id-reused' | 'locks-unavailable' | 'lock-failure'
  | 'storage-failure' | 'invalid-data' | 'migration-required' | 'recovery-required' | 'snapshot-changed'
  | 'id-exists' | 'not-found' | 'trashed' | 'conflict' | 'revision-limit' | 'invalid-tag' | 'invalid-state' | 'duplicate-tag';
export type LocalWriteFailure =
  | { kind: 'rejected'; reason: LocalFailureReason; writeOutcome: 'not-attempted' }
  | { kind: 'unknown'; reason: LocalFailureReason; writeOutcome: 'unverified' };
export type LocalLoadResult = { kind: 'empty' } | { kind: 'loaded'; value: ReadyLocalData }
  | { kind: 'unavailable'; reason: LocalFailureReason };

/** 固定理由だけを伝え、入力値や保存先の元例外を呼出側へ渡さない。 */
export class LocalDataError extends Error {
  constructor(readonly reason: LocalFailureReason) { super(`Local memo operation rejected: ${reason}`); }
}
export interface LocalDataDependencies { storage: MigrationStorage; locks: LocalLockManager | undefined }

/** pendingを通常保存へ流さない。構造不正を空データへ補正しない。 */
function ready(raw: unknown): ReadyLocalData {
  const result = validateLocalV2(raw);
  if (result.kind === 'validated-pending') throw new LocalDataError('recovery-required');
  return result.value;
}
function classify(error: unknown, fallback: LocalFailureReason): LocalFailureReason {
  if (error instanceof LocalLocksUnavailableError) return 'locks-unavailable';
  return error instanceof LocalDataError ? error.reason : fallback;
}

/**
 * 注入保存先の操作だけを行う書込基盤。実localStorageの取得・移行・復旧は行わない。
 * transactの変換関数は内部データ層用であり、任意の外部入力をそのまま実行する入口ではない。
 */
export function createLocalDataStore(deps: LocalDataDependencies) {
  function read() {
    const legacyRaw = deps.storage.getItem(OLD_STORAGE_KEY);
    const raw = deps.storage.getItem(NEW_STORAGE_KEY);
    if (raw === null) {
      if (legacyRaw !== null) throw new LocalDataError('migration-required');
      return { raw, legacyRaw, value: null };
    }
    try {
      const checked = parseLocalV2Json(raw);
      if (checked.kind === 'validated-pending') throw new LocalDataError('recovery-required');
      return { raw, legacyRaw, value: checked.value };
    } catch (error) {
      if (error instanceof ReadValidationError) throw new LocalDataError('invalid-data');
      throw error;
    }
  }

  return {
    /** 読取も共通ロック内で行い、結果は検証器が再構築した独立したデータとして返す。 */
    async load(): Promise<LocalLoadResult> {
      let fallback: LocalFailureReason = 'lock-failure';
      try {
        return await withLocalDataLock(deps.locks, async () => {
          fallback = 'storage-failure';
          const state = read();
          return state.value === null ? { kind: 'empty' } : { kind: 'loaded', value: state.value };
        });
      } catch (error) { return { kind: 'unavailable', reason: classify(error, fallback) }; }
    },

    /**
     * ロック内で最新値を読み、候補全体を検証して単一JSONを書き、完全一致を読戻す。
     * setItemの呼出直前から書込試行済みとし、それ以降の異常は成功でも未実行でもない。
     */
    async transact(transform: (current: ReadyLocalData) => ReadyLocalData): Promise<{ kind: 'written'; value: ReadyLocalData } | LocalWriteFailure> {
      let attempted = false;
      let fallback: LocalFailureReason = 'lock-failure';
      try {
        return await withLocalDataLock(deps.locks, async () => {
          fallback = 'storage-failure';
          const state = read();
          const base: ReadyLocalData = state.value ?? { version: 2, migration: { status: 'not-required' }, memos: [], tags: [], memoTags: [] };
          const metadata = JSON.stringify(base.migration);
          fallback = 'invalid-input';
          const candidate = ready(transform(base));
          if (JSON.stringify(candidate.migration) !== metadata) throw new LocalDataError('invalid-data');
          const nextRaw = JSON.stringify(candidate);
          fallback = 'storage-failure';
          if (deps.storage.getItem(OLD_STORAGE_KEY) !== state.legacyRaw || deps.storage.getItem(NEW_STORAGE_KEY) !== state.raw) {
            throw new LocalDataError('snapshot-changed');
          }
          attempted = true;
          deps.storage.setItem(NEW_STORAGE_KEY, nextRaw);
          if (deps.storage.getItem(OLD_STORAGE_KEY) !== state.legacyRaw || deps.storage.getItem(NEW_STORAGE_KEY) !== nextRaw) {
            throw new LocalDataError('snapshot-changed');
          }
          fallback = 'invalid-data';
          return { kind: 'written', value: ready(JSON.parse(nextRaw) as unknown) };
        });
      } catch (error) {
        const reason = classify(error, fallback);
        return attempted ? { kind: 'unknown', reason, writeOutcome: 'unverified' }
          : { kind: 'rejected', reason, writeOutcome: 'not-attempted' };
      }
    },
  };
}

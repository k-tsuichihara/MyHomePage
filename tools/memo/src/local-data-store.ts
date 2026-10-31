import { withLocalDataLock, LocalLocksUnavailableError } from './local-lock';
import type { LocalLockManager } from './local-lock';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from './local-migration';
import type { MigrationStorage } from './local-migration';
import { parseLocalFormatJson, validateLocalFormat } from './local-format';
import { ReadValidationError, uuidKey } from './read-primitives';
import type { LocalFormatResult } from './local-format';
import { removeTrash } from './local-delete-operations';
import type { DeleteRequest } from './local-delete-operations';

export type ReadyLocalData = Exclude<LocalFormatResult, { kind: 'validated-pending' }>['value'];
export type LocalFailureReason = 'invalid-input' | 'request-id-reused' | 'locks-unavailable' | 'lock-failure'
  | 'storage-failure' | 'invalid-data' | 'migration-required' | 'recovery-required' | 'snapshot-changed'
  | 'id-exists' | 'deleted-id' | 'v3-required' | 'delete-conflict' | 'trash-conflict' | 'not-found' | 'trashed' | 'conflict' | 'revision-limit' | 'invalid-tag' | 'invalid-state' | 'duplicate-tag';
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
type Written = { kind: 'written'; value: ReadyLocalData };
type Unchanged = { kind: 'not-needed'; count: 0 };
export interface RestoreBase { raw: string; legacyRaw: string | null; value: ReadyLocalData }

/** pendingを通常保存へ流さない。構造不正を空データへ補正しない。 */
function ready(raw: unknown): ReadyLocalData {
  const result = validateLocalFormat(raw);
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
  // ストア寿命中の保存先を固定し、確認後の依存オブジェクト差替えで別領域へ書かない。
  deps = { storage: deps.storage, locks: deps.locks };
  function read() {
    const legacyRaw = deps.storage.getItem(OLD_STORAGE_KEY);
    const raw = deps.storage.getItem(NEW_STORAGE_KEY);
    if (raw === null) {
      if (legacyRaw !== null) throw new LocalDataError('migration-required');
      return { raw, legacyRaw, value: null };
    }
    try {
      const checked = parseLocalFormatJson(raw);
      if (checked.kind === 'validated-pending') throw new LocalDataError('recovery-required');
      return { raw, legacyRaw, value: checked.value };
    } catch (error) {
      if (error instanceof ReadValidationError) throw new LocalDataError('invalid-data');
      throw error;
    }
  }

  /** 通常変換には履歴変更を許さず、専用削除経路だけが検証済み対象のIDを追加できる。 */
  async function commit(transform: (current: ReadyLocalData) => ReadyLocalData, deletion?: DeleteRequest, restore?: RestoreBase): Promise<Written | Unchanged | LocalWriteFailure> {
    let attempted = false;
    let fallback: LocalFailureReason = 'lock-failure';
    try {
      return await withLocalDataLock(deps.locks, async () => {
        fallback = 'storage-failure';
        const state = read();
        if (restore && (state.raw !== restore.raw || state.legacyRaw !== restore.legacyRaw)) throw new LocalDataError('snapshot-changed');
        const base: ReadyLocalData = state.value ?? { version: 2, migration: { status: 'not-required' }, memos: [], tags: [], memoTags: [] };
        const metadata = JSON.stringify(base.migration), version = base.version;
        const expected = base.version === 3 ? [...base.deletedMemoIds] : null;
        if (deletion && expected) {
          const ids = new Set(deletion.targets.map(row => uuidKey(row.id)));
          expected.push(...base.memos.filter(row => ids.has(uuidKey(row.id))).map(row => row.id));
        }
        fallback = 'invalid-input';
        const candidate = ready(deletion ? removeTrash(base, deletion) : transform(base));
        if (restore && (base.version !== 3 || candidate.version !== 3
          || ['memos', 'tags', 'memoTags'].some(field => {
            const key = field as 'memos' | 'tags' | 'memoTags';
            return JSON.stringify(candidate[key].slice(0, base[key].length)) !== JSON.stringify(base[key]);
          }))) throw new LocalDataError('invalid-data');
        if (JSON.stringify(candidate.migration) !== metadata || candidate.version !== version
          || JSON.stringify(candidate.version === 3 ? candidate.deletedMemoIds : null) !== JSON.stringify(expected)) throw new LocalDataError('invalid-data');
        const nextRaw = JSON.stringify(candidate);
        fallback = 'storage-failure';
        if (deps.storage.getItem(OLD_STORAGE_KEY) !== state.legacyRaw || deps.storage.getItem(NEW_STORAGE_KEY) !== state.raw) throw new LocalDataError('snapshot-changed');
        if (deletion && deletion.targets.length === 0) return { kind: 'not-needed', count: 0 };
        attempted = true;
        deps.storage.setItem(NEW_STORAGE_KEY, nextRaw);
        if (deps.storage.getItem(OLD_STORAGE_KEY) !== state.legacyRaw || deps.storage.getItem(NEW_STORAGE_KEY) !== nextRaw) throw new LocalDataError('snapshot-changed');
        fallback = 'invalid-data';
        return { kind: 'written', value: ready(JSON.parse(nextRaw) as unknown) };
      });
    } catch (error) {
      const reason = classify(error, fallback);
      return attempted ? { kind: 'unknown', reason, writeOutcome: 'unverified' } : { kind: 'rejected', reason, writeOutcome: 'not-attempted' };
    }
  }
  return {
    /** 復元controller内部だけへ渡す確認基準。UIには生値を返さない。 */
    async captureRestore(): Promise<RestoreBase> {
      return withLocalDataLock(deps.locks, async () => {
        const state = read();
        if (!state.raw || state.value?.version !== 3) throw new LocalDataError('v3-required');
        if (deps.storage.getItem(OLD_STORAGE_KEY) !== state.legacyRaw || deps.storage.getItem(NEW_STORAGE_KEY) !== state.raw) throw new LocalDataError('snapshot-changed');
        return { raw: state.raw, legacyRaw: state.legacyRaw, value: state.value };
      });
    },
    /** 通常ガードを維持し、固定した現在値への追加だけを単一書込する内部ポート。 */
    appendRestore(base: RestoreBase, candidate: ReadyLocalData) { return commit(() => candidate, undefined, base); },
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
      const result = await commit(transform);
      return result.kind === 'not-needed' ? { kind: 'rejected', reason: 'invalid-input', writeOutcome: 'not-attempted' } : result;
    },
    deleteTrash(request: DeleteRequest) { return commit(value => value, request); },
  };
}

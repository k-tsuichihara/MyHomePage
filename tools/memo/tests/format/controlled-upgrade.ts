import { parseLocalV2Json } from '../../src/local-validation';
import { identifyLocalJson, parseLocalFormatJson, validateLocalV3 } from '../../src/local-format';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../../src/local-migration';
import type { MigrationStorage } from '../../src/local-migration';
import { withLocalDataLock } from '../../src/local-lock';
import type { LocalLockManager } from '../../src/local-lock';

type Dependencies = { storage: MigrationStorage; locks: LocalLockManager | undefined };
type Failure = { kind: 'rejected' | 'unknown'; reason: string };
type Approval = Readonly<{ token: number }>;

/**
 * 隔離試験だけの許可発行器。製品srcから参照しない。
 * environmentは所有検証済みランナーの当該保存領域に対応するセッション識別子。
 * issuerはfixture生成担当だけが保持し、UIにはportだけを渡す。出所の暗号学的証明ではない。
 */
export function createControlledUpgrade(deps: Dependencies, environment: object) {
  // 待機中に呼出側が依存オブジェクトの保存先を差し替えても、許可を別領域へ向けない。
  const { storage, locks } = deps;
  const produced = new Map<string, string | null>();
  const approvals = new WeakMap<Approval, { raw: string; legacy: string | null; environment: object; storage: MigrationStorage; generation: number }>();
  let serial = 0, generation = 0;
  return {
    issuer: {
      /** 固定fixture初期投入・同じ環境の移行／復旧成功の直後だけ呼ぶ。任意バックアップ取込には使わない。 */
      producedV2(raw: string) {
        const checked = parseLocalV2Json(raw);
        if (checked.kind === 'validated-pending' || storage.getItem(NEW_STORAGE_KEY) !== raw) throw new Error('Fixture provenance rejected');
        produced.set(raw, storage.getItem(OLD_STORAGE_KEY));
      },
    },
    port: {
      async inspect() {
        const observed = ++generation;
        return withLocalDataLock(locks, async () => {
          const raw = storage.getItem(NEW_STORAGE_KEY);
          if (raw === null) return { kind: 'absent' as const };
          const format = identifyLocalJson(raw);
          if (format === 'invalid' || format === 'unknown-version') return { kind: format };
          const checked = parseLocalFormatJson(raw);
          if (checked.kind === 'validated-pending') return { kind: format === 'v2' ? 'recovery-required' as const : 'v3-pending' as const };
          if (format === 'v3') return { kind: 'v3' as const };
          const legacy = storage.getItem(OLD_STORAGE_KEY);
          if (!produced.has(raw) || produced.get(raw) !== legacy) return { kind: 'untrusted-v2' as const };
          const approval = Object.freeze({ token: ++serial });
          if (generation !== observed) return { kind: 'superseded' as const };
          approvals.set(approval, { raw, legacy, environment, storage, generation });
          return { kind: 'approval-required' as const, approval };
        });
      },
      revoke(approval: Approval) { approvals.delete(approval); ++generation; },
      /** 承認は最初のawaitより前に一度だけ消費。書込後の異常で戻さない。 */
      async confirm(approval: Approval): Promise<{ kind: 'updated' } | Failure> {
        const allowed = approvals.get(approval); approvals.delete(approval);
        if (!allowed || allowed.environment !== environment || allowed.storage !== storage || allowed.generation !== generation) return { kind: 'rejected', reason: 'permit-invalid' };
        const operation = ++generation;
        let attempted = false;
        try {
          return await withLocalDataLock(locks, async () => {
            if (operation !== generation) return { kind: 'rejected', reason: 'permit-invalid' };
            const raw = storage.getItem(NEW_STORAGE_KEY), legacy = storage.getItem(OLD_STORAGE_KEY);
            if (raw !== allowed.raw || legacy !== allowed.legacy) return { kind: 'rejected', reason: 'snapshot-changed' };
            const checked = parseLocalV2Json(raw);
            if (checked.kind === 'validated-pending') return { kind: 'rejected', reason: 'recovery-required' };
            const candidate = validateLocalV3({ ...checked.value, version: 3, deletedMemoIds: [] });
            const next = JSON.stringify(candidate.value);
            if (storage.getItem(NEW_STORAGE_KEY) !== raw || storage.getItem(OLD_STORAGE_KEY) !== legacy) return { kind: 'rejected', reason: 'snapshot-changed' };
            attempted = true;
            storage.setItem(NEW_STORAGE_KEY, next);
            if (storage.getItem(NEW_STORAGE_KEY) !== next || storage.getItem(OLD_STORAGE_KEY) !== legacy) throw new Error('Readback failed');
            parseLocalFormatJson(next);
            return { kind: 'updated' };
          });
        } catch { return { kind: attempted ? 'unknown' : 'rejected', reason: 'operation-failed' }; }
      },
    },
  };
}

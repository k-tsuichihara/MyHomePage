import { createCloudRpcAdapter } from '../../src/cloud-rpc-adapter';
import type { CloudCall, CloudResult, CloudTransport, RpcName } from '../../src/cloud-rpc-types';
import { freeze } from '../../src/cloud-rpc-validation';
import { uuid, uuidKey, unique } from '../../src/read-primitives';
import { isDeepStrictEqual } from 'node:util';
import { syntheticTransport } from './synthetic-port';
import type { SyntheticPort } from './synthetic-port';

export const PHASES = ['read', 'write', 'conflict', 'delete'] as const;
export type Phase = typeof PHASES[number];
export interface Step {
  readonly id: string; readonly phase: Phase; readonly actor: 'A' | 'B'; readonly rpc: RpcName;
  readonly args: CloudCall['args']; readonly requestId: string | null; readonly maxChanges: number;
  readonly expected: { readonly kind: 'ok' | 'rejected'; readonly reason?: string; readonly valueKind?: string; readonly value?: unknown; readonly conflict?: string };
}
export interface Manifest {
  readonly users: { readonly A: string; readonly B: string };
  readonly phases: Readonly<Record<Phase, { readonly targets: readonly string[]; readonly maxCalls: number; readonly maxChanges: number }>>;
  readonly steps: readonly Step[];
}
type Stop = 'permission' | 'order' | 'busy' | 'budget' | 'target' | 'unexpected-result' | 'owner-mismatch' | 'unknown' | 'exception';
export interface Evidence { readonly phase: Phase; readonly case: string; readonly outcome: 'PASS' | 'STOP'; readonly reason: 'matched' | Stop; readonly calls: number; readonly changeBudget: number }
type Adapter = ReturnType<typeof createCloudRpcAdapter>;
const readRpc = (rpc: RpcName) => rpc === 'memo_load_snapshot' || rpc === 'memo_resolve_request';
const PHASE_RPCS: Readonly<Record<Phase, readonly RpcName[]>> = {
  read: ['memo_load_snapshot', 'memo_resolve_request'],
  write: ['memo_save', 'memo_save_tag', 'memo_change_state', 'memo_resolve_request', 'memo_load_snapshot'],
  conflict: ['memo_save', 'memo_save_tag', 'memo_change_state', 'memo_resolve_request', 'memo_load_snapshot'],
  delete: ['memo_delete_permanently', 'memo_empty_trash', 'memo_delete_tag', 'memo_load_snapshot', 'memo_resolve_request'],
};

/** 固定manifestからのみ既存APIへ接続する。任意URL/SQL/Auth/任意callbackは受け取らない。 */
async function execute(adapter: Adapter, step: Step): Promise<CloudResult<unknown>> {
  const a = step.args, context = { expectedRevision: a.p_expected_revision as number, requestId: step.requestId! };
  switch (step.rpc) {
    case 'memo_load_snapshot': return adapter.load();
    case 'memo_save': case 'memo_resolve_request': {
      const input = { memoId: a.p_id as string, title: a.p_title as string, body: a.p_body as string, tagIds: a.p_tag_ids as string[],
        expectedRevision: a.p_expected_revision as number | null, requestId: a.p_request_id as string };
      return step.rpc === 'memo_save' ? adapter.save(input) : adapter.resolve(input);
    }
    case 'memo_change_state': return adapter.changeState(a.p_id as string, a.p_action as 'pin' | 'unpin' | 'trash' | 'restore', context);
    case 'memo_delete_permanently': return adapter.deletePermanently(a.p_id as string, context);
    case 'memo_empty_trash': return adapter.emptyTrash((a.p_ids as string[]).map((id, i) => ({ id, revision: (a.p_revisions as number[])[i]! })), step.requestId!);
    case 'memo_save_tag': return adapter.saveTag(a.p_id as string, a.p_name as string, a.p_expected_revision as number | null);
    case 'memo_delete_tag': return adapter.deleteTag(a.p_id as string, a.p_expected_revision as number);
  }
}

/**
 * 合成通信だけを注入するランナー。許可はインスタンス・段階に閉じ、最初のawait前に消費する。
 * changeBudgetは実変更数でなく、拒否時も戻さない保守的な変更試行上限。実DBの影響範囲証明ではない。
 */
export function createOfflineRunner(input: Manifest, port: SyntheticPort) {
  const simulate = syntheticTransport(port);
  // JSON由来の固定manifestを独立化する。外部ファイル/設定をここで読み込まない。
  const plan = freeze(structuredClone(input));
  unique([uuid(plan.users.A), uuid(plan.users.B)].map(uuidKey));
  unique(plan.steps.map(step => step.id));
  for (const step of plan.steps) {
    const minimumChanges = readRpc(step.rpc) ? 0 : Math.max(1, Array.isArray(step.args.p_ids) ? step.args.p_ids.length : 1);
    if (!/^[RWCD][0-9]{2}$/.test(step.id) || !PHASES.includes(step.phase) || !['A', 'B'].includes(step.actor)
      || !Number.isSafeInteger(step.maxChanges) || step.maxChanges < 0
      || (readRpc(step.rpc) ? step.maxChanges !== 0 : step.maxChanges < minimumChanges)
      || !PHASE_RPCS[step.phase].includes(step.rpc)) throw Error('Invalid synthetic manifest');
  }
  for (const phase of PHASES) {
    const limits = plan.phases[phase]; limits.targets.forEach(uuid);
    if (![limits.maxCalls, limits.maxChanges].every(n => Number.isSafeInteger(n) && n >= 0)) throw Error('Invalid synthetic manifest');
  }
  const permits = new WeakMap<object, Phase>(), issued = new Set<Phase>(), evidence: Evidence[] = [];
  let phaseIndex = 0, busy = false, stopped = false;
  function stop(phase: Phase, reason: Stop, caseId = 'R00', calls = 0, changes = 0) {
    stopped = true; const event: Evidence = freeze({ phase, case: caseId, outcome: 'STOP', reason, calls, changeBudget: changes }); evidence.push(event); return event;
  }
  return Object.freeze({
    authorize(phase: Phase): object {
      if (stopped || busy || PHASES[phaseIndex] !== phase || issued.has(phase)) throw Error('Phase permission unavailable');
      const permit = Object.freeze({}); permits.set(permit, phase); issued.add(phase); return permit;
    },
    async run(phase: Phase = 'read', permit?: object): Promise<readonly Evidence[]> {
      if (!PHASES.includes(phase)) throw Error('Invalid phase');
      if (stopped) return freeze([...evidence]);
      if (busy) { stop(phase, 'busy'); return freeze([...evidence]); }
      if (!permit || permits.get(permit) !== phase) { stop(phase, 'permission'); return freeze([...evidence]); }
      permits.delete(permit);
      if (PHASES[phaseIndex] !== phase) { stop(phase, 'order'); return freeze([...evidence]); }
      busy = true; let calls = 0, changes = 0;
      const limits = plan.phases[phase], allowed = new Set(limits.targets.map(uuidKey));
      try {
        for (const step of plan.steps.filter(s => s.phase === phase)) {
          if (stopped) break;
          let used = false, violation: Stop | null = null;
          const guarded: CloudTransport = async (rpc, args) => {
            if (used || rpc !== step.rpc || !isDeepStrictEqual(args, step.args)) { violation = 'permission'; throw Error('RPC denied'); }
            if (calls >= limits.maxCalls || changes + step.maxChanges > limits.maxChanges) { violation = 'budget'; throw Error('RPC denied'); }
            const ids = [args.p_id, ...(Array.isArray(args.p_ids) ? args.p_ids : []), ...(Array.isArray(args.p_tag_ids) ? args.p_tag_ids : [])].filter(v => v !== undefined);
            if (ids.some(id => typeof id !== 'string' || !allowed.has(uuidKey(id)))) { violation = 'target'; throw Error('RPC denied'); }
            used = true; calls++; changes += step.maxChanges;
            return simulate(rpc, args);
          };
          let result: CloudResult<unknown>;
          try { result = await execute(createCloudRpcAdapter(plan.users[step.actor], guarded), step); }
          catch { stop(phase, 'exception', step.id, calls, changes); break; }
          if (stopped) break;
          let reason: Stop | null = violation;
          if (!reason && (!used || result.kind === 'not-attempted')) reason = 'unexpected-result';
          if (!reason && (result.kind === 'failed' || result.kind === 'unknown') && result.reason === 'owner-mismatch') reason = 'owner-mismatch';
          if (!reason && result.kind === 'unknown') reason = 'unknown';
          if (!reason && (result.kind !== step.expected.kind || (result.kind === 'rejected' && (result.reason !== step.expected.reason
            || (step.expected.conflict !== undefined && (result.reason !== 'conflict' || result.conflict !== step.expected.conflict))))
            || (result.kind === 'ok' && Object.hasOwn(step.expected, 'value') && !isDeepStrictEqual(result.value, step.expected.value))
            || (result.kind === 'ok' && step.expected.valueKind !== undefined
              && (result.value === null || typeof result.value !== 'object' || !('kind' in result.value) || result.value.kind !== step.expected.valueKind)))) reason = 'unexpected-result';
          if (reason) { stop(phase, reason, step.id, calls, changes); break; }
          evidence.push(freeze({ phase, case: step.id, outcome: 'PASS', reason: 'matched', calls, changeBudget: changes }));
        }
        if (!stopped) phaseIndex++;
      } finally { busy = false; }
      return freeze([...evidence]);
    },
    evidence: () => freeze([...evidence]),
  });
}

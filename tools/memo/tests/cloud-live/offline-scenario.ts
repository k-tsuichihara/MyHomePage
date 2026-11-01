import { createOfflineRunner } from './runner';
import type { Manifest } from './runner';
import { createSyntheticPort } from './synthetic-port';
import type { SyntheticReply } from './synthetic-port';

// 認証/設定/実HTTP factoryをimportしない。ID・応答はこのシナリオが所有する合成値だけ。
export const A = '00000000-0000-0000-0000-000000000100', B = '00000000-0000-0000-0000-000000000101';
export const M = '00000000-0000-0000-0000-000000000001', T = '00000000-0000-0000-0000-000000000002', R = '00000000-0000-0000-0000-000000000003';
const STATE_R = '00000000-0000-0000-0000-000000000004', CONFLICT_R = '00000000-0000-0000-0000-000000000005';
const DATE = '2026-11-02T00:00:00Z';
export const memoRow = () => ({ id: M, user_id: A, title: '合成メモ', body: ' 合成本文\n', created_at: DATE, updated_at: DATE,
  pinned_at: null, deleted_at: null, revision: 1, last_request_id: R });
export function manifest(): Manifest {
  return { users: { A, B }, phases: {
    read: { targets: [], maxCalls: 2, maxChanges: 0 }, write: { targets: [M, T], maxCalls: 4, maxChanges: 3 },
    conflict: { targets: [M], maxCalls: 1, maxChanges: 1 }, delete: { targets: [M, T], maxCalls: 3, maxChanges: 3 },
  }, steps: [
    { id: 'R01', phase: 'read', actor: 'A', rpc: 'memo_load_snapshot', args: {}, requestId: null, maxChanges: 0,
      expected: { kind: 'ok', value: { memos: [], tags: [], memoTags: [] } } },
    { id: 'R02', phase: 'read', actor: 'B', rpc: 'memo_load_snapshot', args: {}, requestId: null, maxChanges: 0,
      expected: { kind: 'ok', value: { memos: [], tags: [], memoTags: [] } } },
    { id: 'W01', phase: 'write', actor: 'A', rpc: 'memo_save_tag', args: { p_id: T, p_name: 'Tag', p_expected_revision: null }, requestId: null, maxChanges: 1, expected: { kind: 'ok' } },
    { id: 'W02', phase: 'write', actor: 'A', rpc: 'memo_save', args: { p_id: M, p_title: '合成メモ', p_body: ' 合成本文\n', p_tag_ids: [T], p_expected_revision: null, p_request_id: R }, requestId: R, maxChanges: 1, expected: { kind: 'ok', valueKind: 'saved' } },
    { id: 'W03', phase: 'write', actor: 'A', rpc: 'memo_change_state', args: { p_id: M, p_expected_revision: 1, p_request_id: STATE_R, p_action: 'trash' }, requestId: STATE_R, maxChanges: 1, expected: { kind: 'ok', valueKind: 'changed' } },
    { id: 'W04', phase: 'write', actor: 'A', rpc: 'memo_resolve_request', args: { p_id: M, p_request_id: R, p_title: '合成メモ', p_body: ' 合成本文\n', p_tag_ids: [T], p_expected_revision: null }, requestId: R, maxChanges: 0, expected: { kind: 'ok', valueKind: 'saved' } },
    { id: 'C01', phase: 'conflict', actor: 'A', rpc: 'memo_change_state', args: { p_id: M, p_expected_revision: 1, p_request_id: CONFLICT_R, p_action: 'restore' }, requestId: CONFLICT_R, maxChanges: 1, expected: { kind: 'rejected', reason: 'conflict', conflict: 'state-revision' } },
    { id: 'D01', phase: 'delete', actor: 'A', rpc: 'memo_delete_permanently', args: { p_id: M, p_expected_revision: 2 }, requestId: R, maxChanges: 1, expected: { kind: 'ok' } },
    { id: 'D02', phase: 'delete', actor: 'A', rpc: 'memo_delete_tag', args: { p_id: T, p_expected_revision: 1 }, requestId: null, maxChanges: 1, expected: { kind: 'ok' } },
    { id: 'D03', phase: 'delete', actor: 'A', rpc: 'memo_empty_trash', args: { p_ids: [], p_revisions: [] }, requestId: R, maxChanges: 1, expected: { kind: 'ok', value: 0 } },
  ] };
}
/** single-rpcは合成応答にだけ付与する。DBの状態遷移を再現したシミュレーターではない。 */
export function syntheticReplies(): SyntheticReply[] {
  const bodies: unknown[] = [{ memos: [], tags: [], memoTags: [] }, { memos: [], tags: [], memoTags: [] },
    { id: T, user_id: A, name: 'Tag', created_at: DATE, revision: 1 }, { memo: memoRow(), tagIds: [T] },
    { ...memoRow(), deleted_at: DATE, revision: 2, last_request_id: STATE_R },
    { status: 'saved', result: { memo: memoRow(), tagIds: [T] } }, { code: 'PT409', message: 'revision conflict' }, undefined, undefined, 0];
  return manifest().steps.map((step, i) => ({ rpc: step.rpc,
    response: { provenance: 'single-rpc', status: step.phase === 'conflict' ? 409 : step.rpc === 'memo_delete_permanently' || step.rpc === 'memo_delete_tag' ? 204 : 200, body: bodies[i] } }));
}
export async function runOffline() {
  const runner = createOfflineRunner(manifest(), createSyntheticPort(syntheticReplies()));
  for (const phase of ['read', 'write', 'conflict', 'delete'] as const) {
    const result = await runner.run(phase, runner.authorize(phase));
    if (result.some(event => event.outcome === 'STOP')) break;
  }
  return runner.evidence();
}

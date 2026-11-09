import { describe, expect, it, vi } from 'vitest';
import { createCloudController, type CloudAuthBoundary, type UncertainCloudOperation } from '../src/cloud-controller';
import type { AuthContext, AuthRpcPreparation, AuthenticatedRpcSender } from '../src/auth-session';
import type { CloudTransportResponse, RpcName } from '../src/cloud-rpc-types';
import { token } from './local-save-fixtures';

const OWNER = token(100), OTHER = token(101), ID = token(1), TAG = token(2), TAG2 = token(3), REQUEST = token(4);
const DATE = '2024-02-29T23:59:59.123456+09:00';
const context = (): AuthContext => Object.freeze({ userId: OWNER, generation: 7 });
const response = (body: unknown, status = 200): CloudTransportResponse => ({ provenance: 'single-rpc', status, body });
const memo = () => ({ id: ID, user_id: OWNER, title: '対象', body: '本文', created_at: DATE, updated_at: DATE,
  pinned_at: DATE, deleted_at: null, revision: 2, last_request_id: REQUEST });
const tag = () => ({ id: TAG, user_id: OWNER, name: '重要', created_at: DATE, revision: 1 });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }

function success(rpc: RpcName): CloudTransportResponse {
  if (rpc === 'memo_change_state') return response(memo());
  if (rpc === 'memo_empty_trash') return response(2);
  if (rpc === 'memo_save_tag') return response(tag());
  if (rpc === 'memo_delete_permanently' || rpc === 'memo_delete_tag') return response(undefined, 204);
  return response(null);
}

function fixture(senderImplementation: AuthenticatedRpcSender = async (_token, rpc) => success(rpc)) {
  let active = true, owner = OWNER;
  const sender = vi.fn<AuthenticatedRpcSender>(senderImplementation);
  const boundary: CloudAuthBoundary = {
    isCurrent: (value: AuthContext) => active && value.userId === OWNER && value.generation === 7,
    prepareRpc: vi.fn(async (): Promise<AuthRpcPreparation> => {
      if (!active) return { kind: 'stopped', reason: 'not-current' };
      let sent = false;
      return { kind: 'ready', ownerId: owner, transport: (rpc, args) => {
        sent = true; return sender('private-bearer', rpc, args);
      }, wasSent: () => sent };
    }),
  };
  return { controller: createCloudController(boundary), sender, expire: () => { active = false; },
    setOwner: (value: string) => { owner = value; } };
}

type Controller = ReturnType<typeof createCloudController>;
function operations(controller: Controller) {
  return [
    () => controller.changeState(context(), ID, 'pin', { expectedRevision: 1, requestId: REQUEST }),
    () => controller.deletePermanently(context(), ID, { expectedRevision: 1, requestId: REQUEST }),
    () => controller.emptyTrash(context(), [{ id: ID, revision: 1 }, { id: TAG2, revision: 2 }], REQUEST),
    () => controller.saveTag(context(), TAG, '重要', null),
    () => controller.deleteTag(context(), TAG, 1),
  ] as const;
}

describe('C04 状態変更・削除・タグ操作', () => {
  it('5操作を既存RPCへ1回ずつ渡し、正常結果を返す', async () => {
    const f = fixture();
    for (const operation of operations(f.controller)) expect((await operation()).kind).toBe('completed');
    expect(f.sender.mock.calls.map(call => call[1])).toEqual([
      'memo_change_state', 'memo_delete_permanently', 'memo_empty_trash', 'memo_save_tag', 'memo_delete_tag',
    ]);
    expect(f.sender).toHaveBeenCalledTimes(5);
  });

  it('開始時の引数を固定し、後続変更を送信内容と不明操作へ混入させない', async () => {
    const stateGate = deferred<CloudTransportResponse>();
    const stateFixture = fixture(() => stateGate.promise);
    const mutation = { expectedRevision: 1, requestId: REQUEST };
    const stateRun = stateFixture.controller.changeState(context(), ID, 'trash', mutation);
    mutation.expectedRevision = 9; mutation.requestId = OTHER;
    await vi.waitFor(() => expect(stateFixture.sender).toHaveBeenCalledOnce()); stateGate.reject(new Error('secret detail'));
    const stateResult = await stateRun;
    if (stateResult.kind !== 'unresolved' || stateResult.operation.operation !== 'change-state') throw Error('expected unresolved');
    expect(stateResult.operation.mutation).toEqual({ expectedRevision: 1, requestId: REQUEST });
    expect(Object.isFrozen(stateResult.operation.mutation)).toBe(true);
    expect(stateFixture.sender.mock.calls[0]?.[2]).toMatchObject({ p_expected_revision: 1, p_request_id: REQUEST });

    const gate = deferred<CloudTransportResponse>();
    const f = fixture(() => gate.promise);
    const targets = [{ id: ID, revision: 1 }, { id: TAG2, revision: 2 }];
    const run = f.controller.emptyTrash(context(), targets, REQUEST);
    targets[0]!.id = OTHER; targets.push({ id: OTHER, revision: 3 });
    await vi.waitFor(() => expect(f.sender).toHaveBeenCalledOnce()); gate.reject(new Error('secret detail'));
    const result = await run;
    expect(result.kind).toBe('unresolved');
    if (result.kind !== 'unresolved' || result.operation.operation !== 'empty-trash') throw Error('expected unresolved');
    expect(result.operation.targets).toEqual([{ id: ID, revision: 1 }, { id: TAG2, revision: 2 }]);
    expect(Object.isFrozen(result.operation)).toBe(true);
    expect(Object.isFrozen(result.operation.targets)).toBe(true);
    expect(Object.isFrozen(result.operation.targets[0])).toBe(true);
    expect(f.sender.mock.calls[0]?.[2]).toEqual({ p_ids: [ID, TAG2], p_revisions: [1, 2] });
    expect(JSON.stringify(result)).not.toContain('private-bearer');
    expect(JSON.stringify(result)).not.toContain('secret detail');
  });

  it('各操作の通信例外を結果不明として保持し、自動再送しない', async () => {
    for (const index of [0, 1, 2, 3, 4]) {
      const f = fixture(async () => { throw Error('disconnect'); });
      const result = await operations(f.controller)[index]!();
      expect(result.kind).toBe('unresolved');
      expect(f.sender).toHaveBeenCalledOnce();
      await Promise.resolve(); expect(f.sender).toHaveBeenCalledOnce();
    }
  });

  it('結果不明操作には架空のresolveを設けず、明示確認後の追跡終了だけを許す', async () => {
    const f = fixture(async () => { throw Error('disconnect'); });
    const result = await f.controller.deleteTag(context(), TAG, 1);
    if (result.kind !== 'unresolved') throw Error('expected unresolved');
    expect(f.controller.dispose()).toBe('pending');
    expect(f.controller.acknowledgeUncertain({ ...result.operation } as UncertainCloudOperation)).toBe('invalid-operation');
    expect(f.controller.acknowledgeUncertain(result.operation)).toBe('applied');
    expect(f.controller.acknowledgeUncertain(result.operation)).toBe('already-acknowledged');
    expect(f.sender).toHaveBeenCalledOnce();
    expect(f.controller.dispose()).toBe('applied');
  });

  it('送信前の失効・所有者不一致ではRPCを呼ばない', async () => {
    const expired = fixture(); expired.expire();
    expect(await expired.controller.saveTag(context(), TAG, '重要', null)).toEqual({ kind: 'stopped', reason: 'auth-not-current' });
    expect(expired.sender).not.toHaveBeenCalled();
    const owner = fixture(); owner.setOwner(OTHER);
    expect(await owner.controller.deleteTag(context(), TAG, 1)).toEqual({ kind: 'stopped', reason: 'owner-mismatch' });
    expect(owner.sender).not.toHaveBeenCalled();
  });

  it('transportの送信前停止を結果不明にせず、RPC呼出し済み扱いもしない', async () => {
    const boundary: CloudAuthBoundary = { isCurrent: () => true, prepareRpc: async () => ({ kind: 'ready', ownerId: OWNER,
      transport: async () => { throw Error('stale'); }, wasSent: () => false }) };
    expect(await createCloudController(boundary).deletePermanently(context(), ID, { expectedRevision: 1, requestId: REQUEST }))
      .toEqual({ kind: 'stopped', reason: 'auth-not-current' });
  });

  it('送信後失効の応答を反映せず、操作を追跡する', async () => {
    const gate = deferred<CloudTransportResponse>(); const f = fixture(() => gate.promise);
    const run = f.controller.saveTag(context(), TAG, '重要', null);
    await vi.waitFor(() => expect(f.sender).toHaveBeenCalledOnce()); f.expire(); gate.resolve(response(tag()));
    const result = await run;
    expect(result.kind).toBe('stale-response');
    if (result.kind !== 'stale-response') throw Error('expected stale response');
    expect(result.operation).toMatchObject({ operation: 'save-tag', ownerId: OWNER, id: TAG, name: '重要' });
    expect(f.controller.dispose()).toBe('pending');
  });

  it('処理中のdisposeと二重操作を拒否し、応答後に終了できる', async () => {
    const gate = deferred<CloudTransportResponse>(); const f = fixture(() => gate.promise);
    const run = f.controller.deletePermanently(context(), ID, { expectedRevision: 1, requestId: REQUEST });
    await vi.waitFor(() => expect(f.sender).toHaveBeenCalledOnce());
    expect(f.controller.dispose()).toBe('busy');
    expect(await f.controller.emptyTrash(context(), [], REQUEST)).toEqual({ kind: 'busy' });
    expect(f.sender).toHaveBeenCalledOnce();
    gate.resolve(response(undefined, 204)); expect((await run).kind).toBe('completed');
    expect(f.controller.dispose()).toBe('applied');
  });

  it('状態変更の削除済みreceiptを既知結果として返し、現在状態の証明へ格上げしない', async () => {
    const f = fixture(async () => response({ code: 'P0002', message: 'previously applied, memo deleted' }, 500));
    const result = await f.controller.changeState(context(), ID, 'pin', { expectedRevision: 1, requestId: REQUEST });
    expect(result).toMatchObject({ kind: 'completed', result: { kind: 'ok', value: { kind: 'previously-applied-deleted' } } });
    expect(f.controller.dispose()).toBe('applied');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createCloudController, type CloudAuthBoundary } from '../src/cloud-controller';
import { createMemoAuthSession, type AuthContext, type AuthRpcPreparation, type AuthenticatedRpcSender, type MemoAuthApi } from '../src/auth-session';
import type { CloudSaveInput, CloudTransportResponse } from '../src/cloud-rpc-types';
import { token } from './local-save-fixtures';

const OWNER = token(100), OTHER = token(101), ID = token(1), TAG = token(2), REQUEST = token(4);
const DATE = '2024-02-29T23:59:59.123456+09:00';
const context = (): AuthContext => Object.freeze({ userId: OWNER, generation: 7 });
const input = (): CloudSaveInput => ({ memoId: ID, title: '復元対象', body: '本文', tagIds: [TAG], expectedRevision: null, requestId: REQUEST });
const saved = () => ({ memo: { id: ID, user_id: OWNER, title: '復元対象', body: '本文', created_at: DATE, updated_at: DATE,
  pinned_at: null, deleted_at: null, revision: 1, last_request_id: REQUEST }, tagIds: [TAG] });
const response = (body: unknown, status = 200): CloudTransportResponse => ({ provenance: 'single-rpc', status, body });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }

function fixture(senderImplementation: AuthenticatedRpcSender = async (_token, rpc) => response(rpc === 'memo_load_snapshot'
  ? { memos: [], tags: [], memoTags: [] } : saved())) {
  let active = true;
  let owner = OWNER;
  let prepareHook: (() => Promise<void>) | undefined;
  const sender = vi.fn<AuthenticatedRpcSender>(senderImplementation);
  const boundary: CloudAuthBoundary = {
    isCurrent: vi.fn((value: AuthContext) => active && value.userId === OWNER && value.generation === 7),
    prepareRpc: vi.fn(async (): Promise<AuthRpcPreparation> => {
      await prepareHook?.();
      if (!active) return { kind: 'stopped', reason: 'not-current' };
      let sent = false;
      return { kind: 'ready', ownerId: owner, transport: (rpc, args) => {
        sent = true; return sender('private-bearer', rpc, args);
      }, wasSent: () => sent };
    }),
  };
  return { controller: createCloudController(boundary), sender, boundary,
    expire: () => { active = false; }, setOwner: (value: string) => { owner = value; },
    beforePrepared: (hook: () => Promise<void>) => { prepareHook = hook; } };
}

describe('C04 認証世代に結び付けたRPC制御', () => {
  it('C03の用途限定能力とC01を接続し、BearerをC04結果へ出さない', async () => {
    const secret = 'synthetic-private-bearer';
    const api: MemoAuthApi = {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: OWNER }, access_token: secret, expires_at: 200 } }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: { id: OWNER } }, error: null })),
      signInWithPassword: vi.fn(), signOut: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
    };
    const sender = vi.fn<AuthenticatedRpcSender>(async tokenValue => {
      expect(tokenValue).toBe(secret);
      return response({ memos: [], tags: [], memoTags: [] });
    });
    const auth = createMemoAuthSession(api, () => 100_000, sender); await auth.restore();
    const result = await createCloudController(auth).load(auth.getContext()!);
    expect(result).toMatchObject({ kind: 'completed', result: { kind: 'ok', value: { memos: [], tags: [], memoTags: [] } } });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(sender).toHaveBeenCalledOnce();
  });

  it('送信前に失効していればRPCを呼ばない', async () => {
    const f = fixture(); f.expire();
    expect(await f.controller.load(context())).toEqual({ kind: 'stopped', reason: 'auth-not-current' });
    expect(f.sender).not.toHaveBeenCalled();
  });

  it('transportが送信前停止を通知した場合はC01のunknownをstoppedへ戻す', async () => {
    const boundary: CloudAuthBoundary = {
      isCurrent: () => true,
      prepareRpc: async () => ({ kind: 'ready', ownerId: OWNER,
        transport: async () => { throw new Error('auth-context-stale'); }, wasSent: () => false }),
    };
    const result = await createCloudController(boundary).save(context(), input());
    expect(result).toEqual({ kind: 'stopped', reason: 'auth-not-current' });
  });

  it('入力不正によるnot-attemptedは認証停止へ読み替えず、送信0件を維持する', async () => {
    const f = fixture();
    const result = await f.controller.save(context(), { ...input(), memoId: 'invalid' });
    expect(result).toEqual({ kind: 'completed', result: { kind: 'not-attempted', reason: 'invalid-input' } });
    expect(f.sender).not.toHaveBeenCalled();
  });

  it('資格情報取得中の世代変更を停止し、RPCを呼ばない', async () => {
    const f = fixture(), gate = deferred<void>();
    f.beforePrepared(() => gate.promise);
    const operation = f.controller.load(context()); f.expire(); gate.resolve();
    expect(await operation).toEqual({ kind: 'stopped', reason: 'auth-not-current' });
    expect(f.sender).not.toHaveBeenCalled();
  });

  it('資格情報の所有者が違えば送信前に拒否する', async () => {
    const f = fixture(); f.setOwner(OTHER);
    expect(await f.controller.save(context(), input())).toEqual({ kind: 'stopped', reason: 'owner-mismatch' });
    expect(f.sender).not.toHaveBeenCalled();
  });

  it('送信後に失効したload応答は反映しない', async () => {
    const gate = deferred<CloudTransportResponse>();
    const f = fixture(() => gate.promise); const operation = f.controller.load(context());
    await vi.waitFor(() => expect(f.sender).toHaveBeenCalledOnce()); f.expire();
    gate.resolve(response({ memos: [], tags: [], memoTags: [] }));
    expect(await operation).toEqual({ kind: 'stale-response' });
  });

  it('保存要求を開始時に固定し、結果不明を明示照合用に保持する', async () => {
    const f = fixture(async () => { throw new Error('private network detail'); });
    const source = input(); const operation = f.controller.save(context(), source);
    const mutable = source as unknown as { title: string; tagIds: string[] };
    mutable.title = '変更後'; mutable.tagIds = [OTHER];
    const result = await operation;
    expect(result.kind).toBe('unresolved');
    if (result.kind !== 'unresolved') throw new Error('expected unresolved');
    expect(result.pending.input).toEqual(input());
    expect(Object.isFrozen(result.pending)).toBe(true);
    expect(Object.isFrozen(result.pending.input)).toBe(true);
    expect(Object.isFrozen(result.pending.input.tagIds)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-bearer');
    expect(JSON.stringify(result)).not.toContain('private network detail');
    expect(f.sender).toHaveBeenCalledOnce();
  });

  it('送信後失効したsaveは要求を保持し、成功として反映しない', async () => {
    const gate = deferred<CloudTransportResponse>();
    const f = fixture(() => gate.promise); const operation = f.controller.save(context(), input());
    await vi.waitFor(() => expect(f.sender).toHaveBeenCalledOnce()); f.expire(); gate.resolve(response(saved()));
    const result = await operation; expect(result.kind).toBe('stale-response');
    if (result.kind !== 'stale-response') throw new Error('expected stale response');
    expect(result.pending?.input.requestId).toBe(REQUEST);
  });

  it.each([
    [null, { kind: 'no-record' }],
    [{ status: 'previously-applied-deleted' }, { kind: 'previously-applied-deleted' }],
  ])('結果不明後の明示resolveだけが元要求を照合する %#', async (body, expected) => {
    const f = fixture(async (_secret, rpc) => {
      if (rpc === 'memo_save') throw new Error('disconnect');
      return response(body);
    });
    const first = await f.controller.save(context(), input());
    if (first.kind !== 'unresolved') throw new Error('expected unresolved');
    expect(f.sender).toHaveBeenCalledTimes(1);
    const resolved = await f.controller.resolve(context(), first.pending);
    expect(resolved.kind).toBe('diagnosed');
    if (resolved.kind !== 'diagnosed') throw new Error('expected diagnosis');
    expect(resolved.result).toMatchObject({ kind: 'ok', value: expected });
    expect(resolved.pendingActive).toBe(body === null);
    expect(f.sender).toHaveBeenCalledTimes(2);
    expect(f.sender.mock.calls[1]?.[2]).toEqual(f.sender.mock.calls[0]?.[2]);
    const repeated = await f.controller.resolve(context(), first.pending);
    if (body === null) {
      expect(repeated.kind).toBe('diagnosed');
      expect(f.sender).toHaveBeenCalledTimes(3);
    } else {
      expect(repeated).toEqual({ kind: 'stopped', reason: 'request-closed' });
      expect(f.sender).toHaveBeenCalledTimes(2);
    }
  });

  it('別所有者・偽造pendingをresolveへ付け替えない', async () => {
    const f = fixture();
    const forged = { ownerId: OWNER, authGeneration: 7, input: input() };
    expect(await f.controller.resolve({ userId: OTHER, generation: 7 }, forged)).toEqual({ kind: 'stopped', reason: 'invalid-pending' });
    expect(f.sender).not.toHaveBeenCalled();
  });

  it('未確定pendingがあればdisposeを拒否し、明示resolve経路を維持する', async () => {
    const f = fixture(async (_secret, rpc) => {
      if (rpc === 'memo_save') throw new Error('disconnect');
      return response({ status: 'previously-applied-deleted' });
    });
    const first = await f.controller.save(context(), input());
    if (first.kind !== 'unresolved') throw new Error('expected unresolved');
    expect(f.controller.dispose()).toBe('pending');
    const diagnosis = await f.controller.resolve(context(), first.pending);
    expect(diagnosis).toMatchObject({ kind: 'diagnosed', pendingActive: false,
      result: { kind: 'ok', value: { kind: 'previously-applied-deleted' } } });
    expect(f.controller.dispose()).toBe('applied');
    expect(await f.controller.load(context())).toEqual({ kind: 'stopped', reason: 'disposed' });
    expect(f.sender).toHaveBeenCalledTimes(2);
  });

  it('送信中saveのdisposeをbusyで拒否し、結果不明要求を引き続き診断できる', async () => {
    const gate = deferred<CloudTransportResponse>();
    const f = fixture((_secret, rpc) => rpc === 'memo_save' ? gate.promise : Promise.resolve(response(null)));
    const operation = f.controller.save(context(), input());
    await vi.waitFor(() => expect(f.sender).toHaveBeenCalledOnce());
    expect(f.controller.dispose()).toBe('busy');
    gate.reject(new Error('disconnect'));
    const result = await operation;
    expect(result.kind).toBe('unresolved');
    if (result.kind !== 'unresolved') throw new Error('expected unresolved');
    expect(f.controller.dispose()).toBe('pending');
    expect(await f.controller.resolve(context(), result.pending)).toMatchObject({ kind: 'diagnosed', pendingActive: true,
      result: { kind: 'ok', value: { kind: 'no-record' } } });
  });

  it('送信中loadのdisposeをbusyで拒否し、応答後に安全に終了できる', async () => {
    const gate = deferred<CloudTransportResponse>(); const f = fixture(() => gate.promise);
    const operation = f.controller.load(context());
    await vi.waitFor(() => expect(f.sender).toHaveBeenCalledOnce());
    expect(f.controller.dispose()).toBe('busy');
    gate.resolve(response({ memos: [], tags: [], memoTags: [] }));
    expect((await operation).kind).toBe('completed');
    expect(f.controller.dispose()).toBe('applied');
  });

  it('送信中resolveのdisposeをbusyで拒否し、no-record後はpendingを維持する', async () => {
    const gate = deferred<CloudTransportResponse>();
    const f = fixture(async (_secret, rpc) => {
      if (rpc === 'memo_save') throw new Error('disconnect');
      return gate.promise;
    });
    const first = await f.controller.save(context(), input());
    if (first.kind !== 'unresolved') throw new Error('expected unresolved');
    const operation = f.controller.resolve(context(), first.pending);
    await vi.waitFor(() => expect(f.sender).toHaveBeenCalledTimes(2));
    expect(f.controller.dispose()).toBe('busy');
    gate.resolve(response(null));
    expect(await operation).toMatchObject({ kind: 'diagnosed', pendingActive: true });
    expect(f.controller.dispose()).toBe('pending');
  });

  it('処理中の二重操作をbusyで拒否し、自動再送しない', async () => {
    const gate = deferred<CloudTransportResponse>(); const f = fixture(() => gate.promise);
    const first = f.controller.save(context(), input()); await vi.waitFor(() => expect(f.sender).toHaveBeenCalledOnce());
    expect(await f.controller.save(context(), input())).toEqual({ kind: 'busy' });
    expect(await f.controller.load(context())).toEqual({ kind: 'busy' });
    expect(f.sender).toHaveBeenCalledOnce();
    gate.resolve(response(saved())); expect((await first).kind).toBe('completed');
    expect(f.sender).toHaveBeenCalledOnce();
  });
});

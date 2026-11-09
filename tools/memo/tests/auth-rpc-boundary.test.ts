import { describe, expect, it, vi } from 'vitest';
import { createMemoAuthSession, type MemoAuthApi } from '../src/auth-session';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const session = (id = A, expires = 200) => ({ user: { id }, access_token: 'synthetic-secret', expires_at: expires });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture(sender?: Parameters<typeof createMemoAuthSession>[2]) {
  let current: unknown = session();
  let clock = 100_000;
  const api = {
    getSession: vi.fn<MemoAuthApi['getSession']>(async () => ({ data: { session: current }, error: null })),
    getUser: vi.fn<MemoAuthApi['getUser']>(async () => ({ data: { user: { id: A } }, error: null })),
    signInWithPassword: vi.fn<MemoAuthApi['signInWithPassword']>(async () => ({ data: { session: current }, error: null })),
    signOut: vi.fn<MemoAuthApi['signOut']>(async () => ({ error: null })),
    onAuthStateChange: vi.fn<MemoAuthApi['onAuthStateChange']>(() => ({ data: { subscription: { unsubscribe() {} } } })),
  };
  const auth = createMemoAuthSession(api, () => clock, sender);
  return { auth, api, setSession: (value: unknown) => { current = value; }, time: (value: number) => { clock = value; } };
}

describe('C03からC04へ渡す用途限定RPC能力', () => {
  it('現在のcontextと所有者を照合し、資格情報を戻り値へ公開しない', async () => {
    const sender = vi.fn(async (secret: string) => {
      expect(secret).toBe('synthetic-secret');
      return { provenance: 'single-rpc' as const, status: 200, body: { memos: [], tags: [], memoTags: [] } };
    });
    const f = fixture(sender); await f.auth.restore(); const context = f.auth.getContext()!;
    const prepared = await f.auth.prepareRpc(context);
    expect(JSON.stringify(prepared)).not.toContain('synthetic-secret');
    if (prepared.kind !== 'ready') throw new Error('expected ready');
    await prepared.transport('memo_load_snapshot', {});
    expect(sender).toHaveBeenCalledOnce();
  });

  it('資格情報取得中に世代が変われば能力を発行しない', async () => {
    const f = fixture(vi.fn()); await f.auth.restore(); const context = f.auth.getContext()!;
    const pending = deferred<Awaited<ReturnType<MemoAuthApi['getSession']>>>();
    f.api.getSession.mockReturnValueOnce(pending.promise);
    const operation = f.auth.prepareRpc(context);
    f.auth.requireReauthentication(context);
    pending.resolve({ data: { session: session() }, error: null });
    expect(await operation).toEqual({ kind: 'stopped', reason: 'not-current' });
  });

  it('別所有者の資格情報と期限切れを送信前に停止する', async () => {
    const f = fixture(vi.fn()); await f.auth.restore(); const context = f.auth.getContext()!;
    f.setSession(session(B));
    expect(await f.auth.prepareRpc(context)).toEqual({ kind: 'stopped', reason: 'owner-mismatch' });
    f.setSession(session(A, 100));
    expect(await f.auth.prepareRpc(context)).toEqual({ kind: 'stopped', reason: 'not-current' });
    expect(f.auth.getState().phase).toBe('blocked');
  });

  it('発行済み能力は1回限りで、二重送信しない', async () => {
    const sender = vi.fn(async () => ({ provenance: 'single-rpc' as const, status: 200, body: null }));
    const f = fixture(sender); await f.auth.restore(); const context = f.auth.getContext()!;
    const prepared = await f.auth.prepareRpc(context);
    if (prepared.kind !== 'ready') throw new Error('expected ready');
    await prepared.transport('memo_resolve_request', {});
    await expect(prepared.transport('memo_resolve_request', {})).rejects.toThrow('auth-context-stale');
    expect(sender).toHaveBeenCalledOnce();
  });

  it('能力準備後でも送信直前の期限切れならRPCを呼ばない', async () => {
    const sender = vi.fn(async () => ({ provenance: 'single-rpc' as const, status: 200, body: null }));
    const f = fixture(sender); await f.auth.restore(); const context = f.auth.getContext()!;
    const prepared = await f.auth.prepareRpc(context);
    if (prepared.kind !== 'ready') throw new Error('expected ready');
    f.time(200_000);
    await expect(prepared.transport('memo_load_snapshot', {})).rejects.toThrow('auth-context-stale');
    expect(prepared.wasSent()).toBe(false);
    expect(sender).not.toHaveBeenCalled();
  });
});

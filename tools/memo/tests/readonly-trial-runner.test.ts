import { describe, expect, it, vi } from 'vitest';
import { createReadonlyTrialRunner } from '../src/readonly-trial-runner';
import { MEMO_RPC_ORIGIN } from '../src/cloud-rpc-sender';
import type { AuthStorage } from '../src/auth-client';

const permit = { origin: 'http://127.0.0.1:43219', runId: '12345678-1234-1234-1234-123456789abc' };
const origin = 'https://memo-runner.invalid';
const token = 'header.payload.signature';
function fixture(overrides: Partial<{ projectRef: string; origin: string }> = {}) {
  const values = new Map<string, string>();
  const storage: AuthStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  const authTransport = vi.fn(async (request: Request) => request.url.endsWith('/user')
    ? new Response(JSON.stringify({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }))
    : new Response(JSON.stringify({ access_token: token, refresh_token: 'refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } })));
  const rpcFetch = vi.fn(async (url: string) => { const response = new Response(JSON.stringify({ memos: [], tags: [], memoTags: [] })); Object.defineProperty(response, 'url', { value: url }); return response; });
  const runner = createReadonlyTrialRunner({ expectedProjectRef: 'expected', projectRef: overrides.projectRef ?? 'expected', expectedOrigin: MEMO_RPC_ORIGIN, expectedAuthOrigin: origin,
    origin: overrides.origin ?? MEMO_RPC_ORIGIN, env: { origin: permit.origin, secure: true, topLevel: true, getStorage: () => storage as unknown as Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }, permit,
    authConfig: { url: origin, publicKey: 'sb_publishable_synthetic_only' }, rpcConfig: { origin: MEMO_RPC_ORIGIN, publishableKey: 'sb_publishable_synthetic_only' }, authTransport: authTransport as unknown as typeof fetch,
    rpcFetch: rpcFetch as unknown as Parameters<typeof import('../src/cloud-rpc-sender').createMemoRpcSender>[1] });
  return { runner, authTransport, rpcFetch };
}

describe('readonly trial runner', () => {
  it('起動のみでは通信0、明示操作でAuth→load 1回になる', async () => {
    const f = fixture(); expect(f.runner.observation()).toMatchObject({ state: 'idle', authCalls: 0, rpcCalls: 0 });
    await f.runner.startAuth(); expect(f.runner.observation().authCalls).toBeGreaterThan(0);
    await f.runner.load(); expect(f.runner.observation()).toMatchObject({ state: 'unknown', stopReason: 'load-failed', rpcCalls: 1, rpcNames: ['memo_load_snapshot'], otherRpcCalls: 0 });
    expect(f.rpcFetch).toHaveBeenCalledOnce();
  });
  it('Project Ref/origin不一致は通信前にSTOPする', async () => {
    for (const value of [{ projectRef: 'wrong' }, { origin: 'https://wrong.invalid' }]) {
      const f = fixture(value); await f.runner.startAuth(); expect(f.runner.observation().state).toBe('stopped');
      expect(f.authTransport).not.toHaveBeenCalled(); expect(f.rpcFetch).not.toHaveBeenCalled();
    }
  });
  it('二重load・dispose後は通信を再開しない', async () => {
    const f = fixture(); await f.runner.startAuth(); await f.runner.load(); const count = f.rpcFetch.mock.calls.length;
    await f.runner.load(); await f.runner.dispose(); await f.runner.load();
    expect(f.rpcFetch).toHaveBeenCalledTimes(count); expect(f.runner.observation().state).toBe('disposed');
  });
  it('Auth blocked is classified safely without RPC', async () => {
    const f = fixture();
    f.authTransport.mockImplementation(async () => new Response(JSON.stringify({ error: 'invalid credentials' }), { status: 401 }));
    await f.runner.startAuth({ email: 'synthetic@example.invalid', password: 'synthetic-password' });
    expect(f.runner.observation()).toMatchObject({ state: 'stopped', stopReason: 'auth-unavailable', rpcCalls: 0, otherRpcCalls: 0 });
    expect(f.rpcFetch).not.toHaveBeenCalled();
    expect(JSON.stringify(f.runner.observation())).not.toContain('invalid credentials');
  });
  it('records only structured transport diagnostics', async () => {
    const f = fixture();
    f.authTransport.mockImplementation(async () => new Response('private raw body', { status: 503 }));
    await f.runner.startAuth({ email: 'private@example.invalid', password: 'private-password' });
    const observation = f.runner.observation();
    expect(observation.diagnostic).toMatchObject({ schema: 'memo-human-gate-diagnostic-v1', failureClass: 'provider-http-5xx', httpStatus: 503, responseReceived: true, retryCount: 0, secretsExposed: false });
    expect(JSON.stringify(observation)).not.toMatch(/private|example|password|raw body/);
    expect(f.rpcFetch).not.toHaveBeenCalled();
  });
  it.each([302, 399])('classifies non-2xx status %s as unexpected-http-status', async status => {
    const f = fixture();
    f.authTransport.mockImplementation(async () => new Response(null, { status }));
    await f.runner.startAuth({ email: 'private@example.invalid', password: 'private-password' });
    expect(f.runner.observation().diagnostic).toMatchObject({ failureClass: 'unexpected-http-status', httpStatus: status, responseReceived: true });
    expect(f.rpcFetch).not.toHaveBeenCalled();
  });
  it('classifies an HTTP 4xx response', async () => {
    const f = fixture();
    f.authTransport.mockImplementation(async () => new Response('{}', { status: 401 }));
    await f.runner.startAuth({ email: 'private@example.invalid', password: 'private-password' });
    expect(f.runner.observation().diagnostic).toMatchObject({ failureClass: 'provider-http-4xx', httpStatus: 401 });
  });
  it('normalizes transport failure without exposing the exception', async () => {
    const f = fixture();
    f.authTransport.mockRejectedValue(new Error('private network detail'));
    await f.runner.startAuth({ email: 'private@example.invalid', password: 'private-password' });
    expect(f.runner.observation().diagnostic).toMatchObject({ failureClass: 'network', transportStarted: true, transportCompleted: false, secretsExposed: false });
    expect(JSON.stringify(f.runner.observation())).not.toMatch(/private|network detail|example|password/);
    expect(f.rpcFetch).not.toHaveBeenCalled();
  });
});

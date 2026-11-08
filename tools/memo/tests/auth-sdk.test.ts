import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createMemoSdkAuth, createMemoSessionStorage } from '../src/auth-sdk';
import type { AuthStorage } from '../src/auth-client';
import type { MemoAuthApi } from '../src/auth-session';

const KEY = 'myhomepage.memo.auth.v1';
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const config = { url: 'https://memo-sdk.invalid', publicKey: 'sb_publishable_synthetic_only' };
const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
function payload(id = A, offset = 3600) {
  const now = Math.floor(Date.now() / 1000);
  return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, exp: now + offset, iat: now, role: 'authenticated' })}.${encode('synthetic-signature')}`,
    refresh_token: `synthetic-refresh-${offset}`, expires_in: offset, expires_at: now + offset, token_type: 'bearer',
    user: { id, aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid',
      app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };
}
function memory(seed: [string, string][] = []) {
  const values = new Map(seed);
  const backing: AuthStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
  return { values, backing };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const active: ReturnType<typeof createMemoSdkAuth>[] = [];
function server(store = memory()) {
  let current = payload();
  let fail = '';
  const calls: { path: string; method: string; grant: string | null; scope: string | null }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input)); const method = init?.method ?? 'GET';
    if (url.origin !== config.url || !url.pathname.startsWith('/auth/v1/')) throw new Error('Unexpected synthetic request');
    expect(init?.redirect).toBe('error');
    calls.push({ path: url.pathname, method, grant: url.searchParams.get('grant_type'), scope: url.searchParams.get('scope') });
    if (fail === 'network') throw new Error('synthetic-private-network');
    if (fail === 'json') return new Response('synthetic-private-invalid-json');
    if (fail === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://external.invalid' } });
    if (url.pathname.endsWith('/token')) {
      if (fail === 'login' || fail === 'refresh') return json({ message: 'synthetic-private-message', error_code: fail === 'refresh' ? 'refresh_token_not_found' : 'invalid_credentials' }, 400);
      return json(current);
    }
    if (url.pathname.endsWith('/user')) {
      if (fail === 'user') return json({ message: 'synthetic-private-message', error_code: 'session_not_found' }, 401);
      return json(current.user);
    }
    if (url.pathname.endsWith('/logout')) {
      if (fail === 'logout') return json({ message: 'synthetic-private-message' }, 500);
      return new Response(null, { status: 204 });
    }
    throw new Error('Unexpected synthetic path');
  });
  return { store, fetch, calls, failure: (value: string) => { fail = value; }, user: (id: string) => { current = payload(id); },
    refreshed: () => { current = payload(A, 7200); },
    create() { const client = createMemoSdkAuth(config, store.backing, fetch); active.push(client); return client; } };
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0)); };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External fetch forbidden'); }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  for (const client of active.splice(0)) await client.dispose();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  const logs = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.warn).mock.calls].flat().map(String).join('\n');
  expect(logs).not.toMatch(/synthetic-private|synthetic-refresh|synthetic-password|eyJ/);
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('専用セッション保存先', () => {
  it('SDKの専用主キー・補助キーだけを許可する', async () => {
    const m = memory(), owner = createMemoSessionStorage(m.backing);
    for (const key of [KEY, `${KEY}-user`, `${KEY}-code-verifier`, `${KEY}-flows-code-verifier`]) {
      await owner.storage.setItem(key, 'synthetic'); expect(await owner.storage.getItem(key)).toBe('synthetic');
      await owner.storage.removeItem(key); expect(await owner.storage.getItem(key)).toBeNull();
    }
  });
  it.each(['myhomepage.memo.data.v2', 'myhomepage.memo.items.v1', 'sb-reading-auth-token', 'other'])('対象外キー%sを背後の保存先へ渡さない', async key => {
    const m = memory(), owner = createMemoSessionStorage(m.backing);
    await expect(owner.storage.getItem(key)).rejects.toThrow('Memo Auth storage unavailable');
    await expect(owner.storage.setItem(key, 'synthetic')).rejects.toThrow();
    await expect(owner.storage.removeItem(key)).rejects.toThrow(); expect(m.backing.getItem).not.toHaveBeenCalled();
    expect(m.backing.setItem).not.toHaveBeenCalled(); expect(m.backing.removeItem).not.toHaveBeenCalled();
  });
  it('保存先例外は固定理由で停止し、後続操作を通さない', async () => {
    const m = memory(), owner = createMemoSessionStorage(m.backing);
    vi.mocked(m.backing.getItem).mockImplementationOnce(() => { throw new Error('synthetic-private-storage'); });
    await expect(owner.storage.getItem(KEY)).rejects.toThrow('Memo Auth storage unavailable');
    expect(owner.isUnavailable()).toBe(true); await expect(owner.storage.setItem(KEY, 'synthetic')).rejects.toThrow();
    expect(m.backing.setItem).not.toHaveBeenCalled();
  });
  it('終了後は保存先へアクセスしない', async () => {
    const m = memory(), owner = createMemoSessionStorage(m.backing); owner.close();
    await expect(owner.storage.getItem(KEY)).rejects.toThrow(); expect(m.backing.getItem).not.toHaveBeenCalled();
  });
});

describe('実Supabase SDKと既存Auth境界（実通信なし）', () => {
  it('SDKの公開Auth型が既存境界にキャストなしで適合する', () => {
    expectTypeOf<SupabaseClient['auth']>().toExtend<MemoAuthApi>();
  });
  it('初期化・ログイン・保存・localログアウトをSDKの実APIで行う', async () => {
    const s = server(memory([['myhomepage.memo.data.v2', 'synthetic-memo'], ['sb-reading-auth-token', 'synthetic-reading']]));
    const c = s.create(); await settle(); expect(c.session.getState().phase).toBe('signed-out'); expect(s.calls).toEqual([]);
    expect(await c.session.login('synthetic@example.invalid', 'synthetic-password')).toBe('applied'); await settle();
    expect(c.session.getState().phase).toBe('authenticated'); const old = c.session.getContext()!;
    const stored = JSON.parse(s.store.values.get(KEY)!) as { user: { id: string }; refresh_token: string };
    expect(stored.user.id).toBe(A); expect(stored.refresh_token).toBeDefined();
    expect(s.calls.filter(r => r.grant === 'password')).toHaveLength(1);
    await c.session.logout(); await settle();
    expect(c.session.getState().phase).toBe('signed-out');
    expect(c.session.isCurrent(old)).toBe(false); expect(s.store.values.has(KEY)).toBe(false);
    expect(s.calls.filter(r => r.path.endsWith('/logout'))).toEqual([{ path: '/auth/v1/logout', method: 'POST', grant: null, scope: 'local' }]);
    expect(s.store.values.get('myhomepage.memo.data.v2')).toBe('synthetic-memo');
    expect(s.store.values.get('sb-reading-auth-token')).toBe('synthetic-reading');
  });
  it('SDKを作り直しても同じ合成保存先から復元し、旧contextを使い回さない', async () => {
    const s = server(), first = s.create(); await settle(); await first.session.login('synthetic@example.invalid', 'synthetic-password'); await settle();
    const old = first.session.getContext()!; await first.dispose();
    const next = s.create(); await settle(); await next.session.restore(); await settle();
    expect(next.session.getState().userId).toBe(A); expect(next.session.isCurrent(old)).toBe(false);
    expect(s.calls.filter(r => r.grant === 'password')).toHaveLength(1);
  });
  it('SDKのトークン更新後も同一ユーザーだけを認証し、旧contextを無効化', async () => {
    const s = server(), c = s.create(); await settle(); await c.session.login('synthetic@example.invalid', 'synthetic-password'); await settle();
    const old = c.session.getContext()!; const expired = payload(A, -10); s.store.values.set(KEY, JSON.stringify(expired)); s.refreshed();
    await c.session.restore(); await settle(); expect(c.session.getState().phase).toBe('authenticated');
    expect(c.session.isCurrent(old)).toBe(false); expect(s.calls.filter(r => r.grant === 'refresh_token')).toHaveLength(1);
  });
  it('更新拒否で書込停止し、同一ユーザー再認証対象を保持', async () => {
    const s = server(), c = s.create(); await settle(); await c.session.login('synthetic@example.invalid', 'synthetic-password'); await settle();
    const old = c.session.getContext()!; s.store.values.set(KEY, JSON.stringify(payload(A, -10))); s.failure('refresh');
    await c.session.restore(); await settle(); expect(c.session.getContext()).toBeNull(); expect(c.session.isCurrent(old)).toBe(false);
    expect(c.session.getState().reauthenticateUserId).toBe(A);
    expect(s.calls.filter(r => r.grant === 'refresh_token')).toHaveLength(1);
    s.failure(''); s.user(B); await c.session.login('synthetic@example.invalid', 'synthetic-password'); await settle();
    expect(c.session.getContext()).toBeNull(); expect(c.session.getState().reauthenticateUserId).toBe(A);
    s.user(A); await c.session.login('synthetic@example.invalid', 'synthetic-password'); await settle();
    expect(c.session.getState().userId).toBe(A); expect(c.session.isCurrent(old)).toBe(false);
  });
  it.each(['login', 'network', 'json', 'redirect'])('ログイン%s異常を成功にせず、ログイン要求を自動再送しない', async failure => {
    const s = server(), c = s.create(); await settle(); s.failure(failure);
    expect(await c.session.login('synthetic@example.invalid', 'synthetic-password')).toBe('blocked'); await settle();
    expect(c.session.getContext()).toBeNull(); expect(s.calls.filter(r => r.grant === 'password')).toHaveLength(1);
  });
  it('ユーザー照会拒否で旧contextを失効させる', async () => {
    const s = server(), c = s.create(); await settle(); await c.session.login('synthetic@example.invalid', 'synthetic-password'); await settle();
    const old = c.session.getContext()!; s.failure('user'); await c.session.restore(); await settle();
    expect(c.session.getContext()).toBeNull(); expect(c.session.isCurrent(old)).toBe(false);
  });
  it('logout失敗で認証済みへ自動復帰せずlocal要求を再送しない', async () => {
    const s = server(), c = s.create(); await settle(); await c.session.login('synthetic@example.invalid', 'synthetic-password'); await settle();
    s.failure('logout'); expect(await c.session.logout()).toBe('blocked'); await settle();
    expect(c.session.getContext()).toBeNull(); expect(s.calls.filter(r => r.path.endsWith('/logout'))).toHaveLength(1);
  });
  it('Storage読取例外をSDKが内部処理しても空データとしてログインを許可しない', async () => {
    const m = memory(); vi.mocked(m.backing.getItem).mockImplementation(() => { throw new Error('synthetic-private-storage'); });
    const s = server(m), c = s.create(); await settle(); await c.session.restore();
    expect(c.session.getContext()).toBeNull(); expect(c.session.getState().phase).toBe('blocked');
    expect(await c.session.login('synthetic@example.invalid', 'synthetic-password')).toBe('blocked'); expect(s.calls).toEqual([]);
  });
  it('Storage書込例外でも成功contextを発行しない', async () => {
    const m = memory(), s = server(m), c = s.create(); await settle();
    vi.mocked(m.backing.setItem).mockImplementationOnce(() => { throw new Error('synthetic-private-quota'); });
    expect(await c.session.login('synthetic@example.invalid', 'synthetic-password')).toBe('blocked');
    expect(c.session.getContext()).toBeNull();
  });
  it('Storage削除例外時もログアウト成功とせず他アプリキーは残す', async () => {
    const m = memory([['sb-reading-auth-token', 'synthetic-reading']]), s = server(m), c = s.create(); await settle();
    await c.session.login('synthetic@example.invalid', 'synthetic-password'); await settle(); const old = c.session.getContext()!;
    vi.mocked(m.backing.removeItem).mockImplementationOnce(() => { throw new Error('synthetic-private-storage'); });
    expect(await c.session.logout()).toBe('blocked'); await settle();
    expect(c.session.getContext()).toBeNull(); expect(c.session.isCurrent(old)).toBe(false);
    expect(m.values.get('sb-reading-auth-token')).toBe('synthetic-reading');
  });
  it('不正な設定ではSDK生成や保存先アクセスを開始しない', () => {
    const m = memory(), fetch = vi.fn<typeof globalThis.fetch>();
    expect(() => createMemoSdkAuth({ ...config, publicKey: 'sb_secret_synthetic' }, m.backing, fetch)).toThrow('Invalid memo Auth configuration');
    expect(m.backing.getItem).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('Storage障害でglobal localStorageへのフォールバックを行わない', async () => {
    const fallback = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal('localStorage', fallback);
    const m = memory(); vi.mocked(m.backing.getItem).mockImplementation(() => { throw new Error('synthetic-private'); });
    const c = server(m).create(); await settle(); await c.session.restore();
    expect(c.session.getContext()).toBeNull(); expect(fallback.getItem).not.toHaveBeenCalled();
    expect(fallback.setItem).not.toHaveBeenCalled(); expect(fallback.removeItem).not.toHaveBeenCalled();
  });
  it('15秒を超えたログイン通信を中断し、要求を自動再送しない', async () => {
    const s = server(), c = s.create(); await settle();
    s.fetch.mockImplementationOnce(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('synthetic-private-timeout')), { once: true });
    }));
    vi.useFakeTimers();
    try {
      const operation = c.session.login('synthetic@example.invalid', 'synthetic-password');
      for (let i = 0; i < 30; i++) await Promise.resolve();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await operation).toBe('blocked'); expect(c.session.getContext()).toBeNull();
      expect(s.fetch).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('終了はcontextを直ちに失効させ、複数回呼んでも同じ終了Promiseを返す', async () => {
    const s = server(), c = s.create(); await settle(); await c.session.login('synthetic@example.invalid', 'synthetic-password'); await settle();
    const old = c.session.getContext()!; const closing = c.dispose(); expect(c.session.isCurrent(old)).toBe(false);
    expect(c.dispose()).toBe(closing); await closing;
    expect(await c.session.login('synthetic@example.invalid', 'synthetic-password')).toBe('stale');
  });
  it('SDK照会待機中に終了しても遅い応答からcontextを復活させない', async () => {
    const s = server(), c = s.create(); await settle(); await c.session.login('synthetic@example.invalid', 'synthetic-password'); await settle();
    const old = c.session.getContext()!;
    let release!: (value: Response) => void;
    s.fetch.mockImplementationOnce(async () => new Promise<Response>(resolve => { release = resolve; }));
    const operation = c.session.restore();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(release).toBeDefined(); const closing = c.dispose();
    release(json(payload().user)); await closing; expect(await operation).toBe('stale');
    expect(c.session.getContext()).toBeNull(); expect(c.session.isCurrent(old)).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createMemoSdkAuth } from '../src/auth-sdk';
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
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url.origin !== config.url || !url.pathname.startsWith('/auth/v1/')) throw new Error('Unexpected synthetic request');
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

describe('SDK標準Authとメモ専用session（実通信なし）', () => {
  it('SDKの公開型をそのまま受け、追加getUserなしでlogin・保存・local logoutする', async () => {
    expectTypeOf<SupabaseClient['auth']>().toExtend<MemoAuthApi>();
    const s=server(memory([['myhomepage.memo.data.v2','synthetic-memo'],['sb-reading-auth-token','synthetic-reading']]));
    const c=s.create();await settle();await c.session.restore();expect(c.session.getState().phase).toBe('signed-out');
    expect(await c.session.login('synthetic@example.invalid','synthetic-password')).toBe('applied');await settle();
    expect(c.session.getState().userId).toBe(A);expect(s.calls.filter(r=>r.path.endsWith('/user'))).toHaveLength(0);
    expect(s.calls.filter(r=>r.grant==='password')).toHaveLength(1);
    expect(JSON.parse(s.store.values.get(KEY)!).user.id).toBe(A);
    const old=c.session.getContext()!;await c.session.logout();await settle();
    expect(c.session.getState().phase).toBe('signed-out');expect(c.session.isCurrent(old)).toBe(false);
    expect(s.calls.filter(r=>r.path.endsWith('/logout'))).toEqual([{path:'/auth/v1/logout',method:'POST',grant:null,scope:'local'}]);
    expect(s.store.values.has(KEY)).toBe(false);expect(s.store.values.get('myhomepage.memo.data.v2')).toBe('synthetic-memo');
    expect(s.store.values.get('sb-reading-auth-token')).toBe('synthetic-reading');
  });
  it('SDK標準のsession復元と新インスタンスのcontext分離',async()=>{
    const s=server(),first=s.create();await settle();await first.session.login('synthetic@example.invalid','synthetic-password');await settle();
    const old=first.session.getContext()!;await first.dispose();const next=s.create();await settle();await next.session.restore();await settle();
    expect(next.session.getState().userId).toBe(A);expect(next.session.isCurrent(old)).toBe(false);
    expect(s.calls.filter(r=>r.grant==='password')).toHaveLength(1);expect(s.calls.filter(r=>r.path.endsWith('/user'))).toHaveLength(0);
  });
  it('SDK標準refresh後は同一ownerの新世代へ更新し旧contextを無効化',async()=>{
    const s=server(),c=s.create();await settle();await c.session.login('synthetic@example.invalid','synthetic-password');await settle();
    const old=c.session.getContext()!;s.store.values.set(KEY,JSON.stringify(payload(A,-10)));s.refreshed();
    await c.session.restore();await settle();expect(c.session.getState().phase).toBe('authenticated');expect(c.session.isCurrent(old)).toBe(false);
    expect(s.calls.filter(r=>r.grant==='refresh_token')).toHaveLength(1);
  });
  it('refresh失敗は操作停止し、別user再認証で旧draftを開放しない',async()=>{
    const s=server(),c=s.create();await settle();await c.session.login('synthetic@example.invalid','synthetic-password');await settle();
    const old=c.session.getContext()!;s.store.values.set(KEY,JSON.stringify(payload(A,-10)));s.failure('refresh');
    await c.session.restore();await settle();expect(c.session.getContext()).toBeNull();expect(c.session.getState().reauthenticateUserId).toBe(A);
    s.failure('');s.user(B);await c.session.login('synthetic@example.invalid','synthetic-password');await settle();
    expect(c.session.getContext()).toBeNull();expect(c.session.getState().reauthenticateUserId).toBe(A);
    s.user(A);await c.session.login('synthetic@example.invalid','synthetic-password');await settle();
    expect(c.session.getState().userId).toBe(A);expect(c.session.isCurrent(old)).toBe(false);
  });
  it.each(['login','network','json','redirect'])('SDKエラー%sを成功にせずpassword要求を自動再送しない',async failure=>{
    const s=server(),c=s.create();await settle();s.failure(failure);
    expect(await c.session.login('synthetic@example.invalid','synthetic-password')).toBe('blocked');await settle();
    expect(c.session.getContext()).toBeNull();expect(s.calls.filter(r=>r.grant==='password')).toHaveLength(1);
  });
  it('getUser失敗設定があってもSDK session復元の追加成功条件にしない',async()=>{
    const s=server(),c=s.create();await settle();await c.session.login('synthetic@example.invalid','synthetic-password');await settle();
    s.failure('user');expect(await c.session.restore()).toBe('applied');expect(c.session.getContext()).not.toBeNull();
    expect(s.calls.filter(r=>r.path.endsWith('/user'))).toHaveLength(0);
  });
  it('logout失敗は自動復帰・再送せず旧contextを使わせない',async()=>{
    const s=server(),c=s.create();await settle();await c.session.login('synthetic@example.invalid','synthetic-password');await settle();
    const old=c.session.getContext()!;s.failure('logout');expect(await c.session.logout()).toBe('blocked');await settle();
    expect(c.session.getContext()).toBeNull();expect(c.session.isCurrent(old)).toBe(false);expect(s.calls.filter(r=>r.path.endsWith('/logout'))).toHaveLength(1);
  });
  it('保存例外は秘密値を画面へ渡さず、後続の明示loginをsticky停止しない',async()=>{
    const m=memory(),s=server(m),c=s.create();await settle();
    vi.mocked(m.backing.setItem).mockImplementationOnce(()=>{throw new Error('synthetic-private-quota');});
    expect(await c.session.login('synthetic@example.invalid','synthetic-password')).toBe('blocked');
    expect(JSON.stringify(c.session.getState())).not.toContain('synthetic-private');
    expect(await c.session.login('synthetic@example.invalid','synthetic-password')).toBe('applied');
  });
  it('不正設定でSDKを生成せず、versionや接続先を自動変更しない',()=>{
    const m=memory(),fetch=vi.fn<typeof globalThis.fetch>();
    expect(()=>createMemoSdkAuth({...config,publicKey:'sb_secret_synthetic'},m.backing,fetch)).toThrow('Invalid memo Auth configuration');
    expect(m.backing.getItem).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });
  it('disposeは冪等で旧contextと遅いlogin完了を無効化する',async()=>{
    const s=server(),c=s.create();await settle();let release!:(value:Response)=>void;
    s.fetch.mockImplementationOnce(async()=>new Promise<Response>(resolve=>{release=resolve;}));
    const operation=c.session.login('synthetic@example.invalid','synthetic-password');
    for(let i=0;i<40;i++)await Promise.resolve();expect(release).toBeDefined();
    const closing=c.dispose();expect(c.dispose()).toBe(closing);release(json(payload()));await closing;
    expect(await operation).toBe('stale');expect(c.session.getContext()).toBeNull();expect(await c.session.login('a','b')).toBe('stale');
  });
  it('購読解除とstateの秘密値非公開を維持する',async()=>{
    const s=server(),c=s.create(),states:unknown[]=[];const off=c.session.subscribe(state=>states.push(state));
    await c.session.restore();await c.session.login('synthetic@example.invalid','synthetic-password');await settle();
    expect(JSON.stringify(states)).not.toMatch(/synthetic|password|token|email|eyJ/);
    off();const n=states.length;await c.session.logout();await settle();expect(states).toHaveLength(n);
  });
});

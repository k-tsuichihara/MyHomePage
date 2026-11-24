import { describe, expect, it, vi } from 'vitest';
import { createMemoAuthSession, type MemoAuthApi } from '../src/auth-session';
import { createMemoAuthClient } from '../src/auth-client';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const session = (id = A, expires = 200) => ({ user: { id }, access_token: 'synthetic-secret', expires_at: expires });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  let current: unknown = session();
  let user: unknown = { id: A };
  let clock = 100_000;
  let callback!: (event: string, session: unknown) => void;
  const unsubscribe = vi.fn();
  const api = {
    getSession: vi.fn<MemoAuthApi['getSession']>(async () => ({ data: { session: current }, error: null })),
    getUser: vi.fn<MemoAuthApi['getUser']>(async () => ({ data: { user }, error: null })),
    signInWithPassword: vi.fn<MemoAuthApi['signInWithPassword']>(async () => ({ data: { session: current }, error: null })),
    signOut: vi.fn<MemoAuthApi['signOut']>(async () => { current = null; return { error: null }; }),
    onAuthStateChange: vi.fn<MemoAuthApi['onAuthStateChange']>(cb => { callback = cb; return { data: { subscription: { unsubscribe } } }; }),
  };
  const auth = createMemoAuthSession(api, () => clock);
  return { auth, api, unsubscribe, setSession: (v: unknown) => { current = v; }, setUser: (v: unknown) => { user = v; },
    time: (v: number) => { clock = v; }, emit: (event = 'TOKEN_REFRESHED') => callback(event, current) };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe('SDK標準sessionに接続する製品用adapter', () => {
  it('生成・購読だけではSDKを呼ばない', async () => {
    const f = fixture(); f.auth.subscribe(() => {}); await flush();
    expect(f.api.getSession).not.toHaveBeenCalled(); expect(f.api.getUser).not.toHaveBeenCalled();
    expect(f.api.signInWithPassword).not.toHaveBeenCalled();
  });
  it.each(['login', 'restore'] as const)('%sはSDK結果で認証し追加getUserを呼ばない', async kind => {
    const f = fixture(); expect(await (kind === 'login' ? f.auth.login('a', 'b') : f.auth.restore())).toBe('applied');
    expect(f.auth.getContext()).not.toBeNull(); expect(f.api.getUser).not.toHaveBeenCalled();
    expect(f.auth.getState().userId).toBe(A);
  });
  it('初期復元のnullは未ログイン、loginのnullは成功にしない', async () => {
    const f = fixture(); f.setSession(null); expect(await f.auth.restore()).toBe('applied');
    expect(f.auth.getState().phase).toBe('signed-out'); expect(await f.auth.login('a','b')).toBe('blocked');
  });
  it.each([{}, { user: { id: 'invalid' }, access_token: 'private', expires_at: 200 }, session(A, 1)])('不正sessionや期限切れからcontextを発行しない：%#', async raw => {
    const f = fixture(); f.setSession(raw); expect(await f.auth.restore()).toBe('blocked'); expect(f.auth.getContext()).toBeNull();
  });
  it('期限切れと再認証では同一ownerだけを許可する', async () => {
    const f = fixture(); await f.auth.restore(); const old = f.auth.getContext()!;
    f.time(200_000); expect(f.auth.isCurrent(old)).toBe(false); expect(f.auth.getState().reauthenticateUserId).toBe(A);
    f.setSession(session(B,400)); expect(await f.auth.login('a','b')).toBe('blocked');
    expect(f.auth.getState().reason).toBe('different-user');
    f.setSession(session(A,400)); expect(await f.auth.login('a','b')).toBe('applied'); expect(f.auth.isCurrent(old)).toBe(false);
  });
  it('SDK通知を標準の状態更新として受け取り、再確認やtoken一致条件を追加しない', async () => {
    const f = fixture(); await f.auth.restore(); const old = f.auth.getContext()!;
    const reads = f.api.getSession.mock.calls.length;
    f.setSession({ ...session(A,400), access_token: 'changed-token' }); f.emit();
    expect(f.auth.getState().phase).toBe('authenticated'); expect(f.auth.isCurrent(old)).toBe(false);
    expect(f.api.getSession).toHaveBeenCalledTimes(reads); expect(f.api.getUser).not.toHaveBeenCalled();
    f.setSession(session(B,400)); f.emit(); expect(f.auth.getContext()).toBeNull(); expect(f.auth.getState().reauthenticateUserId).toBe(A);
  });
  it('SDKのsession消失はcloud owner対応を保持して操作停止する', async () => {
    const f = fixture(); await f.auth.restore(); f.setSession(null); f.emit('SIGNED_OUT');
    expect(f.auth.getState()).toMatchObject({ phase:'blocked', reason:'expired', reauthenticateUserId:A });
  });
  it('logoutはlocal scopeで実行し、owner対応も明示解除する', async () => {
    const f=fixture(); await f.auth.restore(); const old=f.auth.getContext()!; await f.auth.logout();
    expect(f.api.signOut).toHaveBeenCalledExactlyOnceWith({scope:'local'}); expect(f.auth.getState()).toMatchObject({phase:'signed-out',reauthenticateUserId:null});
    expect(f.auth.isCurrent(old)).toBe(false);
  });
  it('処理中は二重実行せず、旧contextを即時無効化する', async () => {
    const f=fixture(); await f.auth.restore(); const old=f.auth.getContext()!, d=deferred<{error:unknown}>();
    f.api.signOut.mockReturnValueOnce(d.promise); const p=f.auth.logout();
    expect(f.auth.isCurrent(old)).toBe(false); expect(await f.auth.login('a','b')).toBe('busy');
    expect(await f.auth.logout()).toBe('busy'); d.resolve({error:null}); expect(await p).toBe('applied');
  });
  it.each(['login','restore'] as const)('%s中の同一user通知はtoken/期限が変わっても標準sessionとして反映する', async kind => {
    const f=fixture(), changed={...session(A,400), access_token:'new-token'};
    const method=kind==='login'?'signInWithPassword':'getSession';
    f.api[method].mockImplementationOnce(async()=>{ f.setSession(changed); f.emit(); return {data:{session:session()},error:null}; });
    expect(await (kind==='login'?f.auth.login('a','b'):f.auth.restore())).toBe('applied');
    expect(f.auth.getState()).toMatchObject({phase:'authenticated',userId:A,expiresAt:400}); expect(f.api.getUser).not.toHaveBeenCalled();
  });
  it('古いlogin応答よりSDKの後続user通知を優先し、旧login完了でD05へ進ませない',async()=>{
    const f=fixture(), d=deferred<Awaited<ReturnType<MemoAuthApi['signInWithPassword']>>>();
    f.api.signInWithPassword.mockReturnValueOnce(d.promise); const p=f.auth.login('a','b');
    f.setSession(session(B)); f.emit('SIGNED_IN'); d.resolve({data:{session:session(A)},error:null});
    expect(await p).toBe('stale'); expect(f.auth.getState().userId).toBe(B); expect(f.api.getSession).not.toHaveBeenCalled();
  });
  it('login中のSIGNED_OUTから旧認証を復活させない',async()=>{
    const f=fixture(); f.api.signInWithPassword.mockImplementationOnce(async()=>{f.setSession(null);f.emit('SIGNED_OUT');return {data:{session:session()},error:null};});
    expect(await f.auth.login('a','b')).toBe('stale');expect(f.auth.getState().phase).toBe('signed-out');expect(f.auth.getContext()).toBeNull();
  });
  it('既存ownerの処理中に別user通知が届いてもdraft所有者を差し替えない',async()=>{
    const f=fixture();await f.auth.restore();f.api.getSession.mockImplementationOnce(async()=>{f.setSession(session(B));f.emit();return {data:{session:session(A)},error:null};});
    expect(await f.auth.restore()).toBe('blocked');expect(f.auth.getState().reauthenticateUserId).toBe(A);
  });
  it('logout失敗中の通知で自動復帰せず、再送も行わない',async()=>{
    const f=fixture();await f.auth.restore();f.api.signOut.mockImplementationOnce(async()=>{f.emit();return {error:new Error('private')};});
    expect(await f.auth.logout()).toBe('blocked');await flush();expect(f.auth.getContext()).toBeNull();
    expect(f.api.getSession).toHaveBeenCalledTimes(1);expect(f.api.signOut).toHaveBeenCalledTimes(1);
    f.emit();expect(f.auth.getState().phase).toBe('authenticated');
  });
  it.each(['getSession','signInWithPassword','signOut'] as const)('%sの例外をUIへ渡さず再送しない',async method=>{
    const f=fixture();f.api[method].mockRejectedValueOnce(new Error('synthetic-private-token'));
    const p=method==='getSession'?f.auth.restore():method==='signInWithPassword'?f.auth.login('a','b'):f.auth.logout();
    expect(await p).toBe('blocked');expect(JSON.stringify(f.auth.getState())).not.toContain('synthetic-private');expect(f.api[method]).toHaveBeenCalledTimes(1);
  });
  it('subscribe初期化失敗時はcontextを発行しない',async()=>{
    const f=fixture();f.api.onAuthStateChange.mockImplementationOnce(()=>{throw new Error('private');});
    const auth=createMemoAuthSession(f.api);expect(await auth.login('a','b')).toBe('blocked');expect(auth.getContext()).toBeNull();
  });
  it('dispose後の遅い応答とSDK通知を反映せず、一度だけ解除する',async()=>{
    const f=fixture(),d=deferred<Awaited<ReturnType<MemoAuthApi['getSession']>>>();f.api.getSession.mockReturnValueOnce(d.promise);
    const p=f.auth.restore();f.auth.dispose();f.auth.dispose();f.emit();d.resolve({data:{session:session()},error:null});
    expect(await p).toBe('stale');expect(f.auth.getState().phase).toBe('disposed');expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('明示クライアント生成とセッション保持設定', () => {
  const config = { url: 'https://synthetic.supabase.co', publicKey: 'sb_publishable_synthetic' };
  const storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
  it('注入factoryへ専用保存先と保持設定を渡すだけで保存領域へ直接触れない', () => {
    const f = fixture(), factory = vi.fn(() => ({ auth: f.api }));
    expect(createMemoAuthClient(factory, config, storage).auth).toBe(f.api);
    expect(factory).toHaveBeenCalledExactlyOnceWith(config.url, config.publicKey, { auth: {
      storage, storageKey: 'myhomepage.memo.auth.v1', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
    } }); expect(storage.getItem).not.toHaveBeenCalled();
  });
  it('既存構成のanon JWTキーを受ける（署名真正性の検証ではない）', () => {
    const factory = vi.fn(() => ({ auth: fixture().api }));
    createMemoAuthClient(factory, { ...config, publicKey: `header.${btoa('{"role":"anon"}')}.signature` }, storage);
    expect(factory).toHaveBeenCalledTimes(1);
  });
  it.each(['sb_secret_synthetic', `header.${btoa('{"role":"service_role"}')}.signature`, '', 'broken'])('秘密キー・不正キーをfactory前に拒否 %#', publicKey => {
    const factory = vi.fn(); expect(() => createMemoAuthClient(factory, { ...config, publicKey }, storage)).toThrow('Invalid memo Auth configuration');
    expect(factory).not.toHaveBeenCalled();
  });
  it.each(['http://synthetic.supabase.co', 'https://user:pass@synthetic.supabase.co', 'https://synthetic.supabase.co/path'])('不正URLを固定理由で拒否 %#', url => {
    expect(() => createMemoAuthClient(vi.fn(), { ...config, url }, storage)).toThrow('Invalid memo Auth configuration');
  });
});

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

describe('C03 認証状態と通信なしSDK境界', () => {
  it('生成だけでは復元・ログイン・ログアウト・保存先アクセスをしない', () => {
    const f = fixture(); expect(f.auth.getContext()).toBeNull();
    expect(f.api.getSession).not.toHaveBeenCalled(); expect(f.api.signInWithPassword).not.toHaveBeenCalled();
    expect(f.api.signOut).not.toHaveBeenCalled();
  });
  it('Authイベント購読が失敗した場合は認証を開始しない', async () => {
    const f = fixture(); f.api.onAuthStateChange.mockImplementationOnce(() => { throw new Error('private'); });
    const auth = createMemoAuthSession(f.api); expect(await auth.restore()).toBe('blocked');
    expect(await auth.login('a', 'b')).toBe('blocked'); expect(auth.getContext()).toBeNull();
    expect(f.api.getSession).not.toHaveBeenCalled();
  });
  it('ログインは資格情報を変更せず一度だけ渡し、状態に秘密を出さない', async () => {
    const f = fixture(); expect(await f.auth.login(' a@example.invalid ', ' synthetic password ')).toBe('applied');
    expect(f.api.signInWithPassword).toHaveBeenCalledExactlyOnceWith({ email: ' a@example.invalid ', password: ' synthetic password ' });
    expect(f.auth.getState().phase).toBe('authenticated'); expect(f.auth.getContext()?.userId).toBe(A);
    expect(JSON.stringify(f.auth.getState())).not.toMatch(/synthetic|password|example|token/);
    expect(Object.isFrozen(f.auth.getState())).toBe(true);
  });
  it('別controllerで同じSDK保存先のセッションを復元できる（永続APIは模擬）', async () => {
    const f = fixture(); await f.auth.restore(); f.auth.dispose();
    const next = createMemoAuthSession(f.api, () => 100_000); await next.restore();
    expect(next.getState().userId).toBe(A); next.dispose();
  });
  it('セッションなしは未ログインで空クラウドデータと混同しない', async () => {
    const f = fixture(); f.setSession(null); expect(await f.auth.restore()).toBe('applied');
    expect(f.auth.getState().phase).toBe('signed-out'); expect(f.api.getUser).not.toHaveBeenCalled();
  });
  it.each([{}, { ...session(), expires_at: '200' }, { ...session(), access_token: '' }, session('bad-id')])('不正セッションは書込停止 %#', async raw => {
    const f = fixture(); f.setSession(raw); expect(await f.auth.restore()).toBe('blocked'); expect(f.auth.getContext()).toBeNull();
  });
  it('SDKのユーザー確認とセッションの所有者不一致を拒否', async () => {
    const f = fixture(); f.setUser({ id: B }); await f.auth.restore(); expect(f.auth.getState().reason).toBe('invalid-session');
  });
  it('エラーなしでもログインにsessionがなければ成功扱いしない', async () => {
    const f = fixture(); f.setSession(null); expect(await f.auth.login('a', 'b')).toBe('blocked');
    expect(f.auth.getState().reason).toBe('invalid-session');
  });
  it('session取得エラーとgetUser確認エラーを認証済みにしない', async () => {
    const f = fixture(); f.api.getSession.mockResolvedValueOnce({ data: { session: session() }, error: { message: 'private' } });
    expect(await f.auth.restore()).toBe('blocked'); expect(f.api.getUser).not.toHaveBeenCalled();
    f.api.getUser.mockResolvedValueOnce({ data: { user: { id: A } }, error: { message: 'private' } });
    expect(await f.auth.restore()).toBe('blocked'); expect(f.auth.getContext()).toBeNull();
  });
  it('期限到達はcontext照合時にも停止し、同一ユーザーを再認証対象として保持', async () => {
    const f = fixture(); await f.auth.restore(); const c = f.auth.getContext()!; f.time(200_000);
    expect(f.auth.isCurrent(c)).toBe(false); expect(f.auth.getState().reauthenticateUserId).toBe(A);
  });
  it('期限切れセッション自体は復元しない', async () => {
    const f = fixture(); f.setSession(session(A, 100)); await f.auth.restore(); expect(f.auth.getState().reason).toBe('expired');
  });
  it('getUser待機中の期限切れも拒否', async () => {
    const f = fixture(), d = deferred<Awaited<ReturnType<MemoAuthApi['getUser']>>>();
    f.api.getUser.mockReturnValueOnce(d.promise); const operation = f.auth.restore(); await flush(); f.time(200_000);
    d.resolve({ data: { user: { id: A } }, error: null }); expect(await operation).toBe('blocked');
  });
  it('失効後の別ユーザーログインを拒否し、同一ユーザー再認証だけ許可', async () => {
    const f = fixture(); await f.auth.restore(); const old = f.auth.getContext()!;
    f.time(201_000); f.auth.getState(); f.setSession(session(B, 300)); f.setUser({ id: B });
    expect(await f.auth.login('b@example.invalid', 'synthetic')).toBe('blocked');
    expect(f.auth.getState().reason).toBe('different-user'); expect(f.auth.getState().reauthenticateUserId).toBe(A);
    f.setSession(session(A, 300)); f.setUser({ id: A.toUpperCase() });
    expect(await f.auth.login('a@example.invalid', 'synthetic')).toBe('applied'); expect(f.auth.isCurrent(old)).toBe(false);
  });
  it('別インスタンス・偽造・変更前世代のcontextを受理しない', async () => {
    const f = fixture(), g = fixture(); await f.auth.restore(); await g.auth.restore();
    const c = f.auth.getContext()!; expect(f.auth.isCurrent({ ...c })).toBe(false); expect(g.auth.isCurrent(c)).toBe(false);
    await f.auth.restore(); expect(f.auth.isCurrent(c)).toBe(false);
  });
  it('現在の認証失効通知だけを受け付け、再認証後へ古い要求を流用しない', async () => {
    const f = fixture(); await f.auth.restore(); const old = f.auth.getContext()!;
    expect(f.auth.requireReauthentication(old)).toBe(true); expect(f.auth.getContext()).toBeNull();
    await f.auth.login('a', 'b'); expect(f.auth.requireReauthentication(old)).toBe(false);
    expect(f.auth.getState().phase).toBe('authenticated');
    expect(f.auth.requireReauthentication({ ...f.auth.getContext()! })).toBe(false);
  });
  it('二重操作を抑止しログアウト開始直後から旧contextを使わせない', async () => {
    const f = fixture(); await f.auth.restore(); const c = f.auth.getContext()!;
    const d = deferred<{ error: unknown }>(); f.api.signOut.mockReturnValueOnce(d.promise);
    const first = f.auth.logout(); expect(f.auth.isCurrent(c)).toBe(false);
    expect(await f.auth.logout()).toBe('busy'); expect(await f.auth.login('a', 'b')).toBe('busy');
    d.resolve({ error: null }); expect(await first).toBe('applied');
    expect(f.api.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
    expect(f.auth.getState().phase).toBe('signed-out');
  });
  it('通常ログアウトはlocalを明示し、global・others・既定引数へ切り替えない', async () => {
    const f = fixture(); await f.auth.restore(); await f.auth.logout();
    expect(f.api.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
    expect(f.auth.getContext()).toBeNull();
  });
  it('SDKログインイベントと応答が重なっても復元確認後だけcontextを発行', async () => {
    const f = fixture(); f.api.signInWithPassword.mockImplementationOnce(async () => { f.emit('SIGNED_IN'); return { data: { session: session() }, error: null }; });
    await f.auth.login('a', 'b'); await flush(); expect(f.auth.getState().phase).toBe('authenticated');
    expect(f.api.signInWithPassword).toHaveBeenCalledTimes(1);
  });
  it('ログアウトイベントと完了が重なっても再認証を勝手に実行しない', async () => {
    const f = fixture(); await f.auth.restore(); f.api.signOut.mockImplementationOnce(async () => {
      f.setSession(null); f.emit('SIGNED_OUT'); return { error: null };
    });
    await f.auth.logout(); await flush(); expect(f.auth.getState().phase).toBe('signed-out');
    expect(f.api.signInWithPassword).not.toHaveBeenCalled();
  });
  it('イベントは即時に旧contextを無効化し、SDK再呼出しはcallbackの後', async () => {
    const f = fixture(); await f.auth.restore(); const c = f.auth.getContext()!, calls = f.api.getSession.mock.calls.length;
    f.emit(); expect(f.auth.isCurrent(c)).toBe(false); expect(f.api.getSession).toHaveBeenCalledTimes(calls);
    await flush(); expect(f.auth.getState().phase).toBe('authenticated');
  });
  it('イベント連続通知の古い予約は実行しない', async () => {
    const f = fixture(); f.emit(); f.emit(); await flush(); expect(f.api.getSession).toHaveBeenCalledTimes(1);
  });
  it('再確認中にイベントが続いてもSDK確認を無限再実行しない', async () => {
    const f = fixture(); f.api.getSession.mockImplementation(async () => {
      f.emit('USER_UPDATED'); return { data: { session: session() }, error: null };
    });
    f.emit(); await flush(); expect(f.api.getSession).toHaveBeenCalledTimes(1);
    expect(f.auth.getContext()).toBeNull();
  });
  it('ログイン成功直後の同一イベント重複は新しい確認済みcontextを利用できる', async () => {
    const f = fixture(); await f.auth.restore(); const old = f.auth.getContext()!;
    f.api.signInWithPassword.mockImplementationOnce(async () => {
      f.emit('SIGNED_IN'); f.emit('SIGNED_IN'); return { data: { session: session() }, error: null };
    });
    expect(await f.auth.login('a', 'b')).toBe('applied'); await flush();
    expect(f.auth.getState().phase).toBe('authenticated'); expect(f.auth.isCurrent(old)).toBe(false);
    expect(f.auth.isCurrent(f.auth.getContext()!)).toBe(true); expect(f.api.getSession).toHaveBeenCalledTimes(1);
    expect(f.api.signInWithPassword).toHaveBeenCalledTimes(1);
  });
  it('イベント再確認中の同一トークン更新イベントも確認成功をblockedへ戻さない', async () => {
    const f = fixture(); await f.auth.restore(); const old = f.auth.getContext()!;
    f.api.getSession.mockImplementationOnce(async () => {
      f.emit('TOKEN_REFRESHED'); f.emit('TOKEN_REFRESHED'); return { data: { session: session() }, error: null };
    });
    f.emit('TOKEN_REFRESHED'); expect(f.auth.getContext()).toBeNull(); await flush();
    expect(f.auth.getState().phase).toBe('authenticated'); expect(f.auth.isCurrent(old)).toBe(false);
    expect(f.api.getSession).toHaveBeenCalledTimes(2);
  });
  it.each(['getSession', 'getUser'] as const)('ログイン後の再確認%s失敗は停止し、明示restoreでのみ今回の再確認をやり直す', async method => {
    const f = fixture(); await f.auth.restore(); const old = f.auth.getContext()!;
    f.api.signInWithPassword.mockImplementationOnce(async () => {
      f.setSession({ ...session(), access_token: 'synthetic-new-token' }); f.emit('TOKEN_REFRESHED');
      return { data: { session: session() }, error: null };
    });
    f.api[method].mockRejectedValueOnce(new Error('synthetic-private'));
    // getUserは先にログイン応答の確認で使うため、失敗はその次の読取確認に限定する。
    if (method === 'getUser') f.api.getUser.mockReset().mockResolvedValueOnce({ data: { user: { id: A } }, error: null })
      .mockRejectedValueOnce(new Error('synthetic-private')).mockResolvedValue({ data: { user: { id: A } }, error: null });
    await f.auth.login('a', 'b'); await flush();
    expect(f.auth.getState().phase).toBe('blocked'); expect(f.auth.getState().reauthenticateUserId).toBe(A);
    expect(f.auth.getContext()).toBeNull(); expect(f.auth.isCurrent(old)).toBe(false);
    const calls = f.api.getSession.mock.calls.length; await flush(); expect(f.api.getSession).toHaveBeenCalledTimes(calls);
    expect(await f.auth.restore()).toBe('applied'); expect(f.auth.getState().phase).toBe('authenticated');
    expect(f.auth.isCurrent(old)).toBe(false); expect(f.api.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.auth.getState())).not.toContain('synthetic');
  });
  it.each([
    { ...session(), access_token: 'synthetic-other-token' }, session(A, 300), session(B), null,
  ])('再確認中のトークン・期限・ユーザー・失効の相違を重複扱いしない %#', async eventSession => {
    const f = fixture(); await f.auth.restore(); const old = f.auth.getContext()!;
    f.api.getSession.mockImplementationOnce(async () => {
      f.setSession(eventSession); f.emit('TOKEN_REFRESHED'); return { data: { session: session() }, error: null };
    });
    f.emit(); await flush(); expect(f.auth.getContext()).toBeNull(); expect(f.auth.isCurrent(old)).toBe(false);
    expect(f.api.getSession).toHaveBeenCalledTimes(2); expect(f.api.signInWithPassword).not.toHaveBeenCalled();
  });
  it('イベントの生sessionだけを認証根拠にせず、SDKの現在値を確認する', async () => {
    const f = fixture(); await f.auth.restore(); f.setSession(null); f.emit('SIGNED_OUT');
    await flush(); expect(f.auth.getState().phase).toBe('blocked');
    expect(f.auth.getState().reauthenticateUserId).toBe(A); expect(f.auth.getContext()).toBeNull();
  });
  it('ログイン確認中に別ユーザーへ変化しても旧応答からcontextを復活させない', async () => {
    const f = fixture(), d = deferred<Awaited<ReturnType<MemoAuthApi['getUser']>>>();
    f.api.getUser.mockReturnValueOnce(d.promise); const p = f.auth.login('a', 'b'); await flush();
    f.setSession(session(B)); f.setUser({ id: B }); f.emit('SIGNED_IN');
    expect(f.auth.getContext()).toBeNull(); d.resolve({ data: { user: { id: A } }, error: null });
    await p; expect(f.auth.getContext()).toBeNull(); await flush();
    expect(f.auth.getState().reason).toBe('different-user'); expect(f.auth.getContext()).toBeNull();
  });
  it('破棄後の遅い応答・イベントは無効、購読解除は一度', async () => {
    const f = fixture(), d = deferred<Awaited<ReturnType<MemoAuthApi['getSession']>>>();
    f.api.getSession.mockReturnValueOnce(d.promise); const p = f.auth.restore(); f.auth.dispose(); f.auth.dispose(); f.emit();
    d.resolve({ data: { session: session() }, error: null }); expect(await p).toBe('stale');
    expect(f.auth.getState().phase).toBe('disposed'); expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    expect(await f.auth.login('a', 'b')).toBe('stale');
  });
  it.each(['getSession', 'getUser', 'signInWithPassword', 'signOut'] as const)('%sの機密例外を返さず、自動再実行しない', async method => {
    const f = fixture(); f.api[method].mockRejectedValueOnce(new Error('synthetic-private-token'));
    const result = method === 'signOut' ? await f.auth.logout() : method === 'signInWithPassword' ? await f.auth.login('a', 'b') : await f.auth.restore();
    expect(result).toBe('blocked'); expect(JSON.stringify(f.auth.getState())).not.toContain('synthetic-private');
    expect(f.api[method]).toHaveBeenCalledTimes(1); expect(f.auth.getContext()).toBeNull();
  });
  it('ログアウト拒否は成功とせず以前のユーザーとの対応を残す', async () => {
    const f = fixture(); await f.auth.restore(); f.api.signOut.mockResolvedValueOnce({ error: { message: 'private' } });
    expect(await f.auth.logout()).toBe('blocked'); expect(f.auth.getState().reauthenticateUserId).toBe(A);
  });
  it.each([
    ['error', 'restore'], ['throw', 'restore'], ['error', 'event'], ['throw', 'event'],
  ] as const)('ログアウト%sと待機中イベントでは自動復帰せず、後続%sで再確認する', async (failure, recovery) => {
    const f = fixture(); await f.auth.restore(); const old = f.auth.getContext()!;
    const d = deferred<{ error: unknown }>();
    f.api.signOut.mockImplementationOnce(async () => {
      const result = await d.promise;
      if (failure === 'throw') throw new Error('synthetic-private');
      return result;
    });
    const operation = f.auth.logout(); f.emit('TOKEN_REFRESHED');
    d.resolve({ error: { message: 'synthetic-private' } });
    expect(await operation).toBe('blocked'); await flush();
    expect(f.auth.getState().phase).toBe('blocked'); expect(f.auth.getState().reauthenticateUserId).toBe(A);
    expect(f.auth.getContext()).toBeNull(); expect(f.auth.isCurrent(old)).toBe(false);
    expect(f.api.getSession).toHaveBeenCalledTimes(1); expect(f.api.getUser).toHaveBeenCalledTimes(1);
    await flush(); expect(f.api.getSession).toHaveBeenCalledTimes(1);
    if (recovery === 'restore') expect(await f.auth.restore()).toBe('applied');
    else { f.emit('TOKEN_REFRESHED'); await flush(); }
    expect(f.auth.getState().phase).toBe('authenticated'); expect(f.auth.isCurrent(old)).toBe(false);
    expect(f.api.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
    expect(f.api.signInWithPassword).not.toHaveBeenCalled();
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

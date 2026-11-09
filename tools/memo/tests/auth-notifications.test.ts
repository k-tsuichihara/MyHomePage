import { expect, it, vi } from 'vitest';
import { createMemoAuthSession, type MemoAuthApi, type MemoAuthState } from '../src/auth-session';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const raw = () => ({ user: { id: A, email: 'synthetic@example.invalid' }, access_token: 'synthetic-token', expires_at: 200 });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture() {
  let now = 100_000, current: unknown = raw();
  let callback!: (event: string, session: unknown) => void;
  const api: MemoAuthApi = {
    getSession: vi.fn(async () => ({ data: { session: current }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: { id: A } }, error: null })),
    signInWithPassword: vi.fn(async () => ({ data: { session: current }, error: null })),
    signOut: vi.fn(async () => { current = null; return { error: null }; }),
    onAuthStateChange: vi.fn(cb => { callback = cb; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
  };
  const auth = createMemoAuthSession(api, () => now);
  return { auth, api, time: (value: number) => { now = value; }, emit: (event = 'TOKEN_REFRESHED') => callback(event, current) };
}
function collect(auth: ReturnType<typeof createMemoAuthSession>) {
  const states: MemoAuthState[] = [];
  const off = auth.subscribe(state => { states.push(state); });
  return { states, off };
}
it('初回は非同期に最新の不変状態を通知し、購読だけではSDK要求を発行しない', async () => {
  const f = fixture(), { states } = collect(f.auth);
  expect(states).toEqual([]); await flush();
  expect(states.map(s => s.phase)).toEqual(['signed-out']); expect(Object.isFrozen(states[0])).toBe(true);
  expect(f.api.getSession).not.toHaveBeenCalled(); expect(f.api.signInWithPassword).not.toHaveBeenCalled();
  expect(f.api.signOut).not.toHaveBeenCalled(); f.auth.dispose();
});
it.each(['restore', 'login'] as const)('%sのcheckingから最終認証まで通知し、資格情報を含めない', async kind => {
  const f = fixture(), { states } = collect(f.auth); await flush();
  await (kind === 'restore' ? f.auth.restore() : f.auth.login('synthetic@example.invalid', 'synthetic-password')); await flush();
  expect(states.map(s => s.phase)).toEqual(['signed-out', 'checking', 'authenticated']);
  expect(states.at(-1)?.reauthenticateUserId).toBeNull();
  expect(JSON.stringify(states)).not.toMatch(/synthetic|password|token|email/);
  expect(new Set(states.map(s => s.generation)).size).toBe(states.length); f.auth.dispose();
});
it('ログアウト成功は再認証対象を残さず通知し、localを維持する', async () => {
  const f = fixture(); await f.auth.restore(); const { states } = collect(f.auth); await flush();
  await f.auth.logout(); await flush();
  expect(states.map(s => s.phase)).toEqual(['authenticated', 'checking', 'signed-out']);
  expect(states.at(-1)?.reauthenticateUserId).toBeNull();
  expect(f.api.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' }); f.auth.dispose();
});
it('ログイン中の同一SDKイベント重複でauthenticatedを二重通知しない', async () => {
  const f = fixture(), { states } = collect(f.auth); await flush();
  vi.mocked(f.api.signInWithPassword).mockImplementationOnce(async () => {
    f.emit(); f.emit(); return { data: { session: raw() }, error: null };
  });
  await f.auth.login('synthetic@example.invalid', 'synthetic-password'); await flush();
  expect(states.map(s => s.phase)).toEqual(['signed-out', 'checking', 'authenticated']);
  expect(f.auth.getContext()).not.toBeNull(); f.auth.dispose();
});
it('SDK通知では旧contextを先に無効化し、読取再確認後に新状態を通知する', async () => {
  const f = fixture(); await f.auth.restore(); const old = f.auth.getContext()!;
  const { states } = collect(f.auth); await flush(); f.emit();
  expect(f.auth.isCurrent(old)).toBe(false); await flush();
  expect(states.map(s => s.phase)).toEqual(['authenticated', 'blocked', 'checking', 'authenticated']);
  expect(new Set(states.map(s => s.generation)).size).toBe(states.length); f.auth.dispose();
});
it.each(['getState', 'getContext', 'isCurrent'] as const)('%sで期限到達を検出し、操作許可を止めて一度だけ通知する', async method => {
  const f = fixture(); await f.auth.restore(); const old = f.auth.getContext()!;
  const { states } = collect(f.auth); await flush(); f.time(200_000);
  // 経過だけでは自動タイマーを作らない。
  await flush(); expect(states).toHaveLength(1);
  if (method === 'isCurrent') expect(f.auth.isCurrent(old)).toBe(false); else f.auth[method]();
  expect(f.auth.getContext()).toBeNull(); await flush();
  expect(states).toHaveLength(2); expect(states[1]).toMatchObject({ phase: 'blocked', reason: 'expired', reauthenticateUserId: A });
  f.auth.getState(); f.auth.isCurrent(old); await flush(); expect(states).toHaveLength(2); f.auth.dispose();
});
it('明示失効は現在contextだけを受理し、同じ失効を二重通知しない', async () => {
  const f = fixture(); await f.auth.restore(); const old = f.auth.getContext()!;
  const { states } = collect(f.auth); await flush();
  expect(f.auth.requireReauthentication(old)).toBe(true); expect(f.auth.requireReauthentication(old)).toBe(false);
  await flush(); expect(states.map(s => s.phase)).toEqual(['authenticated', 'blocked']); f.auth.dispose();
});
it('解除は冪等で、待機中の初回通知と以降の通知を止める', async () => {
  const f = fixture(), { states, off } = collect(f.auth); off(); off(); await flush();
  await f.auth.restore(); await flush(); f.auth.dispose(); await flush(); expect(states).toEqual([]);
});
it('初回通知のたびに新規購読を追加しても同世代のmicrotask連鎖を作らない', async () => {
  const f = fixture(), calls: MemoAuthState[] = [], stops: (() => void)[] = [];
  const listener = (state: MemoAuthState) => {
    calls.push(state);
    // 修正前でもテスト自体が飢餓状態にならないよう、再現操作は8回で打ち切る。
    if (calls.length < 8) stops.push(f.auth.subscribe(listener));
  };
  stops.push(f.auth.subscribe(listener)); await flush();
  expect(calls).toHaveLength(1);
  expect(stops).toHaveLength(2);
  stops.forEach(stop => stop()); f.auth.dispose();
});
it('表示通知内で自己解除・再購読しても、次の状態変更までは再通知しない', async () => {
  const f = fixture(); let stop = () => {}, count = 0;
  const listener = () => {
    count++; stop();
    if (count < 8) stop = f.auth.subscribe(listener);
  };
  stop = f.auth.subscribe(listener); await flush(); expect(count).toBe(1);
  f.auth.getState(); await flush(); expect(count).toBe(1);
  await f.auth.restore(); await flush(); expect(count).toBe(3);
  stop(); f.auth.dispose();
});
it('通知中の他購読解除と追加を扱い、新規購読は次の世代から受け取る', async () => {
  const f = fixture(), second = vi.fn(), third = vi.fn(); let stop = () => {}, stopFirst = () => {};
  stopFirst = f.auth.subscribe(() => { stopFirst(); stop(); f.auth.subscribe(third); }); stop = f.auth.subscribe(second);
  await flush(); expect(second).not.toHaveBeenCalled(); expect(third).not.toHaveBeenCalled();
  await f.auth.restore(); await flush();
  expect(third.mock.calls.map(call => call[0].phase)).toEqual(['checking', 'authenticated']);
  f.auth.dispose();
});
it('購読例外・非同期拒否を伝播/記録せず、他の購読と認証結果を保持する', async () => {
  const f = fixture(), log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    f.auth.subscribe(() => { throw new Error('synthetic-private'); });
    f.auth.subscribe(async () => { throw new Error('synthetic-private-async'); });
    const { states } = collect(f.auth); await f.auth.restore(); await flush();
    expect(states.at(-1)?.phase).toBe('authenticated'); expect(f.auth.getContext()).not.toBeNull();
    expect(log).not.toHaveBeenCalled();
  } finally { f.auth.dispose(); await flush(); log.mockRestore(); }
});
it('通知中のdisposeで他購読へ旧authenticatedを配信せず、終端状態だけを渡す', async () => {
  const f = fixture(); await f.auth.restore();
  f.auth.subscribe(state => { if (state.phase === 'authenticated') f.auth.dispose(); });
  const { states } = collect(f.auth); await flush();
  expect(states.map(s => s.phase)).toEqual(['disposed']); expect(f.auth.getContext()).toBeNull();
});
it('通知中の期限到達で後続購読へ古い認証状態を渡さない', async () => {
  const f = fixture(); await f.auth.restore();
  f.auth.subscribe(state => { if (state.phase === 'authenticated') { f.time(200_000); f.auth.getState(); } });
  const { states } = collect(f.auth); await flush();
  expect(states.map(s => s.phase)).toEqual(['blocked']); f.auth.dispose();
});
it('disposeは既存購読へ終端を一度だけ通知し、新規購読と遅いSDK通知を止める', async () => {
  const f = fixture(), { states } = collect(f.auth); await flush();
  f.auth.dispose(); f.auth.dispose(); const late = vi.fn(); f.auth.subscribe(late); f.emit(); await flush();
  expect(states.map(s => s.phase)).toEqual(['signed-out', 'disposed']); expect(late).not.toHaveBeenCalled();
  expect(await f.auth.restore()).toBe('stale'); await flush(); expect(states).toHaveLength(2);
});
it('解除済みなら終端通知も届けない', async () => {
  const f = fixture(), { states, off } = collect(f.auth); await flush();
  f.auth.dispose(); off(); await flush(); expect(states.map(s => s.phase)).toEqual(['signed-out']);
});
it('処理中の購読からの再入はbusyとなり、SDK要求を二重実行しない', async () => {
  const f = fixture(), reentry: Promise<unknown>[] = [];
  f.auth.subscribe(state => { if (state.phase === 'checking') reentry.push(f.auth.logout()); });
  await f.auth.restore(); await flush(); expect(await Promise.all(reentry)).toEqual(['busy']);
  expect(f.api.getSession).toHaveBeenCalledTimes(1); expect(f.api.signOut).not.toHaveBeenCalled(); f.auth.dispose();
});
it('getUser待機後のdisposeと古い応答はauthenticatedを通知しない', async () => {
  const f = fixture(); let resolve!: (value: Awaited<ReturnType<MemoAuthApi['getUser']>>) => void;
  vi.mocked(f.api.getUser).mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const { states } = collect(f.auth); const pending = f.auth.restore(); await flush();
  f.auth.dispose(); await flush(); resolve({ data: { user: { id: A } }, error: null });
  expect(await pending).toBe('stale'); await flush();
  expect(states.map(s => s.phase)).toEqual(['checking', 'disposed']);
});
it('getUser完了付近の不一致SDK通知を照合する前にauthenticatedを通知しない', async () => {
  const f = fixture(), { states } = collect(f.auth);
  vi.mocked(f.api.getUser).mockImplementationOnce(async () => {
    queueMicrotask(() => f.emit('SIGNED_OUT'));
    return { data: { user: { id: A } }, error: null };
  }).mockResolvedValueOnce({ data: { user: null }, error: new Error('synthetic-private-recheck') });
  await f.auth.restore(); await flush();
  expect(states.some(s => s.phase === 'authenticated')).toBe(false);
  expect(f.auth.getContext()).toBeNull(); expect(f.api.getSession).toHaveBeenCalledTimes(2); f.auth.dispose();
});
it('SDK読取失敗は秘密値なしのblockedを通知し、自動再送しない', async () => {
  const f = fixture(); vi.mocked(f.api.getSession).mockRejectedValueOnce(new Error('synthetic-private'));
  const { states } = collect(f.auth); await f.auth.restore(); await flush();
  expect(states.at(-1)).toMatchObject({ phase: 'blocked', reason: 'unavailable' });
  expect(JSON.stringify(states)).not.toContain('synthetic'); expect(f.api.getSession).toHaveBeenCalledTimes(1); f.auth.dispose();
});

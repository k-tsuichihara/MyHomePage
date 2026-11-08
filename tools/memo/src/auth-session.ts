import { uuid, uuidKey } from './read-primitives';

/** SDKの秘密値を状態へ持ち出さないための最小注入境界。 */
export interface MemoAuthApi {
  getSession(): Promise<{ data: { session: unknown }; error: unknown }>;
  getUser(): Promise<{ data: { user: unknown }; error: unknown }>;
  signInWithPassword(credentials: { email: string; password: string }): Promise<{ data: { session: unknown }; error: unknown }>;
  signOut(options: { scope: 'local' }): Promise<{ error: unknown }>;
  onAuthStateChange(callback: (event: string, session: unknown) => void): {
    data: { subscription: { unsubscribe(): void } };
  };
}
export type AuthPhase = 'signed-out' | 'checking' | 'authenticated' | 'blocked' | 'disposed';
export type AuthReason = 'none' | 'unavailable' | 'invalid-session' | 'expired' | 'different-user';
export interface MemoAuthState {
  readonly phase: AuthPhase;
  readonly generation: number;
  readonly userId: string | null;
  readonly reauthenticateUserId: string | null;
  readonly expiresAt: number | null;
  readonly reason: AuthReason;
}
export interface AuthContext { readonly userId: string; readonly generation: number }
export type AuthOperationResult = 'applied' | 'blocked' | 'busy' | 'stale';

function sessionIdentity(raw: unknown): { userId: string; expiresAt: number; accessToken: string } {
  const value = raw as { user?: { id?: unknown }; expires_at?: unknown; access_token?: unknown } | null;
  if (!value || typeof value.access_token !== 'string' || !value.access_token
    || typeof value.expires_at !== 'number' || !Number.isSafeInteger(value.expires_at) || value.expires_at <= 0) {
    throw new Error('invalid-session');
  }
  return { userId: uuid(value.user?.id), expiresAt: value.expires_at, accessToken: value.access_token };
}

/** 画面や保存先を変更せず、認証世代に結び付けた利用許可だけを返す。 */
export function createMemoAuthSession(auth: MemoAuthApi, now: () => number = Date.now) {
  let state: MemoAuthState = Object.freeze({ phase: 'signed-out', generation: 0, userId: null,
    reauthenticateUserId: null, expiresAt: null, reason: 'none' });
  let serial = 0;
  let busy = false;
  let disposed = false;
  // トークンは処理中の同一性比較だけに使い、状態・contextへ含めず消費後に参照を外す。
  let pendingEvent: { name: string; identity: ReturnType<typeof sessionIdentity> | null } | null = null;
  const contexts = new WeakSet<object>();
  function update(phase: AuthPhase, reason: AuthReason = 'none', userId: string | null = null, expiresAt: number | null = null) {
    state = Object.freeze({ phase, reason, generation: ++serial, userId, expiresAt,
      reauthenticateUserId: state.reauthenticateUserId });
  }
  function block(reason: AuthReason) {
    const previous = state.userId ?? state.reauthenticateUserId;
    update('blocked', reason);
    state = Object.freeze({ ...state, reauthenticateUserId: previous });
  }
  function getState(): MemoAuthState {
    if (state.phase === 'authenticated' && state.expiresAt! * 1000 <= now()) block('expired');
    return state;
  }
  async function verify(raw: unknown, attempt: number): Promise<AuthOperationResult> {
    if (disposed || attempt !== serial) return 'stale';
    if (raw === null) {
      if (state.reauthenticateUserId) block('expired');
      else update('signed-out');
      return state.phase === 'blocked' ? 'blocked' : 'applied';
    }
    let identity: ReturnType<typeof sessionIdentity>;
    try { identity = sessionIdentity(raw); }
    catch { block('invalid-session'); return 'blocked'; }
    if (identity.expiresAt * 1000 <= now()) { block('expired'); return 'blocked'; }
    try {
      const response = await auth.getUser();
      if (disposed || attempt !== serial) return 'stale';
      const verifiedId = uuid((response.data.user as { id?: unknown } | null)?.id);
      if (response.error || uuidKey(verifiedId) !== uuidKey(identity.userId)) { block('invalid-session'); return 'blocked'; }
      if (state.reauthenticateUserId && uuidKey(verifiedId) !== uuidKey(state.reauthenticateUserId)) {
        block('different-user'); return 'blocked';
      }
      if (identity.expiresAt * 1000 <= now()) { block('expired'); return 'blocked'; }
      update('authenticated', 'none', verifiedId, identity.expiresAt);
      state = Object.freeze({ ...state, reauthenticateUserId: null });
      return 'applied';
    } catch {
      if (disposed || attempt !== serial) return 'stale';
      block('unavailable'); return 'blocked';
    }
  }
  async function run(kind: 'restore' | 'login' | 'logout', credentials?: { email: string; password: string }, fromEvent = false): Promise<AuthOperationResult> {
    if (disposed) return 'stale';
    if (busy) return 'busy';
    if (!subscription && kind !== 'logout') { block('unavailable'); return 'blocked'; }
    // 処理中は以前のcontextを使わせず、失敗時も元ユーザーのドラフトとの対応を保持する。
    const previous = getState().userId ?? state.reauthenticateUserId;
    update('checking');
    state = Object.freeze({ ...state, reauthenticateUserId: previous });
    const attempt = serial;
    busy = true;
    let confirmedSession: ReturnType<typeof sessionIdentity> | null = null;
    try {
      if (kind === 'logout') {
        const response = await auth.signOut({ scope: 'local' });
        if (disposed || attempt !== serial) return 'stale';
        if (response.error) { block('unavailable'); return 'blocked'; }
        update('signed-out');
        state = Object.freeze({ ...state, reauthenticateUserId: null });
        return 'applied';
      }
      const response = kind === 'login'
        ? await auth.signInWithPassword(credentials!) : await auth.getSession();
      if (disposed || attempt !== serial) return 'stale';
      if (response.error) { block('unavailable'); return 'blocked'; }
      if (kind === 'login' && response.data.session === null) { block('invalid-session'); return 'blocked'; }
      // await中のSDKオブジェクト変更を、検証済みセッションの変更と誤認しない。
      let candidate: ReturnType<typeof sessionIdentity> | null;
      try { candidate = response.data.session === null ? null : sessionIdentity(response.data.session); }
      catch { block('invalid-session'); return 'blocked'; }
      const result = await verify(response.data.session, attempt);
      if (result === 'applied' && state.phase === 'authenticated') confirmedSession = candidate;
      return result;
    } catch {
      if (disposed || attempt !== serial) return 'stale';
      block('unavailable'); return 'blocked';
    } finally {
      busy = false;
      if (pendingEvent && !disposed) {
        const event = pendingEvent;
        pendingEvent = null;
        const duplicate = confirmedSession && event.identity
          && ['SIGNED_IN', 'TOKEN_REFRESHED', 'INITIAL_SESSION'].includes(event.name)
          && uuidKey(confirmedSession.userId) === uuidKey(event.identity.userId)
          && confirmedSession.expiresAt === event.identity.expiresAt
          && confirmedSession.accessToken === event.identity.accessToken;
        // 新しく確認したセッションとの一致だけをまとめ、以前のcontextは復活させない。
        if (!duplicate) {
          block('unavailable');
          const generation = serial;
          // 異なるイベントの再確認を連鎖させず、上限に達したら書込停止する。
          if (!fromEvent) queueMicrotask(() => { if (!disposed && generation === serial) void run('restore', undefined, true); });
        }
      }
      pendingEvent = null;
    }
  }
  let subscription: { unsubscribe(): void } | undefined;
  try {
    subscription = auth.onAuthStateChange((event, session) => {
      if (disposed) return;
      if (busy) {
        let identity: ReturnType<typeof sessionIdentity> | null = null;
        try { identity = sessionIdentity(session); } catch { /* 不正イベントは重複と認めない。 */ }
        pendingEvent = { name: event, identity }; return;
      }
      // SDK callbackから別のSDK処理をawaitしない。受信内容自体を認証済みと扱わない。
      block('unavailable');
      const eventGeneration = serial;
      queueMicrotask(() => {
        if (disposed || eventGeneration !== serial || busy) return;
        void run('restore', undefined, true);
      });
    }).data.subscription;
  } catch { block('unavailable'); }
  return Object.freeze({
    getState,
    restore: () => run('restore'),
    login: (email: string, password: string) => run('login', { email, password }),
    logout: () => run('logout'),
    getContext(): AuthContext | null {
      const current = getState();
      if (current.phase !== 'authenticated') return null;
      const context = Object.freeze({ userId: current.userId!, generation: current.generation });
      contexts.add(context); return context;
    },
    isCurrent(context: AuthContext): boolean {
      const current = getState();
      return contexts.has(context) && current.phase === 'authenticated'
        && current.generation === context.generation && current.userId === context.userId;
    },
    /** C04が現在の要求に対する認証失効を確認した時だけ通知する。古い要求では新セッションを止めない。 */
    requireReauthentication(context: AuthContext): boolean {
      const current = getState();
      if (!contexts.has(context) || current.phase !== 'authenticated'
        || context.generation !== current.generation || context.userId !== current.userId) return false;
      block('expired'); return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true; update('disposed');
      pendingEvent = null;
      try { subscription?.unsubscribe(); } catch { /* SDK例外を秘密値ごと外へ渡さない。 */ }
    },
  });
}

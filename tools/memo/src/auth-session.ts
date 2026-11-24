import { uuid, uuidKey } from './read-primitives';
import type { CloudTransport, CloudTransportResponse, RpcName, CloudCall } from './cloud-rpc-types';

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
export type AuthReason = 'none' | 'unavailable' | 'invalid-session' | 'expired' | 'different-user' | 'credentials-rejected';
export interface MemoAuthState {
  readonly phase: AuthPhase;
  readonly generation: number;
  readonly userId: string | null;
  readonly reauthenticateUserId: string | null;
  readonly expiresAt: number | null;
  readonly reason: AuthReason;
}
export interface AuthContext { readonly userId: string; readonly generation: number }
export type AuthStateListener = (state: MemoAuthState) => void;
export type AuthOperationResult = 'applied' | 'blocked' | 'busy' | 'stale';
export type AuthenticatedRpcSender = (
  accessToken: string,
  rpc: RpcName,
  args: CloudCall['args'],
) => Promise<CloudTransportResponse>;
export type AuthRpcPreparation = {
  readonly kind: 'ready';
  readonly ownerId: string;
  readonly transport: CloudTransport;
  readonly wasSent: () => boolean;
}
  | { readonly kind: 'stopped'; readonly reason: 'not-current' | 'unavailable' | 'owner-mismatch' };

function sessionIdentity(raw: unknown): { userId: string; expiresAt: number; accessToken: string } {
  const value = raw as { user?: { id?: unknown }; expires_at?: unknown; access_token?: unknown } | null;
  if (!value || typeof value.access_token !== 'string' || !value.access_token
    || typeof value.expires_at !== 'number' || !Number.isSafeInteger(value.expires_at) || value.expires_at <= 0) {
    throw new Error('invalid-session');
  }
  return { userId: uuid(value.user?.id), expiresAt: value.expires_at, accessToken: value.access_token };
}
function authErrorReason(error: unknown): AuthReason {
  if (!error || typeof error !== 'object') return 'unavailable';
  const value = error as { code?: unknown; error_code?: unknown };
  const code = value.code ?? value.error_code;
  return code === 'invalid_credentials' || code === 'user_not_found' || code === 'user_banned'
    ? 'credentials-rejected' : 'unavailable';
}

/** 画面や保存先を変更せず、認証世代に結び付けた利用許可だけを返す。 */
export function createMemoAuthSession(
  auth: MemoAuthApi,
  now: () => number = Date.now,
  rpcSender?: AuthenticatedRpcSender,
) {
  let state: MemoAuthState = Object.freeze({ phase: 'signed-out', generation: 0, userId: null,
    reauthenticateUserId: null, expiresAt: null, reason: 'none' });
  let lastFailureReason: AuthReason = 'none';
  let serial = 0;
  let busy = false;
  let disposed = false;
  const contexts = new WeakSet<object>();
  const listeners = new Map<object, { listener: AuthStateListener; generation: number }>();
  let notificationQueued = false;
  let notifying = false;
  // 認証処理の途中へUIを同期再入させず、確定した最新状態だけを通知する。
  function queueNotification() {
    if (notificationQueued || listeners.size === 0) return;
    notificationQueued = true;
    queueMicrotask(() => {
      notificationQueued = false;
      const snapshot = getState();
      notifying = true;
      for (const [key, observer] of [...listeners]) {
        if (state.generation !== snapshot.generation) { queueNotification(); break; }
        if (!listeners.has(key) || observer.generation === snapshot.generation) continue;
        observer.generation = snapshot.generation;
        try {
          // async関数を渡された場合も、拒否理由をログや認証状態へ流さない。
          void Promise.resolve(observer.listener(snapshot)).catch(() => {});
        } catch { /* 表示先の例外で認証処理や他の購読を壊さない。 */ }
      }
      notifying = false;
      if (snapshot.phase === 'disposed') listeners.clear();
    });
  }
  function update(phase: AuthPhase, reason: AuthReason = 'none', userId: string | null = null, expiresAt: number | null = null) {
    state = Object.freeze({ phase, reason, generation: ++serial, userId, expiresAt,
      reauthenticateUserId: state.reauthenticateUserId });
    queueNotification();
  }
  function block(reason: AuthReason) {
    lastFailureReason = reason;
    const previous = state.userId ?? state.reauthenticateUserId;
    update('blocked', reason);
    state = Object.freeze({ ...state, reauthenticateUserId: previous });
  }
  function getState(): MemoAuthState {
    if (state.phase === 'authenticated' && state.expiresAt! * 1000 <= now()) block('expired');
    return state;
  }
  function isCurrent(context: AuthContext): boolean {
    const current = getState();
    return contexts.has(context) && current.phase === 'authenticated'
      && current.generation === context.generation && current.userId === context.userId;
  }
  function requireReauthentication(context: AuthContext): boolean {
    const current = getState();
    if (!contexts.has(context) || current.phase !== 'authenticated'
      || context.generation !== current.generation || context.userId !== current.userId) return false;
    block('expired'); return true;
  }
  // SDK通知はSDKが確定したsessionとして扱う。保留中もtokenは保存・比較しない。
  type Identity = { userId: string; expiresAt: number };
  type SessionEvent = { identity: Identity | null; invalid: boolean };
  let pendingEvent: SessionEvent | undefined;
  let operationSerial = 0;
  function readEvent(raw: unknown): SessionEvent {
    if (raw === null) return { identity: null, invalid: false };
    try {
      const { userId, expiresAt } = sessionIdentity(raw);
      return { identity: { userId, expiresAt }, invalid: false };
    } catch { return { identity: null, invalid: true }; }
  }
  function accept(event: SessionEvent): AuthOperationResult {
    if (event.invalid) { block('invalid-session'); return 'blocked'; }
    const identity = event.identity;
    if (!identity) {
      if (state.userId || state.reauthenticateUserId) { block('expired'); return 'blocked'; }
      lastFailureReason = 'none'; update('signed-out'); return 'applied';
    }
    const owner = state.userId ?? state.reauthenticateUserId;
    if (owner && uuidKey(owner) !== uuidKey(identity.userId)) { block('different-user'); return 'blocked'; }
    if (identity.expiresAt * 1000 <= now()) { block('expired'); return 'blocked'; }
    lastFailureReason = 'none';
    update('authenticated', 'none', identity.userId, identity.expiresAt);
    state = Object.freeze({ ...state, reauthenticateUserId: null });
    return 'applied';
  }
  function takeEvent() { const event = pendingEvent; pendingEvent = undefined; return event; }
  async function run(kind: 'restore' | 'login' | 'logout', credentials?: { email: string; password: string }): Promise<AuthOperationResult> {
    if (disposed) return 'stale';
    if (busy) return 'busy';
    if (!subscription && kind !== 'logout') { block('unavailable'); return 'blocked'; }
    const owner = getState().userId ?? state.reauthenticateUserId;
    update('checking');
    state = Object.freeze({ ...state, reauthenticateUserId: owner });
    const attempt = ++operationSerial;
    busy = true;
    pendingEvent = undefined;
    try {
      if (kind === 'logout') {
        const response = await auth.signOut({ scope: 'local' });
        if (disposed || attempt !== operationSerial) return 'stale';
        // SDKがlocal sessionを先に消していても、失敗をlogout成功と読み替えない。
        if (response.error) { block('unavailable'); return 'blocked'; }
        lastFailureReason = 'none';
        update('signed-out');
        state = Object.freeze({ ...state, reauthenticateUserId: null });
        return 'applied';
      }
      const response = kind === 'login' ? await auth.signInWithPassword(credentials!) : await auth.getSession();
      if (disposed || attempt !== operationSerial) return 'stale';
      if (response.error) { block(kind === 'login' ? authErrorReason(response.error) : 'unavailable'); return 'blocked'; }
      const result = readEvent(response.data.session), event = takeEvent();
      if (kind === 'login' && !result.identity) { block('invalid-session'); return 'blocked'; }
      // SDKの後続通知が別user/署名アウトを示した場合、先行login完了でD05へ進めない。
      if (event) {
        const changedUser = event.identity?.userId && result.identity?.userId
          ? uuidKey(event.identity.userId) !== uuidKey(result.identity.userId) : event.identity !== result.identity;
        const accepted = accept(event);
        return changedUser && accepted === 'applied' ? 'stale' : accepted;
      }
      return accept(result);
    } catch {
      if (disposed || attempt !== operationSerial) return 'stale';
      block('unavailable'); return 'blocked';
    } finally { busy = false; pendingEvent = undefined; }
  }
  let subscription: { unsubscribe(): void } | undefined;
  try {
    subscription = auth.onAuthStateChange((_event, raw) => {
      if (disposed) return;
      const event = readEvent(raw);
      if (busy) { pendingEvent = event; return; }
      // callbackからSDKを再呼出ししない。新しい世代に反映して旧要求を無効化する。
      accept(event);
    }).data.subscription;
  } catch { block('unavailable'); }
  return Object.freeze({
    getState,
    getLastFailureReason: () => lastFailureReason,
    /** 表示専用。初回も最新値を非同期で渡し、解除後と終端通知後は配信しない。 */
    subscribe(listener: AuthStateListener): () => void {
      if (disposed) return () => {};
      const key = {};
      // 通知内の再購読から初回通知を連鎖させない。登録時世代は現在値で取得できる。
      listeners.set(key, { listener, generation: notifying ? state.generation : -1 });
      if (!notifying) queueNotification();
      return () => { listeners.delete(key); };
    },
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
      return isCurrent(context);
    },
    /**
     * UIへ資格情報を渡さず、現在の認証世代に限定した1回のRPC transportを準備する。
     * 準備時にセッションを再取得し、1回限りの送信直前までcontextと所有者を照合する。
     */
    async prepareRpc(context: AuthContext): Promise<AuthRpcPreparation> {
      if (!rpcSender) return { kind: 'stopped', reason: 'unavailable' };
      if (!contexts.has(context) || !isCurrent(context)) {
        return { kind: 'stopped', reason: 'not-current' };
      }
      let raw: unknown;
      try {
        const response = await auth.getSession();
        if (response.error) return { kind: 'stopped', reason: 'unavailable' };
        raw = response.data.session;
      } catch {
        return { kind: 'stopped', reason: 'unavailable' };
      }
      if (!isCurrent(context)) return { kind: 'stopped', reason: 'not-current' };
      let identity: ReturnType<typeof sessionIdentity>;
      try { identity = sessionIdentity(raw); }
      catch { return { kind: 'stopped', reason: 'unavailable' }; }
      if (uuidKey(identity.userId) !== uuidKey(context.userId)) {
        return { kind: 'stopped', reason: 'owner-mismatch' };
      }
      if (identity.expiresAt * 1000 <= now()) {
        requireReauthentication(context);
        return { kind: 'stopped', reason: 'not-current' };
      }
      let consumed = false;
      let sent = false;
      const transport: CloudTransport = async (rpc, args) => {
        if (consumed || !isCurrent(context) || identity.expiresAt * 1000 <= now()) throw new Error('auth-context-stale');
        consumed = true;
        sent = true;
        return rpcSender(identity.accessToken, rpc, args);
      };
      return Object.freeze({ kind: 'ready', ownerId: identity.userId, transport, wasSent: () => sent });
    },
    /** C04が現在の要求に対する認証失効を確認した時だけ通知する。古い要求では新セッションを止めない。 */
    requireReauthentication(context: AuthContext): boolean {
      return requireReauthentication(context);
    },
    dispose() {
      if (disposed) return;
      disposed = true; update('disposed');
      pendingEvent = undefined;
      try { subscription?.unsubscribe(); } catch { /* SDK例外を秘密値ごと外へ渡さない。 */ }
    },
  });
}

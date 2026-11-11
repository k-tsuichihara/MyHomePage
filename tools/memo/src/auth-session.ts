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
  // トークンは処理中の同一性比較だけに使い、状態・contextへ含めず消費後に参照を外す。
  let pendingEvent: { name: string; identity: ReturnType<typeof sessionIdentity> | null } | null = null;
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
  async function verify(raw: unknown, attempt: number): Promise<AuthOperationResult | { userId: string; expiresAt: number }> {
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
      // awaitの呼出元へ戻る間にも外部microtaskが動くため、ここでは認証状態を公開しない。
      return { userId: verifiedId, expiresAt: identity.expiresAt };
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
    let verifiedSession: { userId: string; expiresAt: number } | null = null;
    let logoutSucceeded = false;
    try {
      if (kind === 'logout') {
        const response = await auth.signOut({ scope: 'local' });
        if (disposed || attempt !== serial) return 'stale';
        if (response.error) { block('unavailable'); return 'blocked'; }
        logoutSucceeded = true;
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
      if (typeof result === 'object') {
        if (disposed || attempt !== serial) return 'stale';
        confirmedSession = candidate;
        verifiedSession = result;
        lastFailureReason = 'none';
        // 不一致イベントで停止しても、確認できたユーザーとドラフトの対応は保持する。
        state = Object.freeze({ ...state, reauthenticateUserId: state.reauthenticateUserId ?? result.userId });
        return 'applied';
      }
      return result;
    } catch {
      if (disposed || attempt !== serial) return 'stale';
      block('unavailable'); return 'blocked';
    } finally {
      busy = false;
      let canPublish = !pendingEvent;
      // 失敗したログアウト中の通知は消費だけ行い、意図せず書込許可を復活させない。
      if (pendingEvent && !disposed && (kind !== 'logout' || logoutSucceeded)) {
        const event = pendingEvent;
        pendingEvent = null;
        const duplicate = confirmedSession && event.identity
          && ['SIGNED_IN', 'TOKEN_REFRESHED', 'INITIAL_SESSION'].includes(event.name)
          && uuidKey(confirmedSession.userId) === uuidKey(event.identity.userId)
          && confirmedSession.expiresAt === event.identity.expiresAt
          && confirmedSession.accessToken === event.identity.accessToken;
        canPublish = !!duplicate;
        // 新しく確認したセッションとの一致だけをまとめ、以前のcontextは復活させない。
        if (!duplicate) {
          block('unavailable');
          const generation = serial;
          // 異なるイベントの再確認を連鎖させず、上限に達したら書込停止する。
          if (!fromEvent) queueMicrotask(() => { if (!disposed && generation === serial) void run('restore', undefined, true); });
        }
      }
      pendingEvent = null;
      // 保留イベント照合と認証済み公開の間にawaitを置かず、一時的なcontext発行を防ぐ。
      if (verifiedSession && canPublish && !disposed) {
        if (verifiedSession.expiresAt * 1000 <= now()) block('expired');
        else {
          update('authenticated', 'none', verifiedSession.userId, verifiedSession.expiresAt);
          state = Object.freeze({ ...state, reauthenticateUserId: null });
        }
      }
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
      pendingEvent = null;
      try { subscription?.unsubscribe(); } catch { /* SDK例外を秘密値ごと外へ渡さない。 */ }
    },
  });
}

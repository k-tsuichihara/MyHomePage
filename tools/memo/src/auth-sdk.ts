import { createClient } from '@supabase/supabase-js';
import { createMemoAuthClient, type AuthStorage } from './auth-client';
import { createMemoAuthSession, type MemoAuthApi } from './auth-session';

const STORAGE_KEY = 'myhomepage.memo.auth.v1';
// パスワード認証でもSDKのlogoutがPKCE一覧の空確認・除去を行うため固定補助キーを含める。
const STORAGE_KEYS = new Set([STORAGE_KEY, `${STORAGE_KEY}-user`, `${STORAGE_KEY}-code-verifier`, `${STORAGE_KEY}-flows-code-verifier`]);
const SAFE_ERROR_CODES = new Set(['invalid_credentials', 'refresh_token_not_found', 'refresh_token_already_used',
  'session_not_found', 'user_not_found', 'user_banned']);

/** SDKへはメモ専用キーだけを公開する。実Storageは呼出側が承認された環境で注入する。 */
export function createMemoSessionStorage(backing: AuthStorage) {
  let failed = false;
  let closed = false;
  async function access<T>(key: string, operation: () => T | Promise<T>): Promise<T> {
    if (closed || failed || !STORAGE_KEYS.has(key)) { failed = true; throw new Error('Memo Auth storage unavailable'); }
    try { return await operation(); }
    catch { failed = true; throw new Error('Memo Auth storage unavailable'); }
  }
  const storage: AuthStorage = Object.freeze({
    getItem: (key: string) => access(key, () => backing.getItem(key)),
    setItem: (key: string, value: string) => access(key, () => backing.setItem(key, value)),
    removeItem: (key: string) => access(key, () => backing.removeItem(key)),
  });
  return Object.freeze({ storage, isUnavailable: () => failed || closed, close: () => { closed = true; } });
}

/** 通信先と保存先は必須注入。SDKのimportやこの関数の参照だけでは実設定を読まない。 */
export function createMemoSdkAuth(config: { url: string; publicKey: string },
  backing: AuthStorage, transport: typeof fetch) {
  const ownedStorage = createMemoSessionStorage(backing);
  let closed = false;
  // 未初期化の値を参照しないよう、SDK生成は既存設定検証のfactory内だけで行う。
  let sdk: ReturnType<typeof createClient> | undefined;
  // SDKの初期通知はStorage例外を未処理Promiseにする場合がある。失敗は別に記録し、
  // SDKへは空値/無操作を返すが、下のAuth境界では必ずエラーにして利用を停止する。
  const sdkStorage: AuthStorage = {
    async getItem(key) { try { return await ownedStorage.storage.getItem(key); } catch { return null; } },
    async setItem(key, value) { try { await ownedStorage.storage.setItem(key, value); } catch { /* 停止状態は保持する。 */ } },
    async removeItem(key) { try { await ownedStorage.storage.removeItem(key); } catch { /* 停止状態は保持する。 */ } },
  };
  const safeFetch: typeof fetch = async (input, init) => {
    try {
      if (closed) throw new Error();
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const password = url.pathname === '/auth/v1/token' && method === 'POST'
        && url.searchParams.get('grant_type') === 'password';
      const refresh = url.pathname === '/auth/v1/token' && method === 'POST'
        && url.searchParams.get('grant_type') === 'refresh_token';
      const user = url.pathname === '/auth/v1/user' && method === 'GET' && !url.search;
      const logout = url.pathname === '/auth/v1/logout' && method === 'POST'
        && url.searchParams.get('scope') === 'local';
      if (url.origin !== config.url || url.hash || url.username || url.password
        || !(password || refresh || user || logout)
        || ((password || refresh || logout) && [...url.searchParams].length !== 1)) throw new Error();
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 15_000);
      try {
        const response = await transport(input, { ...init, redirect: 'error',
          signal: init?.signal ? AbortSignal.any([init.signal, abort.signal]) : abort.signal });
        if (closed || response.redirected || response.status >= 300 && response.status < 400) throw new Error();
        if (response.status === 204) return new Response(null, { status: 204 });
        // SDK内部のエラーログにも応答断片が入らないよう、JSON解析例外とエラー本文を固定化する。
        const data: unknown = JSON.parse(await response.text());
        if (closed) throw new Error();
        const rawCode = data && typeof data === 'object' ? (data as { code?: unknown; error_code?: unknown }).code
          ?? (data as { error_code?: unknown }).error_code : undefined;
        const code = typeof rawCode === 'string' && SAFE_ERROR_CODES.has(rawCode) ? rawCode : 'auth_request_failed';
        return new Response(JSON.stringify(response.ok ? data : { message: 'Memo Auth request failed', error_code: code }), {
          status: response.status, headers: { 'Content-Type': 'application/json' },
        });
      } finally { clearTimeout(timeout); }
    } catch { throw new Error('Memo Auth transport unavailable'); }
  };
  const client = createMemoAuthClient((url, key, options) => {
    sdk = createClient(url, key, { ...options, auth: { ...options.auth, debug: false }, global: { fetch: safeFetch } });
    return { auth: sdk.auth };
  }, config, sdkStorage);
  const error = () => new Error('Memo Auth storage unavailable');
  // SDKが初期化時のStorage例外を内部処理しても、空セッションとして使用可能にしない。
  const auth: MemoAuthApi = {
    async getSession() { const result = await client.auth.getSession(); return ownedStorage.isUnavailable() ? { ...result, error: error() } : result; },
    async getUser() { const result = await client.auth.getUser(); return ownedStorage.isUnavailable() ? { ...result, error: error() } : result; },
    async signInWithPassword(credentials) {
      if (ownedStorage.isUnavailable()) return { data: { session: null }, error: error() };
      const result = await client.auth.signInWithPassword(credentials);
      return ownedStorage.isUnavailable() ? { ...result, error: error() } : result;
    },
    async signOut(options) {
      if (ownedStorage.isUnavailable()) return { error: error() };
      const result = await client.auth.signOut(options);
      return ownedStorage.isUnavailable() ? { error: error() } : result;
    },
    onAuthStateChange: callback => client.auth.onAuthStateChange(callback),
  };
  const session = createMemoAuthSession(auth);
  let disposal: Promise<void> | undefined;
  return Object.freeze({ session,
    dispose(): Promise<void> {
      if (disposal) return disposal;
      session.dispose(); closed = true; ownedStorage.close();
      disposal = (async () => {
        // 初期化の後からタイマーや通知が再登録されないよう、順序を合わせて終了する。
        await sdk!.auth.initialize();
        await sdk!.auth.dispose();
      })();
      return disposal;
    },
  });
}

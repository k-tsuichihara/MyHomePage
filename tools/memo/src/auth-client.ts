import type { MemoAuthApi } from './auth-session';

export interface AuthStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}
export interface MemoAuthOptions {
  auth: {
    storage: AuthStorage;
    storageKey: 'myhomepage.memo.auth.v1';
    persistSession: true;
    autoRefreshToken: true;
    detectSessionInUrl: false;
  };
}
export type MemoAuthClientFactory = (url: string, publicKey: string, options: MemoAuthOptions) => { auth: MemoAuthApi };

/** 明示的な生成時だけ、ビルド設定と専用保存先をSDKへ渡す。実設定は読み取らない。 */
export function createMemoAuthClient(factory: MemoAuthClientFactory,
  config: { url: string; publicKey: string }, storage: AuthStorage): { auth: MemoAuthApi } {
  let valid = false;
  try {
    const url = new URL(config.url);
    let publicKey = config.publicKey.startsWith('sb_publishable_') && config.publicKey.length > 15;
    if (!publicKey) {
      const parts = config.publicKey.split('.');
      if (parts.length === 3 && parts.every(Boolean)) {
        const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown };
        publicKey = payload.role === 'anon';
      }
    }
    valid = url.protocol === 'https:' && url.origin === config.url && !url.username && !url.password && publicKey;
  } catch { /* 設定値をエラーへ含めない。公開キー判定は署名・接続先の真正性保証ではない。 */ }
  if (!valid) throw new Error('Invalid memo Auth configuration');
  return factory(config.url, config.publicKey, { auth: { storage, storageKey: 'myhomepage.memo.auth.v1',
    persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
}

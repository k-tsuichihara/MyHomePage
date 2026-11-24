import { createMemoSdkAuth } from './auth-sdk';
import type { AuthenticatedRpcSender } from './auth-session';
import { requirePersistencePermit } from './browser-local-adapter';
import type { PersistencePermit, BrowserLocalEnvironment } from './browser-local-adapter';

export interface BrowserAuthEnvironment extends Pick<BrowserLocalEnvironment, 'origin' | 'secure' | 'topLevel'> {
  getStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

/** 所有確認済みの専用ブラウザ入口。公開UIへの接続やStorageの自動取得は行わない。 */
export function createBrowserMemoAuth(env: BrowserAuthEnvironment, permit: PersistencePermit | undefined,
  config: { url: string; publicKey: string }, transport: typeof fetch, rpcSender?: AuthenticatedRpcSender) {
  requirePersistencePermit(env, permit);
  // SDKへメモ専用storageKeyを設定する。Permit検査を維持し、列挙・clearは公開しない。
  return createMemoSdkAuth(config, {
    getItem: key => env.getStorage().getItem(key),
    setItem: (key, value) => env.getStorage().setItem(key, value),
    removeItem: key => env.getStorage().removeItem(key),
  }, transport, rpcSender);
}

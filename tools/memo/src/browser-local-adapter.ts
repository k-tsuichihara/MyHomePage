import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from './local-migration';
import type { MigrationStorage } from './local-migration';
import type { LocalLockManager } from './local-lock';

export interface PersistencePermit { readonly origin: string; readonly runId: string }
export interface BrowserLocalEnvironment {
  readonly origin: string;
  readonly secure: boolean;
  readonly topLevel: boolean;
  readonly getStorage: () => Pick<Storage, 'getItem' | 'setItem'>;
  readonly getLocks: () => LocalLockManager | undefined;
}
export class BrowserBoundaryError extends Error {
  constructor() { super('Persistence test boundary rejected'); }
}

/** originだけでプロファイル所有を証明できない。permitは所有検証済みランナーだけが専用入口へ注入する。 */
export function createBrowserLocalAdapter(env: BrowserLocalEnvironment, permit: PersistencePermit | undefined) {
  let allowed = false;
  try {
    const url = new URL(env.origin);
    allowed = !!permit && permit.origin === env.origin && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(permit.runId)
      && url.origin === env.origin && url.protocol === 'http:' && url.hostname === '127.0.0.1'
      && Number(url.port) >= 1024 && url.port !== '4173' && env.secure && env.topLevel;
  } catch { /* 不正な許可情報では実APIを取得しない */ }
  if (!allowed) throw new BrowserBoundaryError();
  let locks: LocalLockManager | undefined;
  try { locks = env.getLocks(); } catch { throw new BrowserBoundaryError(); }
  const storage: MigrationStorage = Object.freeze({
    getItem(key: string) {
      if (key !== OLD_STORAGE_KEY && key !== NEW_STORAGE_KEY) throw new BrowserBoundaryError();
      // Storage取得自体のSecurityErrorも、呼出元の既存I/O例外境界へ伝える。
      return env.getStorage().getItem(key);
    },
    setItem(key: string, value: string) {
      if (key !== NEW_STORAGE_KEY) throw new BrowserBoundaryError();
      env.getStorage().setItem(key, value);
    },
  });
  return { storage, locks };
}

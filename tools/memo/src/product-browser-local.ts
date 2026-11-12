import { createProductLocalApp } from './product-local-app';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from './local-migration';
import type { MigrationStorage } from './local-migration';
import type { LocalLockManager } from './local-lock';

export interface ProductBrowserEnvironment {
  readonly url: string;
  readonly secure: boolean;
  readonly topLevel: boolean;
  readonly getStorage: () => Pick<Storage, 'getItem' | 'setItem'>;
  readonly getLocks: () => LocalLockManager | undefined;
  readonly createId: () => string;
  readonly now: () => string;
}

export class ProductBrowserBoundaryError extends Error {
  constructor() { super('Product browser boundary rejected'); }
}

function requireProductPage(env: Pick<ProductBrowserEnvironment, 'url' | 'secure' | 'topLevel'>): void {
  let allowed = false;
  try {
    const url = new URL(env.url);
    allowed = env.secure && env.topLevel && url.protocol === 'https:'
      && !url.username && !url.password && !url.search && !url.hash
      && /\/tools\/memo\/memo\.html$/.test(url.pathname);
  } catch { /* 不正URLではブラウザAPIを取得しない */ }
  if (!allowed) throw new ProductBrowserBoundaryError();
}

/** 公開製品ページ用。旧キーは読取だけ、新キーだけを書き込み、他Storageキーへ触れない。 */
export function createProductBrowserLocalDependencies(env: ProductBrowserEnvironment) {
  requireProductPage(env);
  let storage: Pick<Storage, 'getItem' | 'setItem'>;
  let locks: LocalLockManager | undefined;
  try { storage = env.getStorage(); locks = env.getLocks(); }
  catch { throw new ProductBrowserBoundaryError(); }
  const boundedStorage: MigrationStorage = Object.freeze({
    getItem(key: string) {
      if (key !== OLD_STORAGE_KEY && key !== NEW_STORAGE_KEY) throw new ProductBrowserBoundaryError();
      return storage.getItem(key);
    },
    setItem(key: string, value: string) {
      if (key !== NEW_STORAGE_KEY) throw new ProductBrowserBoundaryError();
      storage.setItem(key, value);
    },
  });
  return Object.freeze({ storage: boundedStorage, locks, createId: env.createId, now: env.now });
}

/** HTMLからの最終接続点。呼出しだけでは移行書込を行わず、既存の明示確認契約へ委ねる。 */
export function mountProductBrowserLocalApp(doc: Document, env: ProductBrowserEnvironment) {
  return createProductLocalApp(doc, createProductBrowserLocalDependencies(env));
}

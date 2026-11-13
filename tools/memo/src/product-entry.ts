import { mountProductBrowserLocalApp } from './product-browser-local';
import { createProductBrowserLocalDependencies } from './product-browser-local';
import { showProductMaintenance } from './product-maintenance';
declare const __MEMO_MAINTENANCE__: boolean;

const status = document.getElementById('product-status');
try {
  const styles = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][integrity]'));
  if (styles.length !== 2 || styles.some(style => !style.sheet || style.sheet.cssRules.length === 0)) throw new Error('Product styles unavailable');
  const env = {
    url: location.href,
    secure: isSecureContext,
    topLevel: window.top === window,
    getStorage: () => window.localStorage,
    getLocks: () => navigator.locks,
    createId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  };
  if (__MEMO_MAINTENANCE__) {
    const deps = createProductBrowserLocalDependencies(env);
    void showProductMaintenance(document, deps.storage, deps.locks);
  } else mountProductBrowserLocalApp(document, env);
} catch {
  if (status) status.textContent = '製品用の安全条件を確認できないため、メモ操作を開始していません。';
}

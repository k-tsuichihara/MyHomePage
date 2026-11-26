import { mountProductLayout } from './ui/product-layout';
import { mountProductBrowserLocalApp } from './product-browser-local';
import { createProductBrowserLocalDependencies } from './product-browser-local';
import { showProductMaintenance } from './product-maintenance';
declare const __MEMO_MAINTENANCE__: boolean;
declare const __MEMO_PRODUCT_CLOUD__: boolean;
declare const __MEMO_PRODUCT_PRODUCTION__: boolean;
declare const __MEMO_PRODUCTION_KEY__: string;

const status = document.getElementById('product-status');
try {
  const styles = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][integrity]'));
  if (styles.length !== 2 || styles.some(style => !style.sheet || style.sheet.cssRules.length === 0)) throw new Error('Product styles unavailable');
  if (!__MEMO_MAINTENANCE__) mountProductLayout(document);
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
  } else if (__MEMO_PRODUCT_CLOUD__) {
    void import('./product-cloud-app').then(module => {
      if (__MEMO_PRODUCT_PRODUCTION__) module.mountProductProductionCloud(document, env, __MEMO_PRODUCTION_KEY__, window.fetch.bind(window));
      else module.mountProductCloudSetup(document, env, window.fetch.bind(window));
    })
      .catch(() => { if (status) status.textContent = 'クラウド候補の接続準備を開始できませんでした。'; });
  } else { mountProductBrowserLocalApp(document, env); if (status) status.textContent = ''; }
} catch {
  if (status) status.textContent = '製品用の安全条件を確認できないため、メモ操作を開始していません。';
}

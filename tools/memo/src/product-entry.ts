import { mountProductBrowserLocalApp } from './product-browser-local';

const status = document.getElementById('product-status');
try {
  const styles = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][integrity]'));
  if (styles.length !== 2 || styles.some(style => !style.sheet || style.sheet.cssRules.length === 0)) throw new Error('Product styles unavailable');
  mountProductBrowserLocalApp(document, {
    url: location.href,
    secure: isSecureContext,
    topLevel: window.top === window,
    getStorage: () => window.localStorage,
    getLocks: () => navigator.locks,
    createId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  });
} catch {
  if (status) status.textContent = '製品用の安全条件を確認できないため、メモ操作を開始していません。';
}

import { mountProductBrowserLocalApp } from './product-browser-local';

const status = document.getElementById('product-status');
try {
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

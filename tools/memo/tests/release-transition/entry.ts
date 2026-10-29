import { releaseMatches } from './gate';
import { createBrowserLocalAdapter, BrowserBoundaryError } from '../../src/browser-local-adapter';
import { ExpectedBootStop } from './outcome';
import type { BootReport } from './outcome';
import { createLocalDataStore } from '../../src/local-data-store';
import { createLocalMemoStore } from '../../src/local-memo-store';
import { createLocalMemoController } from '../../src/local-memo-controller';
import { createLocalMigrationController } from '../../src/local-migration-controller';
import { OLD_STORAGE_KEY, NEW_STORAGE_KEY } from '../../src/local-migration';
import { mountMigrationPreview } from '../../src/ui/migration-preview';
import { mountMemoPreview } from '../../src/ui/memo-preview';
import { oldRows } from '../migration-fixtures';

declare const __RELEASE_ID__: string;
declare global { interface Window { __transition?: ReturnType<typeof createHarness>; __transitionBoot?: BootReport; __transitionFault?: 'before-storage' } }
window.__transitionBoot = { kind: 'starting' };

async function createHarness() {
  const status = document.getElementById('boot-status')!;
  const expected = document.documentElement.dataset.release ?? '';
  const style = getComputedStyle(document.documentElement).getPropertyValue('--transition-release').trim();
  if (!releaseMatches(expected, __RELEASE_ID__, style)) {
    throw new ExpectedBootStop(expected !== __RELEASE_ID__ || !['sim-r1', 'sim-r2'].includes(expected) ? 'release-mismatch' : style === '' ? 'css-unavailable' : 'css-mismatch');
  }
  if (window.__transitionFault === 'before-storage') throw new Error('Synthetic unexpected initialization failure');
  let adapter: ReturnType<typeof createBrowserLocalAdapter>;
  try { adapter = createBrowserLocalAdapter({ origin: location.origin, secure: isSecureContext, topLevel: window.top === window,
    getStorage: () => window.localStorage, getLocks: () => navigator.locks }, window.__persistencePermit); }
  catch (error) {
    if (error instanceof BrowserBoundaryError) throw new ExpectedBootStop(window.__persistencePermit === undefined ? 'permit-missing' : 'environment-rejected');
    throw error;
  }
  // 許可を確認した後だけnative Storageを取得。旧JSへは旧キー専用能力だけを渡す。
  const getter = Object.getOwnPropertyDescriptor(window, 'localStorage')!.get!;
  const native = () => getter.call(window) as Storage, mode = document.documentElement.dataset.mode;
  const oldOnly = Object.freeze({
    getItem(key: string) { if (key !== OLD_STORAGE_KEY) throw new Error('Legacy key rejected'); return native().getItem(key); },
    setItem(key: string, value: string) { if (key !== OLD_STORAGE_KEY) throw new Error('Legacy key rejected'); native().setItem(key, value); },
  });
  // v2アダプターは既存のキー制限を維持する。legacy用能力は専用入口内だけに置く。
  if (mode === 'legacy') Object.defineProperty(window, 'localStorage', { get: () => oldOnly });
  for (const key of ['sessionStorage', 'indexedDB', 'caches', 'cookieStore']) Object.defineProperty(window, key, { get() { throw new Error('Forbidden storage'); } });
  Object.defineProperty(Document.prototype, 'cookie', { get() { throw new Error('Forbidden cookie'); }, set() { throw new Error('Forbidden cookie'); } });
  for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'RTCPeerConnection']) Object.defineProperty(window, key, { value() { throw new Error('Forbidden network'); } });
  Object.defineProperty(navigator, 'sendBeacon', { value() { throw new Error('Forbidden network'); } });
  if ('serviceWorker' in navigator) Object.defineProperty(navigator, 'serviceWorker', { get() { throw new Error('Forbidden service worker'); } });
  let fault = '', writes = 0;
  const readOnly = Object.freeze({ getItem: adapter.storage.getItem, setItem() { throw new Error('Maintenance writes forbidden'); } });
  const storage = mode === 'maintenance' ? readOnly : {
    getItem: adapter.storage.getItem,
    setItem(key: string, value: string) {
      adapter.storage.setItem(key, value); writes++;
      if (fault === 'after-pending' && JSON.parse(value).migration.status === 'pending') throw new Error('Synthetic interruption');
    },
  };
  const snapshot = () => ({ old: native().getItem(OLD_STORAGE_KEY), v2: native().getItem(NEW_STORAGE_KEY) });
  const api = {
    snapshot, writes: () => writes,
    seed() {
      if (mode !== 'seed' || native().length !== 0) throw new Error('Seed rejected');
      native().setItem(OLD_STORAGE_KEY, JSON.stringify(oldRows())); native().setItem('__transition_seeded', 'once');
    },
    fault(value: 'after-pending' | 'invalid') {
      if (mode !== 'new') throw new Error('Fault injection unavailable');
      if (value === 'invalid') adapter.storage.setItem(NEW_STORAGE_KEY, '{'); else fault = value;
    },
  };
  if (mode === 'legacy') {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script'); script.src = '/assets/legacy.js'; script.onload = () => resolve(); script.onerror = () => reject(new ExpectedBootStop('legacy-asset-missing')); document.body.append(script);
    });
    document.getElementById('legacy-app')!.hidden = false;
  } else if (mode === 'new') {
    const createId = () => crypto.randomUUID(), deps = { storage, locks: adapter.locks, createId };
    const store = createLocalMemoStore({ ...deps, now: () => new Date().toISOString() }), controller = createLocalMemoController({ store, createId });
    mountMigrationPreview(document, createLocalMigrationController(deps), async () => {
      await controller.dispatch({ kind: 'load' }); if (controller.getState().read.kind !== 'ready') return false;
      mountMemoPreview(document, controller); return true;
    });
  } else if (mode === 'maintenance') {
    // 保守版はloadだけ。移行・復旧・save・旧形式へのフォールバックは提供しない。
    const result = await createLocalDataStore({ storage: readOnly, locks: adapter.locks }).load();
    const view = document.getElementById('maintenance')!; view.hidden = false;
    view.textContent = result.kind === 'loaded' ? `保守版：書込停止。検証済みv2 ${result.value.memos.length}件。` : '保守版：通常利用を停止。明示診断が必要です。';
  } else if (mode !== 'seed') throw new Error('Unknown simulation mode');
  status.textContent = `起動済み：${__RELEASE_ID__}／${mode}（検証専用）`;
  return api;
}
void createHarness().then(api => { window.__transition = Promise.resolve(api); window.__transitionBoot = { kind: 'ready' }; }).catch(error => {
  // 一律の停止表示だけで合格させない。元例外の実値を出さず、ランナーが型付き原因を照合する。
  window.__transitionBoot = error instanceof ExpectedBootStop ? { kind: 'stopped', reason: error.reason } : { kind: 'unexpected' };
  document.getElementById('boot-status')!.textContent = error instanceof ExpectedBootStop ? `停止：${error.reason}` : '停止：予期しない初期化例外。試験不合格です。';
});

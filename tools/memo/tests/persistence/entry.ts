import { createBrowserLocalAdapter } from '../../src/browser-local-adapter';
import type { PersistencePermit } from '../../src/browser-local-adapter';
import { createLocalMemoStore } from '../../src/local-memo-store';
import { createLocalMemoController } from '../../src/local-memo-controller';
import { createLocalMigrationController } from '../../src/local-migration-controller';
import { inspectLocalMigration, migrateLocalData, recoverLocalMigration, NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../../src/local-migration';
import { mountMigrationPreview } from '../../src/ui/migration-preview';
import { mountMemoPreview } from '../../src/ui/memo-preview';
import { oldRows } from '../migration-fixtures';
import { createPendingMigration } from '../../src/migration';
import { LOCAL_DATA_LOCK_NAME } from '../../src/local-lock';

declare global { interface Window { __persistencePermit?: PersistencePermit; __persistence?: ReturnType<typeof createHarness> } }
const legacy = JSON.stringify(oldRows());
const seededKey = '__memo_test_seeded';

function createHarness() {
  let fault = '', started = false, writes = 0, handoff = '';
  // ここが実APIの唯一の接続入口。permit確認前にはlocalStorage／locksを取得しない。
  const adapter = createBrowserLocalAdapter({ origin: location.origin, secure: isSecureContext, topLevel: window.top === window,
    getStorage: () => { if (fault === 'get-storage') throw new DOMException('Synthetic access denial', 'SecurityError'); return window.localStorage; },
    getLocks: () => navigator.locks }, window.__persistencePermit);
  for (const key of ['sessionStorage', 'indexedDB', 'caches', 'cookieStore']) Object.defineProperty(window, key, { get() { throw new Error('Forbidden persistence API'); } });
  Object.defineProperty(Document.prototype, 'cookie', { get() { throw new Error('Forbidden cookie API'); }, set() { throw new Error('Forbidden cookie API'); } });
  for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'RTCPeerConnection']) Object.defineProperty(window, key, { value() { throw new Error('Forbidden network API'); } });
  Object.defineProperty(navigator, 'sendBeacon', { value() { throw new Error('Forbidden network API'); } });
  if ('serviceWorker' in navigator) Object.defineProperty(navigator, 'serviceWorker', { get() { throw new Error('Forbidden service worker API'); } });
  const storage = {
    getItem(key: string) { if (fault === 'read') throw new Error('Synthetic read failure'); return adapter.storage.getItem(key); },
    setItem(key: string, value: string) {
      if (fault === 'before-write') throw new Error('Synthetic write failure');
      adapter.storage.setItem(key, value); writes++;
      const status = JSON.parse(value).migration.status as string;
      if (fault === 'readback') { fault = 'read'; return; }
      if (fault === `after-${status}`) throw new Error('Synthetic post-write interruption');
    },
  };
  const now = () => new Date().toISOString(), createId = () => crypto.randomUUID();
  const deps = { storage, locks: adapter.locks, createId };
  const base = createLocalMemoStore({ ...deps, now });
  const store: typeof base = { ...base, async load() {
    if (handoff) {
      adapter.storage.setItem(NEW_STORAGE_KEY, handoff === 'invalid' ? '{' : JSON.stringify(createPendingMigration(legacy, createId)));
      handoff = '';
    }
    return base.load();
  } };
  const controller = createLocalMemoController({ store, createId });
  return {
    /** 旧キー書込はfixture専用。新規profileの空領域へ一度だけ投入し、以後は上書きしない。 */
    seedLegacy() {
      const target = window.localStorage;
      if (target.length !== 0 || target.getItem(OLD_STORAGE_KEY) !== null || target.getItem(seededKey) !== null) throw new Error('Seed rejected');
      target.setItem(OLD_STORAGE_KEY, legacy); target.setItem(seededKey, 'once');
    },
    start() {
      if (started) return; started = true;
      mountMigrationPreview(document, createLocalMigrationController(deps), async () => {
        await controller.dispatch({ kind: 'load' });
        if (controller.getState().read.kind !== 'ready') return false;
        mountMemoPreview(document, controller); return true;
      });
    },
    inspect: () => inspectLocalMigration(deps),
    async migrate() { const result = await inspectLocalMigration(deps); return result.kind === 'migration-required' ? migrateLocalData(deps, result.legacySnapshot) : result; },
    async recover() { const result = await inspectLocalMigration(deps); return result.kind === 'recovery-ready' ? recoverLocalMigration(deps, result.legacySnapshot, result.pendingSnapshot) : result; },
    save: (id: string, revision: number | null, title = '合成保存', body = '') => store.save({ id, expectedRevision: revision, title, body, tagIds: [], requestId: createId() }),
    load: () => store.load(),
    setFault(mode: string) { if (!['', 'get-storage', 'read', 'before-write', 'after-pending', 'after-complete', 'readback'].includes(mode)) throw new Error('Unknown fault'); fault = mode; },
    oldUnchanged: () => adapter.storage.getItem(OLD_STORAGE_KEY) === legacy,
    snapshot: () => adapter.storage.getItem(NEW_STORAGE_KEY),
    writes: () => writes,
    async withoutLocks() { return inspectLocalMigration({ ...deps, locks: undefined }); },
    /** 試験の競合注入。旧キーは変更しない。任意JSONを受け付けない。 */
    corruptNew() { adapter.storage.setItem(NEW_STORAGE_KEY, '{'); },
    changeBeforeNextLoad(mode: 'invalid' | 'pending') { handoff = mode; },
    holdLock() {
      let acquired!: () => void;
      const ready = new Promise<void>(resolve => { acquired = resolve; });
      void adapter.locks!.request(LOCAL_DATA_LOCK_NAME, { mode: 'exclusive' }, () => { acquired(); return new Promise<void>(() => { /* 保持タブ終了による解放を試験 */ }); });
      return ready.then(() => { return true; });
    },
    /** 最後の独立profileだけで実行。上限に達したら未再現を報告し、容量回復は試みない。 */
    fillQuota() {
      const target = window.localStorage; let size = 524288, attempts = 0, attemptedCharacters = 0, quota = false;
      while (attempts < 32 && attemptedCharacters + size <= 16 * 1024 * 1024) {
        const key = `__memo_quota_${attempts++}`; attemptedCharacters += size;
        try { target.setItem(key, 'Q'.repeat(size)); }
        catch (error) {
          if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw new Error('Unexpected quota failure');
          quota = true; if (size <= 128) break; size = Math.floor(size / 2);
        }
      }
      return { quota, attempts, attemptedCharacters };
    },
  };
}
try { window.__persistence = createHarness(); }
catch { document.getElementById('migration-status')!.textContent = '専用試験環境の安全条件を確認できないため停止しました。'; }

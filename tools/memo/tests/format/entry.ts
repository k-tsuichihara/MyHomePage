import { createBrowserLocalAdapter, BrowserBoundaryError } from '../../src/browser-local-adapter';
import { createLocalDataStore } from '../../src/local-data-store';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY, inspectLocalMigration, migrateLocalData, recoverLocalMigration } from '../../src/local-migration';
import type { MigrationResult } from '../../src/local-migration';
import { createPendingMigration } from '../../src/migration';
import { createControlledUpgrade } from './controlled-upgrade';
import { createLocalDataStore as oldStore } from './old-v2-store';
import { state, token } from '../local-save-fixtures';
import { oldRows } from '../migration-fixtures';
import { createLocalMemoStore } from '../../src/local-memo-store';
import { createLocalMemoController } from '../../src/local-memo-controller';
import type { ControllerCommand } from '../../src/local-app-state';

declare global { interface Window { __format?: ReturnType<typeof start> } }
function start() {
  // ランナー許可・origin・secure/top frameを検査する前にnative保存先を取得しない。
  const adapter = createBrowserLocalAdapter({ origin: location.origin, secure: isSecureContext, topLevel: window.top === window,
    getStorage: () => window.localStorage, getLocks: () => navigator.locks }, window.__persistencePermit);
  const native = window.localStorage;
  for (const name of ['sessionStorage', 'indexedDB', 'caches', 'cookieStore']) Object.defineProperty(window, name, { get() { throw new Error('Forbidden API'); } });
  Object.defineProperty(Document.prototype, 'cookie', { get() { throw new Error('Forbidden API'); }, set() { throw new Error('Forbidden API'); } });
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker']) Object.defineProperty(window, name, { value: () => { throw new Error('Forbidden API'); } });
  if ('serviceWorker' in navigator) Object.defineProperty(navigator, 'serviceWorker', { get() { throw new Error('Forbidden API'); } });
  let fault = '', writes = 0, sequence = 800, seeded = false;
  const storage = { getItem(key: string) { if (fault === 'readback' && writes) throw new Error('Synthetic readback'); return adapter.storage.getItem(key); },
    setItem(key: string, raw: string) {
      if (fault === 'quota') throw new Error('Synthetic quota');
      adapter.storage.setItem(key, raw); ++writes;
      if (fault === 'after') throw new Error('Synthetic after write');
    } };
  const deps = { storage, locks: adapter.locks, createId: () => token(++sequence) };
  const memoStore = createLocalMemoStore({ ...deps, now: () => '2026-10-30T00:00:00Z' });
  const memoController = createLocalMemoController({ store: memoStore, createId: deps.createId });
  const managed = createControlledUpgrade(deps, Object.freeze({ permit: window.__persistencePermit, storage }));
  let prepared: Awaited<ReturnType<typeof managed.port.inspect>> | null = null;
  let migration: Extract<MigrationResult, { kind: 'migration-required' | 'recovery-ready' }> | null = null;
  let busy = false, maintenanceMode = false;
  const status = document.getElementById('status')!, outcome = document.getElementById('outcome')!;
  const approve = document.getElementById('approve') as HTMLButtonElement, cancel = document.getElementById('cancel') as HTMLButtonElement;
  const inspectButton = document.getElementById('inspect') as HTMLButtonElement;
  const render = (value: string) => { status.textContent = value; approve.hidden = cancel.hidden = !(prepared?.kind === 'approval-required' || migration);
    approve.disabled = cancel.disabled = inspectButton.disabled = busy; };
  async function inspect() {
    if (busy || maintenanceMode) return;
    if (prepared?.kind === 'approval-required') managed.port.revoke(prepared.approval);
    prepared = null; migration = null; busy = true; render('diagnosing');
    try {
      prepared = await managed.port.inspect();
      if (prepared.kind === 'absent' || prepared.kind === 'recovery-required') {
        const result = await inspectLocalMigration(deps);
        if (result.kind === 'migration-required' || result.kind === 'recovery-ready') migration = result;
        busy = false; render(migration?.kind ?? result.kind);
      } else { busy = false; render(prepared.kind); }
    } catch { busy = false; render('stopped'); }
  }
  async function confirm() {
    if (busy || maintenanceMode || (!migration && prepared?.kind !== 'approval-required')) return;
    const accepted = migration, permit = prepared; prepared = null; migration = null; busy = true; render('running');
    try {
      if (accepted) {
        const result = accepted.kind === 'migration-required' ? await migrateLocalData(deps, accepted.legacySnapshot)
          : await recoverLocalMigration(deps, accepted.legacySnapshot, accepted.pendingSnapshot);
        outcome.textContent = result.kind;
        if (result.kind === 'migrated' || result.kind === 'recovered') managed.issuer.producedV2(JSON.stringify(result.value));
      } else if (permit?.kind === 'approval-required') outcome.textContent = (await managed.port.confirm(permit.approval)).kind;
    } catch { outcome.textContent = 'unknown'; }
    busy = false; render('stopped-reinspect');
  }
  inspectButton.onclick = () => { void inspect(); }; approve.onclick = () => { void confirm(); };
  cancel.onclick = () => {
    if (busy) return; if (prepared?.kind === 'approval-required') managed.port.revoke(prepared.approval);
    prepared = null; migration = null; render('cancelled');
  };
  const api = {
    /** 固定fixtureだけ。一度の初期投入と、同じ環境で成功した移行／復旧以外を登録しない。 */
    seed(mode: 'v2' | 'legacy' | 'pending' | 'backup' | 'v3' | 'v3-pending' | 'invalid' | 'unknown') {
      if (seeded || native.getItem(OLD_STORAGE_KEY) !== null || native.getItem(NEW_STORAGE_KEY) !== null) throw new Error('Fresh owned fixture required');
      seeded = true;
      const raw = JSON.stringify(state()), legacy = JSON.stringify(oldRows());
      if (mode === 'legacy' || mode === 'pending' || mode === 'v3-pending') native.setItem(OLD_STORAGE_KEY, legacy);
      if (mode === 'v2' || mode === 'backup') native.setItem(NEW_STORAGE_KEY, raw);
      if (mode === 'pending' || mode === 'v3-pending') {
        const value = createPendingMigration(legacy, deps.createId);
        native.setItem(NEW_STORAGE_KEY, JSON.stringify(mode === 'pending' ? value : { ...value, version: 3, deletedMemoIds: [] }));
      }
      if (mode === 'v3') native.setItem(NEW_STORAGE_KEY, JSON.stringify({ ...state(), version: 3, deletedMemoIds: [token(900)] }));
      if (mode === 'invalid') native.setItem(NEW_STORAGE_KEY, JSON.stringify({ ...state(), version: 3, deletedMemoIds: 'bad' }));
      if (mode === 'unknown') native.setItem(NEW_STORAGE_KEY, JSON.stringify({ ...state(), version: 9 }));
      if (mode === 'v2') managed.issuer.producedV2(raw);
    },
    inspect, fault(value: string) { fault = value; }, writes: () => writes,
    dispatch(command: ControllerCommand) {
      return maintenanceMode ? Promise.resolve({ kind: 'blocked' as const, reason: 'maintenance' }) : memoController.dispatch(command);
    },
    state: memoController.getState,
    snapshot: () => ({ old: native.getItem(OLD_STORAGE_KEY), current: native.getItem(NEW_STORAGE_KEY) }),
    oldLoad: () => oldStore(deps).load(), oldWrite: () => oldStore(deps).transact(value => ({ ...value, memos: [], memoTags: [] })),
    async maintenance() {
      if (busy) throw new Error('Operation active');
      maintenanceMode = true;
      if (prepared?.kind === 'approval-required') managed.port.revoke(prepared.approval);
      prepared = null; migration = null;
      const result = await createLocalDataStore({ locks: adapter.locks, storage: { getItem: storage.getItem, setItem() { throw new Error('Read only'); } } }).load();
      render(result.kind === 'loaded' ? `maintenance-v${result.value.version}` : 'maintenance-stopped');
      inspectButton.disabled = approve.disabled = cancel.disabled = true; return result.kind;
    },
  };
  render('ready-to-diagnose'); return api;
}
try { window.__format = start(); } catch (error) {
  // 意図した境界拒否と任意の初期化例外を区別し、未許可ケースの誤PASSを防ぐ。
  document.getElementById('status')!.textContent = error instanceof BrowserBoundaryError ? 'boundary-stopped' : 'unexpected-startup';
}

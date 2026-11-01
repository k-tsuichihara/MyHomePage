// 既存入口のpermit境界と、他の永続API/通信API禁止処理をそのまま再利用する。
import './entry';
import { createBrowserLocalAdapter } from '../../src/browser-local-adapter';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../../src/local-migration';
import { LOCAL_DATA_LOCK_NAME } from '../../src/local-lock';
import { createLocalMemoStore } from '../../src/local-memo-store';
import { createLocalBackup } from '../../src/local-backup';
import { createLocalRestoreController } from '../../src/local-restore-controller';
import { createDeletedRecoveryController } from '../../src/deleted-recovery-controller';
import { createInitialRestoreController } from '../../src/initial-restore-controller';
import { token } from '../local-save-fixtures';
import { fillBoundedQuota } from './quota';

declare global { interface Window { __backupPhaseB?: ReturnType<typeof start> } }
const T0 = '2026-11-01T00:00:00Z', T1 = '2026-11-01T01:00:00Z', T2 = '2026-11-01T02:00:00Z', T3 = '2026-11-01T03:00:00Z';
const M1 = token(10), M2 = token(11), TAG = token(30), UNUSED = token(31), HISTORY = token(900);
function start() {
  const adapter = createBrowserLocalAdapter({ origin: location.origin, secure: isSecureContext, topLevel: top === window,
    getStorage: () => localStorage, getLocks: () => navigator.locks }, window.__persistencePermit);
  let writes = 0, attempts = 0, quota = false, time = T0;
  const storage = { getItem: adapter.storage.getItem,
    setItem(key: string, raw: string) {
      ++attempts;
      try { adapter.storage.setItem(key, raw); ++writes; }
      catch (error) { if (error instanceof DOMException && error.name === 'QuotaExceededError') quota = true; throw error; }
    } };
  const store = createLocalMemoStore({ storage, locks: adapter.locks, now: () => time });
  const request = () => crypto.randomUUID();
  const additive = createLocalRestoreController({ store, createId: request });
  const recovery = createDeletedRecoveryController({ store, createId: request, openCreated: async () => true });
  const initial = createInitialRestoreController({ store, createId: request, openNormal: async () => true });
  const bytes = (json: string) => new TextEncoder().encode(json);
  const requireKind = (value: { kind: string }, expected: string) => { if (value.kind !== expected) throw Error('Synthetic setup rejected'); };
  return {
    /** fixture権限のみ。新規profileの完全な空領域に一度だけ投入し、再起動後は再投入しない。 */
    async populate() {
      const native = window.localStorage;
      if (native.length !== 0 || storage.getItem(NEW_STORAGE_KEY) !== null || storage.getItem(OLD_STORAGE_KEY) !== null) throw Error('Fixture seed rejected');
      adapter.storage.setItem(NEW_STORAGE_KEY, JSON.stringify({ version: 3, migration: { status: 'not-required' }, memos: [], tags: [], memoTags: [], deletedMemoIds: [] }));
      for (const [id, name] of [[TAG, 'Work'], [UNUSED, '未使用']] as const) requireKind(await store.saveTag({ id, name, expectedRevision: null, requestId: request() }), 'written');
      for (const [id, title] of [[M1, '作成1'], [M2, '作成2'], [HISTORY, '履歴用の合成メモ']] as const)
        requireKind(await store.save({ id, title, body: ' 原本文\n', tagIds: [TAG], expectedRevision: null, requestId: request() }), 'saved');
      requireKind(await store.changeState({ id: HISTORY, action: 'trash', expectedRevision: 1, requestId: request() }), 'written');
      requireKind(await store.deletePermanently({ id: HISTORY, expectedRevision: 2, requestId: request() }), 'deleted');
      time = T1; requireKind(await store.save({ id: M1, title: '編集済み', body: ' 更新本文\n', tagIds: [TAG], expectedRevision: 1, requestId: request() }), 'saved');
      time = T2;
      requireKind(await store.changeState({ id: M1, action: 'pin', expectedRevision: 2, requestId: request() }), 'written');
      requireKind(await store.changeState({ id: M2, action: 'pin', expectedRevision: 1, requestId: request() }), 'written');
      requireKind(await store.changeState({ id: M2, action: 'trash', expectedRevision: 2, requestId: request() }), 'written');
    },
    snapshot: () => ({ old: storage.getItem(OLD_STORAGE_KEY), raw: storage.getItem(NEW_STORAGE_KEY) }),
    load: () => store.load(),
    counters: () => ({ writes, attempts, quota }),
    export: () => createLocalBackup({ storage, locks: adapter.locks, now: () => T3 })(),
    async prepareAdd(json: string) {
      time = T3; await additive.dispatch({ kind: 'file', bytes: bytes(json) });
      await additive.dispatch({ kind: 'select', indexes: [0, 1], selected: true }); await additive.dispatch({ kind: 'prepare' }); return additive.getState();
    },
    async confirmAdd() { await additive.dispatch({ kind: 'confirm' }); return additive.getState(); },
    remove: () => store.deletePermanently({ id: M2, expectedRevision: 3, requestId: request() }),
    async recover(json: string) {
      time = T3; await recovery.dispatch({ kind: 'file', bytes: bytes(json) }); await recovery.dispatch({ kind: 'select', index: 1 });
      await recovery.dispatch({ kind: 'restore' }); return recovery.getState();
    },
    async prepareInitial(json: string) { await initial.dispatch({ kind: 'file', bytes: bytes(json) }); await initial.dispatch({ kind: 'prepare' }); return initial.getState(); },
    async confirmInitial() { await initial.dispatch({ kind: 'confirm', generation: initial.getState().generation }); return initial.getState(); },
    edit: (revision: number) => store.save({ id: M1, title: '別タブ編集', body: ' 更新本文\n', tagIds: [TAG], expectedRevision: revision, requestId: request() }),
    /** 待機が成立したことを通知し、保持タブ終了で実ロックを解放する。 */
    holdLock() {
      let acquired!: () => void; const ready = new Promise<void>(resolve => { acquired = resolve; });
      void adapter.locks!.request(LOCAL_DATA_LOCK_NAME, { mode: 'exclusive' }, () => { acquired(); return new Promise<void>(() => {}); });
      return ready.then(() => true);
    },
    fillQuota: () => fillBoundedQuota(window.localStorage),
  };
}
try { window.__backupPhaseB = start(); document.getElementById('migration-status')!.textContent = '所有環境の検証入口を開始しました'; }
catch { document.getElementById('migration-status')!.textContent = '安全条件不成立で停止しました'; }

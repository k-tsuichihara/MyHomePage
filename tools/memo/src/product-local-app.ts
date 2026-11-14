import { createLocalMemoController } from './local-memo-controller';
import { createLocalMemoStore } from './local-memo-store';
import { createLocalMigrationController } from './local-migration-controller';
import type { MigrationDependencies } from './local-migration';
import { mountMemoPreview } from './ui/memo-preview';
import { mountMigrationPreview } from './ui/migration-preview';
import { createLocalBackup } from './local-backup';
import { mountBackupPreview } from './ui/backup-preview';
import { createProductV3Upgrade } from './product-v3-upgrade';
import { mountV3Upgrade } from './ui/v3-upgrade';
import { requestNavigation } from './navigation-state';
import { mountVoiceInput } from './ui/voice-input';
import type { VoiceEditBridge } from './ui/memo-preview';
import { createLocalRestoreController } from './local-restore-controller';
import { createDeletedRecoveryController } from './deleted-recovery-controller';
import { mountRestorePreview } from './ui/restore-preview';
import { mountDeletedRecoveryPreview } from './ui/deleted-recovery-preview';
import { createInitialRestoreController } from './initial-restore-controller';
import { mountInitialRestorePreview } from './ui/initial-restore-preview';
import { mountProductSession } from './product-session-ui';
import type { ProductCloudHost, ProductSessionPort } from './product-session-ui';

export interface ProductLocalDependencies extends MigrationDependencies {
  readonly now: () => string;
}

export interface ProductLocalViews {
  readonly mountMigration: typeof mountMigrationPreview;
  readonly mountMemo: typeof mountMemoPreview;
  readonly mountBackup?: typeof mountBackupPreview;
  readonly mountUpgrade?: typeof mountV3Upgrade;
  readonly mountRestore?: typeof mountRestorePreview;
  readonly mountRecovery?: typeof mountDeletedRecoveryPreview;
  readonly mountInitial?: typeof mountInitialRestorePreview;
}

const defaultViews: ProductLocalViews = {
  mountMigration: mountMigrationPreview,
  mountMemo(doc, controller) {
    const bridge: VoiceEditBridge = {};
    const disposeMemo = mountMemoPreview(doc, controller, bridge);
    const disposeVoice = mountVoiceInput(doc, controller, bridge);
    return () => { disposeVoice(); disposeMemo(); };
  },
  mountBackup: mountBackupPreview,
  mountUpgrade: mountV3Upgrade,
  mountRestore: mountRestorePreview,
  mountRecovery: mountDeletedRecoveryPreview,
  mountInitial: mountInitialRestorePreview,
};

/**
 * 製品UIのlocal経路を、保存先取得や認証から独立して組み立てる。
 * 移行診断がreadyになり通常loadにも成功するまで、メモ操作UIを公開しない。
 */
export function createProductLocalApp(doc: Document, deps: ProductLocalDependencies,
  views: ProductLocalViews = defaultViews, session?: ProductSessionPort, cloud?: ProductCloudHost) {
  const upgrade = createProductV3Upgrade(deps);
  const store = createLocalMemoStore({ storage: upgrade.storage, locks: deps.locks, now: deps.now, initialVersion: 3 });
  const controller = createLocalMemoController({ store, createId: deps.createId });
  const migration = createLocalMigrationController({ ...deps, storage: upgrade.storage, acceptExistingV3: true });
  let disposeMemo = () => {};
  let disposed = false;
  const connectedCloud = session?.getContext && session.isCurrent ? cloud : undefined;
  const localAvailable = () => !disposed && connectedCloud?.target.current().target !== 'cloud';
  let upgradeBusy = false;
  let disposeBackup: (() => void) | undefined;
  let disposeUpgrade: (() => void) | undefined;
  let backupOriginal = false;
  let disposeRestore: (() => void) | undefined, disposeRecovery: (() => void) | undefined;
  let disposeInitial: (() => void) | undefined;
  let sessionUi: ReturnType<typeof mountProductSession> | undefined;
  // 各既存controllerが持つbusy状態の変化をAuth UIにも反映する。
  async function withSessionRefresh<T>(start: () => Promise<T>): Promise<T> {
    try {
      const operation = start();
      sessionUi?.refresh();
      return await operation;
    } finally { sessionUi?.refresh(); }
  }
  const normalReady = () => {
    const state = controller.getState();
    return localAvailable() && !upgradeBusy && state.route.kind !== 'edit' && state.read.kind === 'ready'
      && state.write.kind !== 'writing' && state.write.kind !== 'unknown' && state.write.kind !== 'rejected'
      && !state.confirmation && !state.unresolved.length
      && (!state.editor || requestNavigation(state.editor, { kind: 'switch-source' }).kind === 'allowed');
  };
  const restoreBusy = () => ['reading', 'writing', 'confirmation'].includes(restore.getState().phase);
  const recoveryBusy = () => ['reading', 'writing', 'diagnosing', 'opening', 'preview', 'unknown'].includes(recovery.getState().phase);
  const initialBusy = () => ['reading', 'writing', 'confirmation', 'unknown'].includes(initial.getState().phase);
  const initial = createInitialRestoreController({ store, createId: deps.createId, canStart: () => normalReady() && !restoreBusy() && !recoveryBusy(),
    openNormal: async () => {
      if (disposed) return false;
      await controller.dispatch({ kind: 'load' }); syncBackup();
      return !disposed && controller.getState().read.kind === 'ready';
    } });
  const restore = createLocalRestoreController({ store, createId: deps.createId, canStart: () => normalReady() && !recoveryBusy() && !initialBusy() });
  const recovery = createDeletedRecoveryController({ store, createId: deps.createId, canStart: () => normalReady() && !restoreBusy() && !initialBusy(),
    openCreated: async id => {
      if (disposed) return false;
      await controller.dispatch({ kind: 'load' });
      if (disposed || controller.getState().read.kind !== 'ready') return false;
      const result = await controller.dispatch({ kind: 'detail', id });
      return result.kind === 'done' && controller.getState().route.kind === 'detail';
    } });
  const mountRecoveryViews = () => {
    if (disposed || controller.getState().storageVersion !== 3) return;
    if (!disposeRestore && views.mountRestore) disposeRestore = views.mountRestore(doc, {
      getState: restore.getState,
      async dispatch(command) {
        if (!localAvailable()) return;
        await withSessionRefresh(async () => {
          await restore.dispatch(command);
          if (!disposed && restore.getState().phase === 'applied') await controller.dispatch({ kind: 'load' });
        });
      },
    });
    if (!disposeRecovery && views.mountRecovery) disposeRecovery = views.mountRecovery(doc, {
      getState: recovery.getState,
      async dispatch(command) { if (localAvailable()) await withSessionRefresh(() => recovery.dispatch(command)); },
    }, () => { const route = controller.getState().route; return route.kind === 'detail' ? route.id : null; });
  };
  const prepareBackup = createLocalBackup({ storage: upgrade.storage, locks: deps.locks, now: deps.now });
  const syncBackup = () => {
    mountRecoveryViews();
    const state = controller.getState();
    if (disposed || !backupOriginal || state.read.kind !== 'ready' || state.storageVersion !== 3 || !views.mountBackup) return;
    disposeBackup?.();
    disposeBackup = views.mountBackup(doc, async () => !localAvailable() ? { kind: 'failed', reason: 'read-failure' } : prepareBackup());
    backupOriginal = false;
  };

  const enter = async (): Promise<boolean> => {
    if (!localAvailable() || migration.getState().kind !== 'ready') return false;
    await withSessionRefresh(() => controller.dispatch({ kind: 'load' }));
    if (!localAvailable() || controller.getState().read.kind !== 'ready') return false;
    disposeMemo();
    disposeMemo = views.mountMemo(doc, {
      getState: controller.getState,
      async dispatch(command) {
        if (!localAvailable()) return { kind: 'blocked', reason: disposed ? 'disposed' : 'cloud-read-only' };
        if ((upgradeBusy || restoreBusy() || recoveryBusy() || initialBusy()) && command.kind !== 'draft') return { kind: 'blocked', reason: 'writing' };
        const result = await withSessionRefresh(() => controller.dispatch(command));
        syncBackup();
        if (upgrade.getState() === 'legacy-changed') {
          const status = doc.getElementById('product-status');
          if (status) status.textContent = '旧キーの変更を検出しました。停止・要確認です。自動取込・再移行・上書きは行いません。';
        }
        return result;
      },
    });
    mountRecoveryViews();
    if (!disposeInitial && controller.getState().storageVersion === null && views.mountInitial) disposeInitial = views.mountInitial(doc, {
      getState: initial.getState,
      async dispatch(command) { if (localAvailable()) await withSessionRefresh(() => initial.dispatch(command)); },
    });
    if (!disposeBackup && views.mountBackup) {
      const original = controller.getState().storageVersion === 2;
      backupOriginal = original;
      disposeBackup = views.mountBackup(doc, async () => !localAvailable() ? { kind: 'failed', reason: 'read-failure' }
        : original ? upgrade.prepare() : prepareBackup(), original ? 'v2-original' : 'backup');
      if (original && views.mountUpgrade) disposeUpgrade = views.mountUpgrade(doc, upgrade, () => {
        const state = controller.getState();
        return localAvailable() && state.write.kind !== 'writing' && state.write.kind !== 'unknown' && state.write.kind !== 'rejected'
          && !state.confirmation && !state.unresolved.length
          && (!state.editor || requestNavigation(state.editor, { kind: 'switch-source' }).kind === 'allowed');
      }, async () => {
        const result = await controller.dispatch({ kind: 'load' });
        syncBackup();
        return result;
      }, busy => { upgradeBusy = busy; sessionUi?.refresh(); });
    }
    return true;
  };

  const migrationPort: typeof migration = {
    getState: migration.getState,
    async inspect() { if (localAvailable()) await withSessionRefresh(() => migration.inspect()); },
    cancel(token) { if (!disposed) migration.cancel(token); },
    async confirm(token) { if (localAvailable()) await withSessionRefresh(() => migration.confirm(token)); },
  };
  views.mountMigration(doc, migrationPort, enter);
  // cloud読取結果をlocalへ流し込まず、local操作UIを止めてドラフトを保持する。
  const heldInert = new Map<HTMLElement, boolean>();
  sessionUi = session ? mountProductSession(doc, session, { getState: controller.getState,
    setCloudSelected(selected) {
      for (const id of ['memo-app', 'migration-view']) {
        const node = doc.getElementById(id); if (!node) continue;
        if (selected) { if (!heldInert.has(node)) heldInert.set(node, node.inert); node.inert = true; }
        else if (heldInert.has(node)) { node.inert = heldInert.get(node)!; heldInert.delete(node); }
      }
    },
    isBusy: () => disposed || upgradeBusy || restoreBusy() || recoveryBusy() || initialBusy()
      || ['inspecting', 'running'].includes(migration.getState().kind)
      || controller.getState().read.kind === 'loading' || controller.getState().write.kind === 'writing' }, connectedCloud) : undefined;
  return Object.freeze({
    controller,
    migration,
    dispose() {
      if (disposed) return;
      disposed = true;
      sessionUi?.dispose();
      disposeMemo();
      disposeBackup?.();
      disposeUpgrade?.(); upgrade.dispose();
      disposeRestore?.(); disposeRecovery?.();
      disposeInitial?.(); store.invalidateInitial();
    },
  });
}

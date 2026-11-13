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
};

/**
 * 製品UIのlocal経路を、保存先取得や認証から独立して組み立てる。
 * 移行診断がreadyになり通常loadにも成功するまで、メモ操作UIを公開しない。
 */
export function createProductLocalApp(doc: Document, deps: ProductLocalDependencies,
  views: ProductLocalViews = defaultViews) {
  const upgrade = createProductV3Upgrade(deps);
  const store = createLocalMemoStore({ storage: upgrade.storage, locks: deps.locks, now: deps.now, initialVersion: 3 });
  const controller = createLocalMemoController({ store, createId: deps.createId });
  const migration = createLocalMigrationController({ ...deps, storage: upgrade.storage, acceptExistingV3: true });
  let disposeMemo = () => {};
  let disposed = false;
  let upgradeBusy = false;
  let disposeBackup: (() => void) | undefined;
  let disposeUpgrade: (() => void) | undefined;
  let backupOriginal = false;
  let disposeRestore: (() => void) | undefined, disposeRecovery: (() => void) | undefined;
  const normalReady = () => {
    const state = controller.getState();
    return !disposed && !upgradeBusy && state.route.kind !== 'edit' && state.read.kind === 'ready'
      && state.write.kind !== 'writing' && state.write.kind !== 'unknown' && state.write.kind !== 'rejected'
      && !state.confirmation && !state.unresolved.length
      && (!state.editor || requestNavigation(state.editor, { kind: 'switch-source' }).kind === 'allowed');
  };
  const restoreBusy = () => ['reading', 'writing', 'confirmation'].includes(restore.getState().phase);
  const recoveryBusy = () => ['reading', 'writing', 'diagnosing', 'opening', 'preview', 'unknown'].includes(recovery.getState().phase);
  const restore = createLocalRestoreController({ store, createId: deps.createId, canStart: () => normalReady() && !recoveryBusy() });
  const recovery = createDeletedRecoveryController({ store, createId: deps.createId, canStart: () => normalReady() && !restoreBusy(),
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
        if (disposed) return;
        await restore.dispatch(command);
        if (!disposed && restore.getState().phase === 'applied') await controller.dispatch({ kind: 'load' });
      },
    });
    if (!disposeRecovery && views.mountRecovery) disposeRecovery = views.mountRecovery(doc, {
      getState: recovery.getState,
      async dispatch(command) { if (!disposed) await recovery.dispatch(command); },
    }, () => { const route = controller.getState().route; return route.kind === 'detail' ? route.id : null; });
  };
  const prepareBackup = createLocalBackup({ storage: upgrade.storage, locks: deps.locks, now: deps.now });
  const syncBackup = () => {
    mountRecoveryViews();
    const state = controller.getState();
    if (disposed || !backupOriginal || state.read.kind !== 'ready' || state.storageVersion !== 3 || !views.mountBackup) return;
    disposeBackup?.();
    disposeBackup = views.mountBackup(doc, async () => disposed ? { kind: 'failed', reason: 'read-failure' } : prepareBackup());
    backupOriginal = false;
  };

  const enter = async (): Promise<boolean> => {
    if (disposed || migration.getState().kind !== 'ready') return false;
    await controller.dispatch({ kind: 'load' });
    if (disposed || controller.getState().read.kind !== 'ready') return false;
    disposeMemo();
    disposeMemo = views.mountMemo(doc, {
      getState: controller.getState,
      async dispatch(command) {
        if (disposed) return { kind: 'blocked', reason: 'disposed' };
        if ((upgradeBusy || restoreBusy() || recoveryBusy()) && command.kind !== 'draft') return { kind: 'blocked', reason: 'writing' };
        const result = await controller.dispatch(command);
        syncBackup();
        if (upgrade.getState() === 'legacy-changed') {
          const status = doc.getElementById('product-status');
          if (status) status.textContent = '旧キーの変更を検出しました。停止・要確認です。自動取込・再移行・上書きは行いません。';
        }
        return result;
      },
    });
    mountRecoveryViews();
    if (!disposeBackup && views.mountBackup) {
      const original = controller.getState().storageVersion === 2;
      backupOriginal = original;
      disposeBackup = views.mountBackup(doc, async () => disposed ? { kind: 'failed', reason: 'read-failure' }
        : original ? upgrade.prepare() : prepareBackup(), original ? 'v2-original' : 'backup');
      if (original && views.mountUpgrade) disposeUpgrade = views.mountUpgrade(doc, upgrade, () => {
        const state = controller.getState();
        return state.write.kind !== 'writing' && state.write.kind !== 'unknown' && state.write.kind !== 'rejected'
          && !state.confirmation && !state.unresolved.length
          && (!state.editor || requestNavigation(state.editor, { kind: 'switch-source' }).kind === 'allowed');
      }, async () => {
        const result = await controller.dispatch({ kind: 'load' });
        syncBackup();
        return result;
      }, busy => { upgradeBusy = busy; });
    }
    return true;
  };

  const migrationPort: typeof migration = {
    getState: migration.getState,
    async inspect() { if (!disposed) await migration.inspect(); },
    cancel(token) { if (!disposed) migration.cancel(token); },
    async confirm(token) { if (!disposed) await migration.confirm(token); },
  };
  views.mountMigration(doc, migrationPort, enter);
  return Object.freeze({
    controller,
    migration,
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeMemo();
      disposeBackup?.();
      disposeUpgrade?.(); upgrade.dispose();
      disposeRestore?.(); disposeRecovery?.();
    },
  });
}

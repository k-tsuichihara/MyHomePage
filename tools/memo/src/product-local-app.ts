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

export interface ProductLocalDependencies extends MigrationDependencies {
  readonly now: () => string;
}

export interface ProductLocalViews {
  readonly mountMigration: typeof mountMigrationPreview;
  readonly mountMemo: typeof mountMemoPreview;
  readonly mountBackup?: typeof mountBackupPreview;
  readonly mountUpgrade?: typeof mountV3Upgrade;
}

const defaultViews: ProductLocalViews = {
  mountMigration: mountMigrationPreview,
  mountMemo: mountMemoPreview,
  mountBackup: mountBackupPreview,
  mountUpgrade: mountV3Upgrade,
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
  const prepareBackup = createLocalBackup({ storage: upgrade.storage, locks: deps.locks, now: deps.now });

  const enter = async (): Promise<boolean> => {
    if (disposed || migration.getState().kind !== 'ready') return false;
    await controller.dispatch({ kind: 'load' });
    if (disposed || controller.getState().read.kind !== 'ready') return false;
    disposeMemo();
    disposeMemo = views.mountMemo(doc, {
      getState: controller.getState,
      async dispatch(command) {
        if (disposed) return { kind: 'blocked', reason: 'disposed' };
        if (upgradeBusy) return { kind: 'blocked', reason: 'writing' };
        const result = await controller.dispatch(command);
        if (upgrade.getState() === 'legacy-changed') {
          const status = doc.getElementById('product-status');
          if (status) status.textContent = '旧キーの変更を検出しました。停止・要確認です。自動取込・再移行・上書きは行いません。';
        }
        return result;
      },
    });
    if (!disposeBackup && views.mountBackup) {
      const original = controller.getState().storageVersion === 2;
      disposeBackup = views.mountBackup(doc, async () => disposed ? { kind: 'failed', reason: 'read-failure' }
        : original ? upgrade.prepare() : prepareBackup(), original ? 'v2-original' : 'backup');
      if (original && views.mountUpgrade) disposeUpgrade = views.mountUpgrade(doc, upgrade, () => {
        const state = controller.getState();
        return state.write.kind !== 'writing' && state.write.kind !== 'unknown' && state.write.kind !== 'rejected'
          && !state.confirmation && !state.unresolved.length
          && (!state.editor || requestNavigation(state.editor, { kind: 'switch-source' }).kind === 'allowed');
      }, async () => {
        const result = await controller.dispatch({ kind: 'load' });
        if (!disposed && controller.getState().storageVersion === 3 && views.mountBackup) {
          disposeBackup?.();
          disposeBackup = views.mountBackup(doc, async () => disposed ? { kind: 'failed', reason: 'read-failure' } : prepareBackup());
        }
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
    },
  });
}

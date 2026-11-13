import { createLocalMemoController } from './local-memo-controller';
import { createLocalMemoStore } from './local-memo-store';
import { createLocalMigrationController } from './local-migration-controller';
import type { MigrationDependencies } from './local-migration';
import { mountMemoPreview } from './ui/memo-preview';
import { mountMigrationPreview } from './ui/migration-preview';
import { createLocalBackup } from './local-backup';
import { mountBackupPreview } from './ui/backup-preview';
import { createV2OriginalExport } from './v2-original-export';

export interface ProductLocalDependencies extends MigrationDependencies {
  readonly now: () => string;
}

export interface ProductLocalViews {
  readonly mountMigration: typeof mountMigrationPreview;
  readonly mountMemo: typeof mountMemoPreview;
  readonly mountBackup?: typeof mountBackupPreview;
}

const defaultViews: ProductLocalViews = {
  mountMigration: mountMigrationPreview,
  mountMemo: mountMemoPreview,
  mountBackup: mountBackupPreview,
};

/**
 * 製品UIのlocal経路を、保存先取得や認証から独立して組み立てる。
 * 移行診断がreadyになり通常loadにも成功するまで、メモ操作UIを公開しない。
 */
export function createProductLocalApp(doc: Document, deps: ProductLocalDependencies,
  views: ProductLocalViews = defaultViews) {
  const store = createLocalMemoStore({ storage: deps.storage, locks: deps.locks, now: deps.now, initialVersion: 3 });
  const controller = createLocalMemoController({ store, createId: deps.createId });
  const migration = createLocalMigrationController({ ...deps, acceptExistingV3: true });
  let disposeMemo = () => {};
  let disposed = false;
  let disposeBackup: (() => void) | undefined;
  const prepareBackup = createLocalBackup({ storage: deps.storage, locks: deps.locks, now: deps.now });
  const prepareOriginal = createV2OriginalExport({ storage: deps.storage, locks: deps.locks, now: deps.now });

  const enter = async (): Promise<boolean> => {
    if (disposed || migration.getState().kind !== 'ready') return false;
    await controller.dispatch({ kind: 'load' });
    if (disposed || controller.getState().read.kind !== 'ready') return false;
    disposeMemo();
    disposeMemo = views.mountMemo(doc, {
      getState: controller.getState,
      async dispatch(command) { return disposed ? { kind: 'blocked', reason: 'disposed' } : controller.dispatch(command); },
    });
    if (!disposeBackup && views.mountBackup) {
      const original = controller.getState().storageVersion === 2;
      disposeBackup = views.mountBackup(doc, async () => disposed ? { kind: 'failed', reason: 'read-failure' }
        : original ? prepareOriginal() : prepareBackup(), original ? 'v2-original' : 'backup');
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
    },
  });
}

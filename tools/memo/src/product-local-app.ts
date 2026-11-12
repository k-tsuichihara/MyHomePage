import { createLocalMemoController } from './local-memo-controller';
import { createLocalMemoStore } from './local-memo-store';
import { createLocalMigrationController } from './local-migration-controller';
import type { MigrationDependencies } from './local-migration';
import { mountMemoPreview } from './ui/memo-preview';
import { mountMigrationPreview } from './ui/migration-preview';

export interface ProductLocalDependencies extends MigrationDependencies {
  readonly now: () => string;
}

export interface ProductLocalViews {
  readonly mountMigration: typeof mountMigrationPreview;
  readonly mountMemo: typeof mountMemoPreview;
}

const defaultViews: ProductLocalViews = {
  mountMigration: mountMigrationPreview,
  mountMemo: mountMemoPreview,
};

/**
 * 製品UIのlocal経路を、保存先取得や認証から独立して組み立てる。
 * 移行診断がreadyになり通常loadにも成功するまで、メモ操作UIを公開しない。
 */
export function createProductLocalApp(doc: Document, deps: ProductLocalDependencies,
  views: ProductLocalViews = defaultViews) {
  const store = createLocalMemoStore({ storage: deps.storage, locks: deps.locks, now: deps.now });
  const controller = createLocalMemoController({ store, createId: deps.createId });
  const migration = createLocalMigrationController(deps);
  let disposeMemo = () => {};
  let disposed = false;

  const enter = async (): Promise<boolean> => {
    if (disposed) return false;
    await controller.dispatch({ kind: 'load' });
    if (disposed || controller.getState().read.kind !== 'ready') return false;
    disposeMemo();
    disposeMemo = views.mountMemo(doc, controller);
    return true;
  };

  views.mountMigration(doc, migration, enter);
  return Object.freeze({
    controller,
    migration,
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeMemo();
    },
  });
}

import { inspectLocalMigration, migrateLocalData, recoverLocalMigration } from './local-migration';
import type { MigrationDependencies, MigrationResult } from './local-migration';

type Approval = Extract<MigrationResult, { kind: 'migration-required' | 'recovery-ready' }>;
export type MigrationView =
  | { kind: 'idle' | 'inspecting' | 'running' | 'cancelled'; generation: number }
  | { kind: 'confirmation'; generation: number; token: number; operation: 'migrate' | 'recover' }
  | { kind: 'ready'; generation: number; source: 'empty' | 'existing' | 'migrated' | 'recovered' }
  | { kind: 'stopped'; generation: number; result: Extract<MigrationResult, { kind: 'stopped' }> };

/** 生の承認材料は閉包内だけに保持し、表示状態へ含めない。書込失敗後の自動再試行はしない。 */
export function createLocalMigrationController(deps: MigrationDependencies) {
  let generation = 0, epoch = 0;
  let approval: Approval | null = null;
  let state: MigrationView = Object.freeze({ kind: 'idle', generation });
  const set = (next: MigrationView) => { state = Object.freeze(next); };
  function settle(result: MigrationResult) {
    if (result.kind === 'migration-required' || result.kind === 'recovery-ready') {
      approval = result;
      set({ kind: 'confirmation', generation, token: generation, operation: result.kind === 'migration-required' ? 'migrate' : 'recover' });
    } else if (result.kind === 'stopped') {
      set({ kind: 'stopped', generation, result: Object.freeze({ ...result, remaining: Object.freeze({ ...result.remaining }) }) });
    } else set({ kind: 'ready', generation, source: result.kind });
  }
  return {
    getState: (): MigrationView => state,
    async inspect() {
      if (state.kind === 'running') return;
      approval = null; const operation = ++epoch; ++generation;
      set({ kind: 'inspecting', generation });
      const result = await inspectLocalMigration(deps);
      if (operation === epoch) settle(result);
    },
    cancel(token: number) {
      if (state.kind !== 'confirmation' || token !== state.token) return;
      approval = null; ++epoch; ++generation; set({ kind: 'cancelled', generation });
    },
    async confirm(token: number) {
      if (state.kind !== 'confirmation' || token !== state.token || !approval) return;
      const accepted = approval; approval = null; ++epoch; ++generation;
      // 最初のawait前に確認を消費し、二重クリック・非同期再入から書込を守る。
      set({ kind: 'running', generation });
      const result = accepted.kind === 'migration-required'
        ? await migrateLocalData(deps, accepted.legacySnapshot)
        : await recoverLocalMigration(deps, accepted.legacySnapshot, accepted.pendingSnapshot);
      settle(result);
    },
  };
}

import { MemoryStorage, QueueLocks } from '../migration-fixtures';
import { createLocalMemoStore } from '../../src/local-memo-store';
import { createLocalMemoController } from '../../src/local-memo-controller';
import { createInitialRestoreController } from '../../src/initial-restore-controller';
import { isDirty } from '../../src/editor-state';

/** 保存領域は毎ページ新規の合成Map。故障注入はこの試験fixtureだけに限定する。 */
export function createInitialEnvironment(scenario: string) {
  const storage = new MemoryStorage(), locks = new QueueLocks();
  let n = 500;
  const createId = () => `abcdef00-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  if (scenario === 'initial-quota') storage.beforeSet = () => { throw Error('Synthetic quota'); };
  if (scenario === 'initial-after-write') storage.afterSet = () => { throw Error('Synthetic after write'); };
  const base = createLocalMemoStore({ storage, locks, now: () => '2026-11-01T00:00:00Z' });
  const store: typeof base = { ...base,
    async applyInitial(input) { if (scenario === 'initial-slow') await new Promise(resolve => setTimeout(resolve, 500)); return base.applyInitial(input); },
    async load() { return scenario === 'initial-reload-failure' && storage.writes.length ? { kind: 'unavailable', reason: 'storage-failure' } : base.load(); },
  };
  const controller = createLocalMemoController({ store, createId });
  const initial = createInitialRestoreController({ store, createId, canStart: () => {
    const s = controller.getState();
    // 保存済み詳細に残るcleanな編集状態は、未保存ドラフトとは区別する。
    const editing = s.editor && (s.route.kind === 'edit' || isDirty(s.editor));
    return !editing && s.write.kind !== 'writing' && !s.confirmation;
  }, openNormal: async () => { await controller.dispatch({ kind: 'load' }); return controller.getState().read.kind === 'ready'; } });
  return { controller, initial, migration: { storage, locks, createId } };
}

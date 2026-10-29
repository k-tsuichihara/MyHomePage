import { createLocalMemoStore } from '../../src/local-memo-store';
import { createLocalMemoController } from '../../src/local-memo-controller';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../../src/local-migration';
import { createPendingMigration } from '../../src/migration';
import { MemoryStorage, QueueLocks, oldRows } from '../migration-fixtures';

/** 固定の合成シナリオのみ。URLから利用者のJSONを受け付けない。 */
export function createMigrationEnvironment(scenario: string) {
  const storage = new MemoryStorage(), queue = new QueueLocks();
  let sequence = 200;
  const createId = () => `abcdef00-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
  const legacy = JSON.stringify(oldRows());
  if (scenario !== 'empty') storage.values.set(OLD_STORAGE_KEY, scenario === 'invalid' ? '{' : legacy);
  if (scenario === 'pending' || scenario === 'broken-pending') {
    const pending = createPendingMigration(legacy, createId);
    storage.values.set(NEW_STORAGE_KEY, JSON.stringify(pending));
    if (scenario === 'broken-pending') storage.values.set(OLD_STORAGE_KEY, '[]');
  }
  // 一度だけ書込後に中断し、明示的な再診断から復旧を試せる。
  if (scenario === 'interrupted') storage.afterSet = () => { delete storage.afterSet; throw new Error('Synthetic interruption'); };
  if (scenario === 'readback-failure') storage.afterSet = () => { storage.values.set(NEW_STORAGE_KEY, '{'); };
  const locks = scenario === 'no-locks' ? undefined : queue;
  const store = createLocalMemoStore({ storage, locks, now: () => '2026-10-29T00:00:00Z' });
  return { controller: createLocalMemoController({ store, createId }), migration: { storage, locks, createId } };
}

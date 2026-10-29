import { createLocalMemoStore } from '../../src/local-memo-store';
import { createLocalMemoController } from '../../src/local-memo-controller';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../../src/local-migration';
import { createPendingMigration } from '../../src/migration';
import { MemoryStorage, QueueLocks, oldRows } from '../migration-fixtures';

/** 固定の合成シナリオのみ。URLから利用者のJSONを受け付けない。 */
export function createMigrationEnvironment(scenario: string) {
  const handoff = /^handoff-(empty|existing|migrated|recovered)-(pending|invalid)$/.exec(scenario);
  if (handoff) scenario = handoff[1] === 'recovered' ? 'pending' : handoff[1] === 'empty' ? 'empty' : 'legacy';
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
  if (handoff?.[1] === 'existing') storage.values.set(NEW_STORAGE_KEY, JSON.stringify({ version: 2, migration: { status: 'not-required' }, memos: [], tags: [], memoTags: [] }));
  // 一度だけ書込後に中断し、明示的な再診断から復旧を試せる。
  if (scenario === 'interrupted') storage.afterSet = () => { delete storage.afterSet; throw new Error('Synthetic interruption'); };
  if (scenario === 'readback-failure') storage.afterSet = () => { storage.values.set(NEW_STORAGE_KEY, '{'); };
  const locks = scenario === 'no-locks' ? undefined : queue;
  const base = createLocalMemoStore({ storage, locks, now: () => '2026-10-29T00:00:00Z' });
  let changed = false;
  const store: typeof base = { ...base, async load() {
    // 診断の後、通常controllerの初回読取だけで外部変更を注入する。
    if (handoff && !changed) {
      changed = true;
      storage.values.set(OLD_STORAGE_KEY, legacy);
      storage.values.set(NEW_STORAGE_KEY, handoff[2] === 'invalid' ? '{' : JSON.stringify(createPendingMigration(legacy, createId)));
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    return base.load();
  } };
  return { controller: createLocalMemoController({ store, createId }), migration: { storage, locks, createId } };
}

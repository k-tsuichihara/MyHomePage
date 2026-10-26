import type { LocalLockManager } from '../src/local-lock';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';
import type { MigrationDependencies, MigrationStorage } from '../src/local-migration';

/** 実ブラウザ保存先を使わず、各I/Oの前後へ障害・ロック外変更を注入する。 */
export class MemoryStorage implements MigrationStorage {
  values = new Map<string, string>();
  writes: Array<[string, string]> = [];
  beforeGet?: (key: string) => void;
  beforeSet?: (key: string, value: string) => void;
  afterSet?: (key: string, value: string) => void;
  getItem(key: string): string | null { this.beforeGet?.(key); return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if (key !== NEW_STORAGE_KEY) throw new Error('旧キーへの書込は禁止');
    this.beforeSet?.(key, value);
    this.writes.push([key, value]); this.values.set(key, value);
    this.afterSet?.(key, value);
  }
}

/** 同名ロックを直列化する合成LockManager。実Web Locksのブラウザ試験の代用ではない。 */
export class QueueLocks implements LocalLockManager {
  calls: Array<{ name: string; mode: string }> = [];
  private tail: Promise<unknown> = Promise.resolve();
  request<T>(name: string, options: { mode: 'exclusive' }, operation: () => Promise<T>): Promise<T> {
    this.calls.push({ name, mode: options.mode });
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
export const ids = ['abcdef01-2345-4000-8000-000000000001', 'abcdef01-2345-4000-8000-000000000002'];
export const oldRows = () => [
  { id: 'old-one', title: 'e\u0301😀', text: ' \t本文\n ', createdAt: '2024-02-29T23:59:59.123456+23:59', updatedAt: '2026-10-26T00:00:00Z' },
  { id: 'old-two', title: '二件目', text: '', createdAt: '2026-10-25T00:00:00-00:00', updatedAt: '2026-10-26T00:00:00Z' },
];
export function fixture(raw: string | null = JSON.stringify(oldRows())) {
  const storage = new MemoryStorage(), locks = new QueueLocks();
  if (raw !== null) storage.values.set(OLD_STORAGE_KEY, raw);
  let generated = 0;
  const deps: MigrationDependencies = { storage, locks, createId: () => ids[generated++]! };
  return { deps, storage, locks, raw: raw!, generated: () => generated };
}

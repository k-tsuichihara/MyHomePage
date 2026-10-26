import { describe, expect, it } from 'vitest';
import { LOCAL_DATA_LOCK_NAME, LocalLocksUnavailableError, withLocalDataLock } from '../src/local-lock';
import type { LocalLockManager } from '../src/local-lock';
import { QueueLocks } from './migration-fixtures';

/** 型チェック専用。実navigatorへのアクセスはしない。 */
export const acceptBrowserLockManager = (locks: LockManager): LocalLockManager => locks;

describe('ローカルデータの共通排他', () => {
  it('共通名・exclusiveで実行し、結果を返す', async () => {
    const locks = new QueueLocks();
    expect(await withLocalDataLock(locks, async () => 42)).toBe(42);
    expect(locks.calls).toEqual([{ name: LOCAL_DATA_LOCK_NAME, mode: 'exclusive' }]);
  });
  it('非対応時はコールバックを呼ばない', async () => {
    let called = false;
    await expect(withLocalDataLock(undefined, async () => { called = true; })).rejects.toBeInstanceOf(LocalLocksUnavailableError);
    expect(called).toBe(false);
  });
  it('先行処理の完了まで待ち、失敗しても次の取得を妨げない', async () => {
    const locks = new QueueLocks(), order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = withLocalDataLock(locks, async () => { order.push('first'); await gate; throw new Error('合成失敗'); });
    const failed = expect(first).rejects.toThrow('合成失敗');
    const second = withLocalDataLock(locks, async () => { order.push('second'); });
    await Promise.resolve(); expect(order).toEqual(['first']);
    release(); await failed; await second;
    expect(order).toEqual(['first', 'second']);
  });
});

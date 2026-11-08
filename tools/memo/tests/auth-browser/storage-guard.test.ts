import { afterEach, expect, it, vi } from 'vitest';
import { installAuthStorageGuard } from './storage-guard';

afterEach(() => vi.unstubAllGlobals());
function setup(permit: boolean) {
  const native = vi.fn(() => null);
  class FakeStorage {}
  // オブジェクト参照だけを先に保持し、実Storageや実値には触れない。
  for (const method of ['getItem', 'setItem', 'removeItem', 'key', 'clear'])
    Object.defineProperty(FakeStorage.prototype, method, { value: native, configurable: true });
  const cached = Object.create(FakeStorage.prototype) as Storage;
  const scope = Object.defineProperty({}, 'localStorage', { get: () => cached, configurable: true });
  vi.stubGlobal('window', scope); vi.stubGlobal('Storage', FakeStorage);
  installAuthStorageGuard({ permit, origin: 'http://127.0.0.1:43219', runId: 'synthetic-run' });
  return { cached, native, scope: scope as Window };
}
it('未許可のSDK import前ゲートはgetter取得とメソッド操作を別々に観測する', () => {
  const { scope, native } = setup(false);
  expect(scope.__authStorageAudit!()).toEqual({ gets: 0, reads: 0, writes: 0, removals: 0, denied: 0, touched: [] });
  expect(() => scope.localStorage).toThrow('Unpermitted storage');
  expect(scope.__authStorageAudit!().gets).toBe(1);
  expect(scope.__authStorageAudit!().reads).toBe(0); expect(native).not.toHaveBeenCalled();
});
it('取得済み参照からのget/set/removeも未許可ならネイティブ到達前に拒否する', () => {
  const { cached, native, scope } = setup(false);
  expect(() => cached.getItem('myhomepage.memo.auth.v1')).toThrow();
  expect(() => cached.setItem('myhomepage.memo.auth.v1', 'synthetic')).toThrow();
  expect(() => cached.removeItem('myhomepage.memo.auth.v1')).toThrow();
  expect(scope.__authStorageAudit!()).toEqual({ gets: 0, reads: 1, writes: 1, removals: 1, denied: 3, touched: [] });
  expect(native).not.toHaveBeenCalled();
});
it('許可ありでも専用外キー・列挙・clearは拒否し、値を監視結果に含めない', () => {
  const { cached, native, scope } = setup(true);
  expect(() => cached.getItem('supabase.gotrue-js.locks.debug')).toThrow();
  expect(() => cached.key(0)).toThrow(); expect(() => cached.clear()).toThrow();
  cached.setItem('myhomepage.memo.auth.v1', 'synthetic-secret');
  expect(native).toHaveBeenCalledTimes(1);
  expect(scope.__authStorageAudit!().denied).toBe(3);
  expect(JSON.stringify(scope.__authStorageAudit!())).not.toContain('synthetic-secret');
});

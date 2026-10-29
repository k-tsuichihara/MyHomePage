import { describe, it, expect, vi } from 'vitest';
import { createBrowserLocalAdapter, BrowserBoundaryError } from '../src/browser-local-adapter';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';

const permit = { origin: 'http://127.0.0.1:43219', runId: '12345678-1234-1234-1234-123456789abc' };
function fixture() {
  const getItem = vi.fn(() => null), setItem = vi.fn();
  const getStorage = vi.fn(() => ({ getItem, setItem })), getLocks = vi.fn(() => undefined);
  return { env: { origin: permit.origin, secure: true, topLevel: true, getStorage, getLocks }, getItem, setItem };
}
describe('実ブラウザ未接続の接続境界', () => {
  it.each(['https://example.com', 'http://localhost:43219', 'http://127.0.0.1:4173', 'null', 'http://127.0.0.1:43219/path'])('不許可originではAPI取得0件：%s', origin => {
    const f = fixture(); expect(() => createBrowserLocalAdapter({ ...f.env, origin }, { ...permit, origin })).toThrow(BrowserBoundaryError);
    expect(f.env.getStorage).not.toHaveBeenCalled(); expect(f.env.getLocks).not.toHaveBeenCalled();
  });
  it.each(['missing', 'mismatch', 'insecure', 'frame', 'invalid-id'])('許可不成立ではAPI取得0件：%s', mode => {
    const f = fixture();
    const p = mode === 'missing' ? undefined : { ...permit, ...(mode === 'mismatch' ? { origin: 'http://127.0.0.1:44444' } : {}), ...(mode === 'invalid-id' ? { runId: 'x' } : {}) };
    expect(() => createBrowserLocalAdapter({ ...f.env, secure: mode !== 'insecure', topLevel: mode !== 'frame' }, p)).toThrow(BrowserBoundaryError);
    expect(f.env.getStorage).not.toHaveBeenCalled(); expect(f.env.getLocks).not.toHaveBeenCalled();
  });
  it('旧／新キー読取と新キー書込だけを公開し、生成時にStorageへ触れない', () => {
    const f = fixture(), adapter = createBrowserLocalAdapter(f.env, permit);
    expect(f.env.getStorage).not.toHaveBeenCalled();
    adapter.storage.getItem(OLD_STORAGE_KEY); adapter.storage.getItem(NEW_STORAGE_KEY); adapter.storage.setItem(NEW_STORAGE_KEY, '{}');
    expect(f.getItem).toHaveBeenCalledTimes(2); expect(f.setItem).toHaveBeenCalledExactlyOnceWith(NEW_STORAGE_KEY, '{}');
    expect(Object.keys(adapter.storage).sort()).toEqual(['getItem', 'setItem']);
    expect(() => adapter.storage.setItem(OLD_STORAGE_KEY, 'x')).toThrow(BrowserBoundaryError);
    expect(() => adapter.storage.getItem('other')).toThrow(BrowserBoundaryError);
    expect(f.setItem).toHaveBeenCalledTimes(1);
  });
  it('Storage取得例外を既存I/O例外境界へ伝え、生成時の書込probeをしない', () => {
    const f = fixture(); f.env.getStorage.mockImplementation(() => { throw new Error('synthetic'); });
    const adapter = createBrowserLocalAdapter(f.env, permit);
    expect(() => adapter.storage.getItem(NEW_STORAGE_KEY)).toThrow('synthetic'); expect(f.setItem).not.toHaveBeenCalled();
  });
  it('ロック取得口の例外を生情報なしで停止', () => {
    const f = fixture(); f.env.getLocks.mockImplementation(() => { throw new Error('PRIVATE'); });
    expect(() => createBrowserLocalAdapter(f.env, permit)).toThrow('Persistence test boundary rejected'); expect(f.env.getStorage).not.toHaveBeenCalled();
  });
});

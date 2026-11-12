import { describe, expect, it, vi } from 'vitest';
import { createProductBrowserLocalDependencies, ProductBrowserBoundaryError } from '../src/product-browser-local';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';

function fixture(overrides: Partial<Parameters<typeof createProductBrowserLocalDependencies>[0]> = {}) {
  const getItem = vi.fn<(key: string) => string | null>(() => null);
  const setItem = vi.fn<(key: string, value: string) => void>();
  const env = {
    url: 'https://example.test/tools/memo/memo.html', secure: true, topLevel: true,
    getStorage: vi.fn(() => ({ getItem, setItem })), getLocks: vi.fn(() => undefined),
    createId: () => '00000000-0000-4000-8000-000000000001', now: () => '2026-11-12T00:00:00.000Z',
    ...overrides,
  };
  return { env, getItem, setItem };
}

describe('product browser local boundary', () => {
  it.each([
    ['http', { url: 'http://example.test/tools/memo/memo.html' }],
    ['別path', { url: 'https://example.test/tools/memo/other.html' }],
    ['query', { url: 'https://example.test/tools/memo/memo.html?target=other' }],
    ['frame', { topLevel: false }],
    ['非secure', { secure: false }],
  ])('%sはStorage取得前に拒否する', (_name, overrides) => {
    const f = fixture(overrides);
    expect(() => createProductBrowserLocalDependencies(f.env)).toThrow(ProductBrowserBoundaryError);
    expect(f.env.getStorage).not.toHaveBeenCalled();
  });

  it('project site prefixを許可し、旧新2キーだけを読む', () => {
    const f = fixture({ url: 'https://example.test/MyHomePage/tools/memo/memo.html' });
    const deps = createProductBrowserLocalDependencies(f.env);
    deps.storage.getItem(OLD_STORAGE_KEY); deps.storage.getItem(NEW_STORAGE_KEY);
    expect(f.getItem.mock.calls.map(call => call[0])).toEqual([OLD_STORAGE_KEY, NEW_STORAGE_KEY]);
    expect(() => deps.storage.getItem('other')).toThrow(ProductBrowserBoundaryError);
  });

  it('新キーだけを書き、旧キーや他キーを変更しない', () => {
    const f = fixture(); const deps = createProductBrowserLocalDependencies(f.env);
    deps.storage.setItem(NEW_STORAGE_KEY, '{}');
    expect(f.setItem).toHaveBeenCalledExactlyOnceWith(NEW_STORAGE_KEY, '{}');
    expect(() => deps.storage.setItem(OLD_STORAGE_KEY, '[]')).toThrow(ProductBrowserBoundaryError);
    expect(() => deps.storage.setItem('other', 'x')).toThrow(ProductBrowserBoundaryError);
  });
});

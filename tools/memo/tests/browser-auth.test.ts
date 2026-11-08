import { expect, it, vi } from 'vitest';
import { createBrowserMemoAuth } from '../src/browser-auth';

const permit = { origin: 'http://127.0.0.1:43219', runId: '12345678-1234-1234-1234-123456789abc' };
const config = { url: 'https://memo-auth.invalid', publicKey: 'sb_publishable_synthetic_only' };
it.each(['missing', 'mismatch', 'invalid-id', 'insecure', 'frame', 'public', 'shared-port'])('不許可の%sはStorage取得・通信前に停止', mode => {
  const getStorage = vi.fn(() => ({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }));
  const fetch = vi.fn<typeof globalThis.fetch>();
  const env = { origin: mode === 'public' ? 'https://example.com' : mode === 'shared-port' ? 'http://127.0.0.1:4173' : permit.origin,
    secure: mode !== 'insecure', topLevel: mode !== 'frame', getStorage };
  const value = mode === 'missing' ? undefined : { ...permit, origin: mode === 'mismatch' ? 'http://127.0.0.1:44444' : env.origin,
    runId: mode === 'invalid-id' ? 'invalid' : permit.runId };
  expect(() => createBrowserMemoAuth(env, value, config, fetch)).toThrow('Persistence test boundary rejected');
  expect(getStorage).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

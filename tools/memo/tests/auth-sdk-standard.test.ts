import { afterEach, expect, it, vi } from 'vitest';
import { createMemoSdkAuth } from '../src/auth-sdk';

const captured = vi.hoisted(() => ({ options: undefined as Parameters<typeof import('@supabase/supabase-js').createClient>[2] }));
vi.mock('@supabase/supabase-js', async original => {
  const sdk = await original<typeof import('@supabase/supabase-js')>();
  return { ...sdk, createClient: (...args: Parameters<typeof sdk.createClient>) => { captured.options = args[2]; return sdk.createClient(...args); } };
});
let client: ReturnType<typeof createMemoSdkAuth> | undefined;
afterEach(async () => { await client?.dispose(); vi.restoreAllMocks(); });
it('SDKへfetch/Storageを直接渡し、Auth Response再構築・追加transport境界を設けない', async () => {
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const response = new Response(JSON.stringify({ synthetic: true }), { status: 200, headers: { 'Content-Type': 'text/plain' } });
  const transport = vi.fn<typeof fetch>(async () => response);
  client = createMemoSdkAuth({ url: 'https://standard-auth.invalid', publicKey: 'sb_publishable_synthetic_only' }, storage, transport);
  expect(captured.options?.global?.fetch).toBe(transport);
  expect(captured.options?.auth).toMatchObject({ storage, storageKey: 'myhomepage.memo.auth.v1', persistSession: true,
    autoRefreshToken: true, detectSessionInUrl: false, debug: false });
  expect(await captured.options!.global!.fetch!('https://standard-auth.invalid/auth/v1/token?grant_type=password', { method: 'POST' })).toBe(response);
  expect(transport).toHaveBeenCalledOnce();
});

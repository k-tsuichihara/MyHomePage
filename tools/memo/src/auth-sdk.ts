import { createClient } from '@supabase/supabase-js';
import { createMemoAuthClient, type AuthStorage } from './auth-client';
import { createMemoAuthSession, type AuthenticatedRpcSender } from './auth-session';

/** SDK標準Authを利用する。fetch注入はoffline試験にも同じSDK経路を使うためのもの。 */
export function createMemoSdkAuth(config: { url: string; publicKey: string },
  storage: AuthStorage, transport: typeof fetch, rpcSender?: AuthenticatedRpcSender) {
  let sdk: ReturnType<typeof createClient> | undefined;
  const client = createMemoAuthClient((url, key, options) => {
    sdk = createClient(url, key, { ...options, auth: { ...options.auth, debug: false }, global: { fetch: transport } });
    return { auth: sdk.auth };
  }, config, storage);
  const session = createMemoAuthSession(client.auth, Date.now, rpcSender);
  let disposal: Promise<void> | undefined;
  return Object.freeze({ session,
    dispose(): Promise<void> {
      if (disposal) return disposal;
      session.dispose();
      disposal = (async () => { await sdk!.auth.initialize(); await sdk!.auth.dispose(); })();
      return disposal;
    },
  });
}

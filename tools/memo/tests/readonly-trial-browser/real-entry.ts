import { createReadonlyTrialRunner } from '../../src/readonly-trial-runner';
import { MEMO_RPC_ORIGIN } from '../../src/cloud-rpc-sender';
import type { PersistencePermit } from '../../src/browser-local-adapter';

declare global { interface Window { __humanGateConfig?: { projectRef: string; authOrigin: string; publishableKey: string; permit: PersistencePermit } } }
const cfg = window.__humanGateConfig;
let runner: ReturnType<typeof createReadonlyTrialRunner> | undefined;
const status = () => document.getElementById('status')!;
const render = () => { const observation = runner?.observation() ?? { state: 'idle', authCalls: 0, rpcCalls: 0, rpcNames: [], otherRpcCalls: 0, stopReason: null }; status().textContent = JSON.stringify({ ...observation, writeRpcCalls: 0 }); };
const fail = (prefix: string, error: unknown) => { status().textContent = `${prefix}: ${error instanceof Error ? error.message : 'unknown'}`; };
if (!cfg) fail('STOP', new Error('trusted configuration missing'));
else {
  const permit = cfg.permit;
  runner = createReadonlyTrialRunner({ expectedProjectRef: cfg.projectRef, projectRef: cfg.projectRef,
    expectedOrigin: MEMO_RPC_ORIGIN, expectedAuthOrigin: cfg.authOrigin, origin: MEMO_RPC_ORIGIN,
    env: { origin: location.origin, secure: isSecureContext, topLevel: window.top === window, getStorage: () => window.localStorage }, permit,
    authConfig: { url: cfg.authOrigin, publicKey: cfg.publishableKey },
    rpcConfig: { origin: MEMO_RPC_ORIGIN, publishableKey: cfg.publishableKey }, authTransport: fetch,
    rpcFetch: fetch });
  render();
  document.getElementById('auth')!.addEventListener('click', async () => {
    const email = (document.getElementById('email') as HTMLInputElement).value;
    const password = document.getElementById('password') as HTMLInputElement;
    try { await runner!.startAuth({ email, password: password.value }); } catch (error) { fail('STOP', error); }
    finally { password.value = ''; (document.getElementById('email') as HTMLInputElement).value = ''; render();
      (document.getElementById('load') as HTMLButtonElement).disabled = runner!.observation().state !== 'authenticated'; }
  });
  document.getElementById('load')!.addEventListener('click', async () => { try { await runner!.load(); render(); } catch (error) { fail('UNKNOWN', error); } });
  document.getElementById('dispose')!.addEventListener('click', async () => { await runner!.dispose(); render(); });
}

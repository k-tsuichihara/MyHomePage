import { createReadonlyTrialRunner } from '../../src/readonly-trial-runner';
import { MEMO_RPC_ORIGIN } from '../../src/cloud-rpc-sender';
import type { PersistencePermit } from '../../src/browser-local-adapter';

declare global { interface Window { __humanGateConfig?: { projectRef: string; authOrigin: string; publishableKey: string; permit: PersistencePermit } } }
const cfg = window.__humanGateConfig;
let runner: ReturnType<typeof createReadonlyTrialRunner> | undefined;
let loadResult: { kind: string; innerKind: string | null; reason: string | null } | null = null;
const status = () => document.getElementById('status')!;
const render = () => { const observation = runner?.observation() ?? { state: 'idle', authCalls: 0, rpcCalls: 0, rpcNames: [], otherRpcCalls: 0, stopReason: null }; status().textContent = JSON.stringify({ ...observation, writeRpcCalls: 0, loadResult }); };
const fail = (prefix: string) => { const observation = runner?.observation(); status().textContent = JSON.stringify({ state: observation?.state ?? 'unknown', authCalls: observation?.authCalls ?? 0, rpcCalls: observation?.rpcCalls ?? 0, rpcNames: observation?.rpcNames ?? [], otherRpcCalls: observation?.otherRpcCalls ?? 0, writeRpcCalls: 0, loadResult, result: prefix }); };
if (!cfg) fail('STOP');
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
    try { await runner!.startAuth({ email, password: password.value }); } catch { fail('STOP'); }
    finally { password.value = ''; (document.getElementById('email') as HTMLInputElement).value = ''; render();
      (document.getElementById('load') as HTMLButtonElement).disabled = runner!.observation().state !== 'authenticated'; }
  });
  document.getElementById('load')!.addEventListener('click', async () => { try {
    const result = await runner!.load();
    const inner = result?.kind === 'completed' && result.result && typeof result.result === 'object' ? result.result as { kind?: unknown; reason?: unknown } : undefined;
    loadResult = { kind: result?.kind ?? 'none', innerKind: typeof inner?.kind === 'string' ? inner.kind : null, reason: typeof inner?.reason === 'string' ? inner.reason : null };
    render();
  } catch { fail('UNKNOWN'); } });
  document.getElementById('dispose')!.addEventListener('click', async () => { await runner!.dispose(); render(); });
  const renderTimer = window.setInterval(render, 50);
  window.addEventListener('pagehide', () => window.clearInterval(renderTimer), { once: true });
}

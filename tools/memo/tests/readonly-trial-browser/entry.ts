import { createBrowserReadonlyTrial } from '../../src/readonly-trial';
import type { PersistencePermit } from '../../src/browser-local-adapter';

declare global { interface Window { __readonlyTrial?: { startAuth(): Promise<void>; load(): Promise<void>; observation(): unknown } } }
const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const permit = (window as Window & { __readonlyPermit?: PersistencePermit }).__readonlyPermit;
let app: ReturnType<typeof createBrowserReadonlyTrial> | undefined;
const status = () => document.getElementById('status')!;
const render = () => { status().textContent = JSON.stringify(app?.trial.observation() ?? { state: 'idle' }); };
const syntheticAuth = async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname.endsWith('/token')) return new Response(JSON.stringify({ access_token: 'synthetic-token', refresh_token: 'synthetic-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user: { id: OWNER } }), { status: 200 });
  if (url.pathname.endsWith('/user')) return new Response(JSON.stringify({ id: OWNER }), { status: 200 });
  throw new Error('synthetic-auth-path-denied');
};
const syntheticRpc = async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!url.pathname.endsWith('/memo_load_snapshot')) throw new Error('readonly-trial-rpc-denied');
  return new Response(JSON.stringify({ memos: [], tags: [], memoTags: [] }), { status: 200 });
};
window.__readonlyTrial = {
  async startAuth() {
    if (!permit) throw new Error('readonly trial permit missing');
    app = createBrowserReadonlyTrial({ origin: location.origin, secure: isSecureContext, topLevel: window.top === window,
      getStorage: () => window.localStorage }, permit,
      { url: 'https://memo-browser.invalid', publicKey: 'sb_publishable_synthetic_only' }, syntheticAuth,
      { origin: 'https://memo-browser.invalid', publishableKey: 'sb_publishable_synthetic_only' }, syntheticRpc);
    await app.session.login('synthetic@example.invalid', 'synthetic-password'); render();
  },
  async load() {
    if (!app) throw new Error('auth not started');
    const context = app.session.getContext(); if (!context) throw new Error('auth unavailable');
    await app.trial.load(context); render();
  },
  observation: () => app?.trial.observation() ?? { state: 'idle' },
};
document.getElementById('auth')!.addEventListener('click', () => void window.__readonlyTrial!.startAuth().catch(error => { status().textContent = `STOP: ${error instanceof Error ? error.message : 'unknown'}`; }));
document.getElementById('load')!.addEventListener('click', () => void window.__readonlyTrial!.load().catch(error => { status().textContent = `UNKNOWN: ${error instanceof Error ? error.message : 'unknown'}`; }));

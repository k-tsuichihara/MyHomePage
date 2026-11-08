import { createBrowserMemoAuth } from '../../src/browser-auth';
import { requirePersistencePermit } from '../../src/browser-local-adapter';
import type { PersistencePermit } from '../../src/browser-local-adapter';
import type { AuthContext } from '../../src/auth-session';
import { navigatorLock, processLock, NavigatorLockAcquireTimeoutError, createClient } from '@supabase/supabase-js';

declare global { interface Window {
  __authPermit?: PersistencePermit;
  __authBrowser?: ReturnType<typeof createHarness>;
} }
const KEY = 'myhomepage.memo.auth.v1';
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const env = { origin: location.origin, secure: isSecureContext, topLevel: window.top === window };

function createHarness() {
  requirePersistencePermit(env, window.__authPermit);
  let mode = '', sequence = 0, busy = false;
  if (!window.__authStorageAudit) throw new Error('Early storage guard missing');
  for (const name of ['sessionStorage', 'indexedDB', 'caches', 'cookieStore']) Object.defineProperty(window, name, { get() { throw new Error('Forbidden persistence API'); } });
  Object.defineProperty(Document.prototype, 'cookie', { get() { throw new Error('Forbidden cookie API'); }, set() { throw new Error('Forbidden cookie API'); } });
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'RTCPeerConnection'])
    Object.defineProperty(window, name, { value() { throw new Error('Forbidden network API'); } });
  Object.defineProperty(navigator, 'sendBeacon', { value() { throw new Error('Forbidden network API'); } });
  if ('serviceWorker' in navigator) Object.defineProperty(navigator, 'serviceWorker', { get() { throw new Error('Forbidden service worker API'); } });

  const calls = { password: 0, refresh: 0, user: 0, logout: 0 };
  let releaseRefresh: (() => void) | undefined;
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const user = { id: A, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
  function payload() {
    const now = Math.floor(Date.now() / 1000); sequence++;
    return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: A, exp: now + 3600, iat: now, jti: sequence })}.${encode('synthetic-signature')}`,
      refresh_token: `synthetic-refresh-${sequence}`, expires_at: now + 3600, expires_in: 3600, token_type: 'bearer', user };
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const transport: typeof fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== 'https://memo-browser.invalid') throw new Error('Synthetic origin rejected');
    if (url.pathname === '/auth/v1/user') {
      calls.user++; return mode === 'user-denied' ? json({ error_code: 'session_not_found', message: 'Synthetic denial' }, 401) : json(user);
    }
    if (url.pathname === '/auth/v1/token') {
      const refresh = url.searchParams.get('grant_type') === 'refresh_token';
      if (refresh) calls.refresh++; else calls.password++;
      if (refresh && mode === 'refresh-denied') return json({ error_code: 'refresh_token_not_found', message: 'Synthetic denial' }, 400);
      if (refresh && mode === 'hold-refresh') await new Promise<void>(resolve => { releaseRefresh = resolve; });
      if (mode === 'slow-login') await new Promise(resolve => setTimeout(resolve, 200));
      return json(payload());
    }
    if (url.pathname === '/auth/v1/logout' && url.searchParams.get('scope') === 'local') { calls.logout++; return new Response(null, { status: 204 }); }
    throw new Error('Synthetic path rejected');
  };
  let instance: ReturnType<typeof createBrowserMemoAuth> | undefined;
  let oldContext: AuthContext | null = null;
  async function initialize() {
    await instance?.dispose();
    instance = createBrowserMemoAuth({ ...env, getStorage: () => {
      if (mode === 'get-storage') throw new Error('Synthetic storage denial');
      return window.localStorage;
    } }, window.__authPermit, { url: 'https://memo-browser.invalid', publicKey: 'sb_publishable_synthetic_only' }, transport);
    await instance.session.restore();
  }
  const actions = {
    login: () => instance!.session.login('synthetic@example.invalid', 'synthetic-password'),
    logout: () => instance!.session.logout(), restore: () => instance!.session.restore(),
    dispose: () => instance!.dispose(), initialize,
  };
  function render() {
    document.getElementById('status')!.textContent = instance?.session.getState().phase ?? 'initializing';
    for (const id of Object.keys(actions)) (document.getElementById(id) as HTMLButtonElement).disabled = busy || instance?.session.getState().phase === 'checking';
  }
  async function perform(action: keyof typeof actions) {
    if (busy) return 'busy'; busy = true; render();
    try { return await actions[action](); } finally { busy = false; render(); }
  }
  for (const id of Object.keys(actions) as (keyof typeof actions)[])
    document.getElementById(id)!.addEventListener('click', () => { void perform(id).catch(() => { document.getElementById('status')!.textContent = 'stopped'; }); });
  const timer = setInterval(render, 50);
  window.addEventListener('pagehide', () => { clearInterval(timer); void instance?.dispose().catch(() => {}); });
  const ready = perform('initialize');
  return {
    ready: () => ready.then(() => true), perform,
    state: () => instance!.session.getState(), canWrite: () => !!instance?.session.getContext(),
    rememberContext() { oldContext = instance!.session.getContext(); },
    oldContextCurrent: () => !!oldContext && instance!.session.isCurrent(oldContext),
    mode(value: string) { if (!['', 'refresh-denied', 'user-denied', 'get-storage', 'slow-login', 'hold-refresh'].includes(value)) throw new Error('Unknown synthetic mode'); mode = value; },
    refreshHeld: () => !!releaseRefresh,
    releaseRefresh() { const release = releaseRefresh; releaseRefresh = undefined; mode = ''; release?.(); },
    async checkLocks() {
      const name = 'memo-auth-synthetic-lock';
      let release!: () => void, acquired!: () => void;
      const ready = new Promise<void>(resolve => { acquired = resolve; });
      const first = navigatorLock(name, -1, async () => { acquired(); await new Promise<void>(resolve => { release = resolve; }); });
      await ready;
      let unavailable = false;
      try { await navigatorLock(name, 0, async () => { throw new Error('Must not acquire held lock'); }); }
      catch (error) { unavailable = error instanceof NavigatorLockAcquireTimeoutError; }
      finally { release(); await first; }
      const reacquired = await navigatorLock(name, 1000, async () => true);
      let releaseProcess!: () => void, processReady!: () => void;
      const held = new Promise<void>(resolve => { processReady = resolve; });
      const processFirst = processLock(name, -1, async () => { processReady(); await new Promise<void>(resolve => { releaseProcess = resolve; }); });
      await held; let timedOut = false;
      try { await processLock(name, 10, async () => { throw new Error('Must not acquire held process lock'); }); }
      catch (error) { timedOut = !!error && typeof error === 'object' && 'isAcquireTimeout' in error && error.isAcquireTimeout === true; }
      finally { releaseProcess(); await processFirst; }
      const processReacquired = await processLock(name, -1, async () => true);
      let delegated = 0;
      const custom = createClient('https://memo-browser.invalid', 'sb_publishable_synthetic_only', {
        auth: { storageKey: 'memo-auth-lock-fixture', storage: { getItem: () => null, setItem() {}, removeItem() {} },
          persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, debug: false,
          lock: async (_name, _timeout, fn) => { delegated++; return fn(); } },
        global: { fetch: transport },
      });
      try { await custom.auth.initialize(); await custom.auth.getSession(); }
      finally { await custom.auth.dispose(); }
      return { unavailable, reacquired, timedOut, processReacquired, customDelegated: delegated > 0 };
    },
    expire() {
      const raw = window.localStorage.getItem(KEY); if (!raw) throw new Error('No synthetic session');
      const saved = JSON.parse(raw) as { expires_at: number }; saved.expires_at = Math.floor(Date.now() / 1000) - 10;
      window.localStorage.setItem(KEY, JSON.stringify(saved));
    },
    present: () => window.localStorage.getItem(KEY) !== null,
    audit: () => ({ ...window.__authStorageAudit!(), calls: { ...calls } }),
  };
}
try { window.__authBrowser = createHarness(); }
catch { document.getElementById('status')!.textContent = 'boundary-stopped'; }

import { createBrowserReadonlyTrial, type ReadonlyTrialObservation } from './readonly-trial';
import type { BrowserAuthEnvironment } from './browser-auth';
import type { PersistencePermit } from './browser-local-adapter';
import type { AuthContext } from './auth-session';
import type { CloudLoadControlResult } from './cloud-controller';
import { createMemoRpcSender } from './cloud-rpc-sender';

export interface ReadonlyTrialRunnerConfig {
  readonly expectedProjectRef: string;
  readonly projectRef: string;
  readonly expectedOrigin: string;
  readonly expectedAuthOrigin: string;
  readonly origin: string;
  readonly env: BrowserAuthEnvironment;
  readonly permit: PersistencePermit | undefined;
  readonly authConfig: { url: string; publicKey: string };
  readonly rpcConfig: { origin: string; publishableKey: string };
  readonly authTransport: typeof fetch;
  readonly rpcFetch: Parameters<typeof createMemoRpcSender>[1];
}

export type TrialRunnerState = 'idle' | 'authenticating' | 'authenticated' | 'completed' | 'stopped' | 'unknown' | 'disposed';
export interface ReadonlyTrialRunnerObservation {
  readonly state: TrialRunnerState;
  readonly authCalls: number;
  readonly rpcCalls: number;
  readonly rpcNames: readonly string[];
  readonly otherRpcCalls: number;
  readonly stopReason: string | null;
}

const allowedAuth = new Set(['/auth/v1/token', '/auth/v1/user', '/auth/v1/logout']);

export function createReadonlyTrialRunner(config: ReadonlyTrialRunnerConfig) {
  let app: ReturnType<typeof createBrowserReadonlyTrial> | undefined;
  let state: TrialRunnerState = 'idle';
  let stopReason: string | null = null;
  let authCalls = 0;
  let authTokenCalls = 0;
  let loadConsumed = false;
  const rpcNames: string[] = [];

  function stop(reason: string) { state = 'stopped'; stopReason = reason; }
  function authTransport(input: RequestInfo | URL, init?: RequestInit) {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (!allowedAuth.has(url.pathname) || url.origin !== config.authConfig.url) { stop('auth-boundary'); return Promise.reject(new Error('readonly-trial-auth-denied')); }
    authCalls++;
    if (url.pathname === '/auth/v1/token') {
      authTokenCalls++;
      if (authTokenCalls > 1) { stop('auth-refresh'); return Promise.reject(new Error('readonly-trial-refresh-denied')); }
    }
    return config.authTransport(request, { ...init, redirect: 'error' });
  }
  function rpcFetch(input: RequestInfo | URL, init?: RequestInit) {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== config.rpcConfig.origin || !url.pathname.endsWith('/memo_load_snapshot')) { stop('rpc-boundary'); return Promise.reject(new Error('readonly-trial-rpc-denied')); }
    rpcNames.push('memo_load_snapshot');
    return config.rpcFetch(request.url, { ...init, redirect: 'error' });
  }
  function preflight() {
    if (config.projectRef !== config.expectedProjectRef || config.authConfig.url !== config.expectedAuthOrigin
      || config.rpcConfig.origin !== config.expectedOrigin || config.origin !== config.expectedOrigin) { stop('project-ref-mismatch'); return false; }
    if (!config.env.secure || !config.env.topLevel) { stop('origin-mismatch'); return false; }
    return true;
  }
  return Object.freeze({
    async startAuth(): Promise<void> {
      if (state !== 'idle' || !preflight()) return;
      state = 'authenticating';
      app = createBrowserReadonlyTrial(config.env, config.permit, config.authConfig, authTransport, config.rpcConfig, rpcFetch);
      const result = await app.session.login('synthetic@example.invalid', 'synthetic-password');
      if ((state as TrialRunnerState) === 'disposed') { await app.dispose(); return; }
      if (result !== 'applied') stop(`auth-${result}`); else state = 'authenticated';
    },
    async load(): Promise<CloudLoadControlResult | null> {
      if (state === 'disposed') return null;
      if (state !== 'authenticated' || !app) { stop('not-authenticated'); return null; }
      if (loadConsumed) { stop('load-already-consumed'); return null; }
      loadConsumed = true;
      const context: AuthContext | null = app.session.getContext();
      if (!context) { stop('auth-unavailable'); return null; }
      const result = await app.trial.load(context);
      if (result.kind === 'stale-response') state = 'stopped';
      else if (result.kind === 'completed') state = 'completed';
      return result;
    },
    dispose(): Promise<void> {
      if (state === 'disposed') return Promise.resolve();
      state = 'disposed'; return app?.dispose() ?? Promise.resolve();
    },
    observation(): ReadonlyTrialRunnerObservation {
      const observation: ReadonlyTrialObservation | undefined = app?.trial.observation();
      return Object.freeze({ state, authCalls, rpcCalls: rpcNames.length, rpcNames: Object.freeze([...rpcNames]),
        otherRpcCalls: observation?.nonLoadRpcCalls ?? 0, stopReason });
    },
  });
}

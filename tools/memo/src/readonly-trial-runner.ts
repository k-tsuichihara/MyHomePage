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

export type TrialRunnerState = 'idle' | 'authenticating' | 'authenticated' | 'loading' | 'completed' | 'stopped' | 'unknown' | 'disposed';
export interface ReadonlyTrialRunnerObservation {
  readonly state: TrialRunnerState;
  readonly authCalls: number;
  readonly rpcCalls: number;
  readonly rpcNames: readonly string[];
  readonly otherRpcCalls: number;
  readonly stopReason: string | null;
  readonly diagnostic: ReadonlyTrialDiagnostic;
}
export type ReadonlyTrialDiagnostic = Readonly<{
  schema: 'memo-human-gate-diagnostic-v1'; stage: 'idle' | 'auth-start' | 'auth-transport' | 'auth-session' | 'terminal';
  failureClass: 'none' | 'provider-http-4xx' | 'provider-http-5xx' | 'network' | 'timeout' | 'route-block' | 'sdk-error' | 'storage' | 'invalid-response' | 'unknown';
  transportStarted: boolean; transportCompleted: boolean; sdkCallStarted: boolean; sdkCallCompleted: boolean;
  responseReceived: boolean; httpStatus: number | null; targetMatched: boolean; method: 'POST' | 'GET' | null;
  redirectPolicy: 'error'; retryCount: 0; credentialsReferenceCleared: boolean; secretsExposed: false;
}>;

const allowedAuth = new Set(['/auth/v1/token', '/auth/v1/user', '/auth/v1/logout']);

export function createReadonlyTrialRunner(config: ReadonlyTrialRunnerConfig) {
  let app: ReturnType<typeof createBrowserReadonlyTrial> | undefined;
  let state: TrialRunnerState = 'idle';
  let stopReason: string | null = null;
  let authCalls = 0;
  let authTokenCalls = 0;
  let loadConsumed = false;
  const rpcNames: string[] = [];
  let diagnostic: ReadonlyTrialDiagnostic = { schema: 'memo-human-gate-diagnostic-v1', stage: 'idle', failureClass: 'none',
    transportStarted: false, transportCompleted: false, sdkCallStarted: false, sdkCallCompleted: false,
    responseReceived: false, httpStatus: null, targetMatched: false, method: null, redirectPolicy: 'error', retryCount: 0,
    credentialsReferenceCleared: false, secretsExposed: false };
  const patchDiagnostic = (patch: Partial<ReadonlyTrialDiagnostic>) => { diagnostic = Object.freeze({ ...diagnostic, ...patch }); };
  const classifyError = (error: unknown) => error instanceof DOMException && error.name === 'AbortError' ? 'timeout' as const : 'network' as const;

  function stop(reason: string) { state = 'stopped'; stopReason = reason; }
  function authTransport(input: RequestInfo | URL, init?: RequestInit) {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (state === 'stopped' || state === 'unknown' || state === 'disposed' || state === 'completed') {
      return Promise.reject(new Error('readonly-trial-auth-stopped'));
    }
    if (!allowedAuth.has(url.pathname) || url.origin !== config.authConfig.url) { stop('auth-boundary'); patchDiagnostic({ stage: 'terminal', failureClass: 'route-block', targetMatched: false }); return Promise.reject(new Error('readonly-trial-auth-denied')); }
    authCalls++; patchDiagnostic({ stage: 'auth-transport', transportStarted: true, targetMatched: true, method: request.method as 'GET' | 'POST' });
    if (url.pathname === '/auth/v1/token') {
      authTokenCalls++;
      if (authTokenCalls > 1) { stop('auth-refresh'); return Promise.reject(new Error('readonly-trial-refresh-denied')); }
    }
    return config.authTransport(request, { ...init, redirect: 'error' }).then(response => {
      patchDiagnostic({ transportCompleted: true, responseReceived: true, httpStatus: response.status });
      if (response.status >= 400 && response.status < 500) patchDiagnostic({ failureClass: 'provider-http-4xx' });
      else if (response.status >= 500) patchDiagnostic({ failureClass: 'provider-http-5xx' });
      return response;
    }).catch(error => { patchDiagnostic({ failureClass: classifyError(error), transportCompleted: false }); throw error; });
  }
  function rpcFetch(input: RequestInfo | URL, init?: RequestInit) {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (state !== 'loading' || url.origin !== config.rpcConfig.origin || !url.pathname.endsWith('/memo_load_snapshot')) { stop('rpc-boundary'); return Promise.reject(new Error('readonly-trial-rpc-denied')); }
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
    async startAuth(credentials: { readonly email: string; readonly password: string } = { email: 'synthetic@example.invalid', password: 'synthetic-password' }): Promise<void> {
      if (state !== 'idle' || !preflight()) return;
      state = 'authenticating'; patchDiagnostic({ stage: 'auth-start', sdkCallStarted: true, failureClass: 'none', credentialsReferenceCleared: false });
      app = createBrowserReadonlyTrial(config.env, config.permit, config.authConfig, authTransport, config.rpcConfig, rpcFetch);
      const email = credentials.email, password = credentials.password;
      let result: Awaited<ReturnType<typeof app.session.login>>;
      try { result = await app.session.login(email, password); }
      finally { credentials = { email: '', password: '' }; patchDiagnostic({ credentialsReferenceCleared: true, sdkCallCompleted: true }); }
      if ((state as TrialRunnerState) !== 'authenticating') { await app.dispose(); return; }
      if (result !== 'applied') {
        const reason = app.session.getLastFailureReason();
        stop(`auth-${reason === 'none' ? result : reason}`);
        if (diagnostic.failureClass === 'none') patchDiagnostic({ stage: 'terminal', failureClass: reason === 'unavailable' ? 'sdk-error' : reason === 'invalid-session' ? 'invalid-response' : 'unknown' });
      } else { state = 'authenticated'; patchDiagnostic({ stage: 'auth-session' }); }
    },
    async load(): Promise<CloudLoadControlResult | null> {
      if (state === 'disposed') return null;
      if (state !== 'authenticated' || !app) { stop(state === 'loading' ? 'load-in-progress' : 'not-authenticated'); return null; }
      if (loadConsumed) { stop('load-already-consumed'); return null; }
      loadConsumed = true;
      state = 'loading';
      const context: AuthContext | null = app.session.getContext();
      if (!context) { stop('auth-unavailable'); return null; }
      const result = await app.trial.load(context);
      if (state !== 'loading') return result;
      if (result.kind === 'stale-response' || result.kind === 'stopped') state = 'stopped';
      else if (result.kind === 'completed') {
        const inner = (result.result as { readonly kind?: string }).kind;
        if (inner === 'unknown' || inner === 'failed') { state = 'unknown'; stopReason = `load-${inner}`; }
        else state = 'completed';
      }
      return result;
    },
    dispose(): Promise<void> {
      if (state === 'disposed') return Promise.resolve();
      state = 'disposed'; patchDiagnostic({ stage: 'terminal' }); return app?.dispose() ?? Promise.resolve();
    },
    observation(): ReadonlyTrialRunnerObservation {
      const observation: ReadonlyTrialObservation | undefined = app?.trial.observation();
      return Object.freeze({ state, authCalls, rpcCalls: rpcNames.length, rpcNames: Object.freeze([...rpcNames]),
        otherRpcCalls: observation?.nonLoadRpcCalls ?? 0, stopReason, diagnostic });
    },
  });
}

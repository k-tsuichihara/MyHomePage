import { createProductLocalApp } from '../src/product-local-app';
import { createMemoAuthSession, type MemoAuthApi, type MemoAuthState } from '../src/auth-session';
import { isDirty } from '../src/editor-state';
import { createPendingMigration } from '../src/migration';
import { createCloudController } from '../src/cloud-controller';
import { createStorageTargetController } from '../src/storage-target-controller';
import type { AuthenticatedRpcSender } from '../src/auth-session';

// 既存製品compositionへ合成session/Storageだけを注入。SDK/実fetchは使わない。
const mode = (window as unknown as { fixtureMode: string }).fixtureMode;
const id = '00000000-0000-4000-8000-000000000002';
let clock = 100_000;
const value = { user: { id }, access_token: 'synthetic-token-private', expires_at: 200 };
let current: unknown = mode === 'restore' || mode.startsWith('migration') || mode === 'restore-data' || (mode.startsWith('cloud') && mode !== 'cloud-signed-out') ? value : null;
let emit!: (event: string, session: unknown) => void;
const calls = { login: 0, logout: 0, restore: 0, unsubscribe: 0, listenerUnsubscribe: 0, dispose: 0, writes: 0, fetch: 0,
  readCompleted: 0, cloudDispose: 0 };
const rpcNames: string[] = [];
let releaseRead: (() => void) | undefined;
let releaseLogin: (() => void) | undefined, releaseWrite: (() => void) | undefined;
let holdWrite = false;
let failReads = false, failWrites = false;
const api: MemoAuthApi = {
  getSession: async () => { calls.restore++; return { data: { session: current }, error: null }; },
  getUser: async () => ({ data: { user: { id } }, error: null }),
  async signInWithPassword() {
    calls.login++;
    if (mode === 'pending') await new Promise<void>(resolve => { releaseLogin = resolve; });
    if (mode === 'throw') throw new Error('synthetic-email@example.invalid synthetic-password raw-provider-token');
    current = value; return { data: { session: current }, error: null };
  },
  async signOut(options) { if (options.scope !== 'local') throw new Error(); calls.logout++;
    if (mode === 'logout-throw') throw new Error('private-logout-error');
    current = null; return { error: null }; },
  onAuthStateChange(callback) { emit = callback; return { data: { subscription: { unsubscribe: () => { calls.unsubscribe++; } } } }; },
};
const sender: AuthenticatedRpcSender = async (_bearer, rpc) => {
  rpcNames.push(rpc);
  if (rpc !== 'memo_load_snapshot') throw new Error('write-not-allowed');
  if (mode === 'cloud-pending') await new Promise<void>(resolve => { releaseRead = resolve; });
  if (mode === 'cloud-failure') throw new Error('synthetic-email@example.invalid synthetic-password raw-provider-token');
  return { provenance: mode === 'cloud-unverified' ? 'unverified' : 'single-rpc', status: 200,
    body: mode === 'cloud-permission' ? null : { memos: [], tags: [], memoTags: [] } };
};
const session = createMemoAuthSession(api, () => clock, sender);
const targets = createStorageTargetController();
const cloudController = createCloudController(session);
const cloudPort = {
  async load(context: Parameters<typeof cloudController.load>[0]) {
    try { return await cloudController.load(context); } finally { calls.readCompleted++; }
  },
  dispose() { calls.cloudDispose++; return cloudController.dispose(); },
};
let notify: ((state: MemoAuthState) => void) | undefined;
const injected = { ...session,
  subscribe(listener: (state: MemoAuthState) => void) {
    if (mode === 'subscription-throw') throw new Error('private-subscription-error');
    notify = listener; const unsubscribe = session.subscribe(listener);
    return () => { calls.listenerUnsubscribe++; unsubscribe(); };
  },
  dispose() { calls.dispose++; session.dispose(); },
};
const values = new Map<string, string>();
if (mode.startsWith('migration')) values.set('myhomepage.memo.items.v1', '[]');
if (mode === 'migration-recover') values.set('myhomepage.memo.data.v2', JSON.stringify(createPendingMigration('[]', () => crypto.randomUUID())));
if (mode === 'restore-data') values.set('myhomepage.memo.data.v2', JSON.stringify({ version: 3,
  migration: { status: 'not-required' }, memos: [], tags: [], memoTags: [], deletedMemoIds: [] }));
const app = createProductLocalApp(document, {
  storage: { getItem: key => { if (failReads) throw new Error('fake-read-error'); return values.get(key) ?? null; },
    setItem: (key, data) => { calls.writes++; values.set(key, data); if (failWrites) throw new Error('fake-write-error'); } },
  locks: { async request(_name, _options, callback) {
    if (holdWrite) await new Promise<void>(resolve => { releaseWrite = resolve; });
    return callback();
  } },
  createId: () => crypto.randomUUID(), now: () => '2026-11-14T00:00:00.000Z',
}, undefined, mode === 'absent' || mode === 'cloud-no-session' ? undefined : injected,
  mode.startsWith('cloud') && mode !== 'cloud-no-host' ? { target: targets, controller: cloudPort } : undefined);
Object.assign(window, { fixture: {
  calls, state: () => app.controller.getState(), auth: () => session.getState(),
  rpcNames, target: targets.current, releaseRead: () => releaseRead?.(),
  refreshAuth: () => { value.expires_at++; emit('TOKEN_REFRESHED', value); },
  migration: () => app.migration.getState(),
  saveTag: () => app.controller.dispatch({ kind: 'mutate', operation: {
    kind: 'save-tag', id: '00000000-0000-4000-8000-000000000020', name: '合成タグ', expectedRevision: null } }),
  reload: () => app.controller.dispatch({ kind: 'load' }),
  expired: () => { clock = 200_000; session.getState(); },
  stale: () => notify?.({ phase: 'signed-out', generation: 0, userId: null, reauthenticateUserId: null, expiresAt: null, reason: 'none' }),
  emit: () => emit('SIGNED_IN', current),
  releaseLogin: () => releaseLogin?.(), holdWrite: () => { holdWrite = true; },
  releaseWrite: () => { holdWrite = false; releaseWrite?.(); },
  dispose: app.dispose,
  stored: () => [...values.entries()],
  dirty: () => { const editor = app.controller.getState().editor; return editor ? isDirty(editor) : false; },
  failReads: (value: boolean) => { failReads = value; }, failWrites: () => { failWrites = true; },
} });
window.fetch = () => { calls.fetch++; throw new Error('offline-only'); };

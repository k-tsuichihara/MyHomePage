import { createProductLocalApp } from '../src/product-local-app';
import { createMemoAuthSession, type MemoAuthApi, type MemoAuthState } from '../src/auth-session';
import { isDirty } from '../src/editor-state';
import { createPendingMigration } from '../src/migration';
import { createCloudController, type CloudUncertainOperationResult, type CloudStateResult, type CloudDeleteResult, type CloudEmptyTrashResult, type CloudSaveTagResult, type CloudDeleteTagResult } from '../src/cloud-controller';
import { createStorageTargetController } from '../src/storage-target-controller';
import type { AuthenticatedRpcSender } from '../src/auth-session';
import type { VoiceRecognition } from '../src/voice-input';

// 既存製品compositionへ合成session/Storageだけを注入。SDK/実fetchは使わない。
const mode = (window as unknown as { fixtureMode: string }).fixtureMode;
const operationMode = mode.replace(/^cloud-create/, 'cloud-edit');
const id = mode === 'cloud-casing' ? '00000000-0000-4000-8000-00000000abcd' : '00000000-0000-4000-8000-000000000002';
let clock = 100_000;
const value = { user: { id }, access_token: 'synthetic-token-private', expires_at: 200 };
let current: unknown = mode === 'restore' || mode.startsWith('migration') || mode === 'restore-data' || (mode.startsWith('cloud') && !mode.endsWith('-signed-out')) ? value : null;
let emit!: (event: string, session: unknown) => void;
const calls = { login: 0, logout: 0, restore: 0, unsubscribe: 0, listenerUnsubscribe: 0, dispose: 0, writes: 0, fetch: 0,
  readCompleted: 0, saveCompleted: 0, resolveCompleted: 0, stateCompleted: 0, cloudDispose: 0 };
const rpcNames: string[] = [];
const generatedIds: string[] = [];
const voiceCalls = { start: 0, abort: 0 };
let latestVoice: VoiceRecognition | undefined;
let lateVoiceResult: VoiceRecognition['onresult'];
if (mode === 'cloud-voice') Object.defineProperty(window, 'SpeechRecognition', { value: class implements VoiceRecognition {
  lang = ''; continuous = false; interimResults = false;
  onresult: VoiceRecognition['onresult'] = null; onerror = null; onend = null;
  start() { voiceCalls.start++; latestVoice = this; lateVoiceResult = this.onresult; }
  abort() { voiceCalls.abort++; }
} });
let releaseRead: (() => void) | undefined;
let releaseSave: (() => void) | undefined;
let releaseResolve: (() => void) | undefined;
let releaseState: (() => void) | undefined;
let savedArgs: Parameters<AuthenticatedRpcSender>[2] | null = null;
let stateArgs: Parameters<AuthenticatedRpcSender>[2] | null = null;
let stateResult: CloudUncertainOperationResult<CloudStateResult | CloudDeleteResult | CloudEmptyTrashResult | CloudSaveTagResult | CloudDeleteTagResult> | null = null;
let releaseLogin: (() => void) | undefined, releaseWrite: (() => void) | undefined;
let holdWrite = false;
let failReads = false, failWrites = false;
let snapshotMode: 'success' | 'failure' | 'unverified' | 'permission' | 'invalid' = 'success';
let changedTrashSet = false;
let changedPin: false | 'state' | 'revision' = false;
let changedTag: false | 'both' | 'name' | 'revision' = false;
const snapshot = () => {
  const memoId = '00000000-0000-4000-8000-000000000101', tagId = '00000000-0000-4000-8000-000000000103';
  const memo = { id: memoId, user_id: value.user.id, title: 'クラウドの合成メモ', body: '<b>読取専用の本文</b>',
    created_at: '2026-11-14T00:00:00Z', updated_at: '2026-11-14T00:00:00Z',
    pinned_at: (changedPin === 'state' ? !mode.startsWith('cloud-unpin') : mode.startsWith('cloud-unpin')) ? '2026-11-14T00:00:00Z' : null,
    deleted_at: null, revision: changedPin === 'revision' ? 2 : 1, last_request_id: null };
  const result = { memos: [memo, { ...memo, id: '00000000-0000-4000-8000-000000000102', title: 'ゴミ箱の合成メモ', deleted_at: '2026-11-14T00:00:00Z' }],
    tags: [{ id: tagId, user_id: value.user.id, name: '既存クラウドタグ', created_at: '2026-11-14T00:00:00Z', revision: 1 }],
    memoTags: [{ memo_id: memoId, tag_id: tagId, user_id: value.user.id }] };
  if (mode.startsWith('cloud-empty')) {
    if (mode === 'cloud-empty-zero' || changedTrashSet) result.memos = [memo];
    else result.memos.push({ ...memo, id: '00000000-0000-4000-8000-000000000104', title: 'second trash', deleted_at: '2026-11-14T00:00:00Z', revision: 3 });
  }
  if (changedTag) result.tags[0] = { ...result.tags[0]!, name: changedTag === 'revision' ? result.tags[0]!.name : 'changed tag', revision: changedTag === 'name' ? result.tags[0]!.revision : 2 };
  return result;
};
const api: MemoAuthApi = {
  getSession: async () => { calls.restore++; return { data: { session: current }, error: null }; },
  getUser: async () => ({ data: { user: { id: value.user.id } }, error: null }),
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
const stateMode = mode.replace('cloud-restore', 'cloud-trash').replace('cloud-delete', 'cloud-trash').replace('cloud-empty', 'cloud-trash').replace('cloud-tag', 'cloud-trash').replace('cloud-unpin', 'cloud-trash').replace('cloud-pin', 'cloud-trash');
const sender: AuthenticatedRpcSender = async (_bearer, rpc, args) => {
  rpcNames.push(rpc);
  if (mode.startsWith('cloud-tag-delete') && rpc === 'memo_delete_tag') {
    stateArgs = args;
    if (mode === 'cloud-tag-delete-pending') await new Promise<void>(resolve => { releaseState = resolve; });
    if (mode === 'cloud-tag-delete-unknown') throw new Error('synthetic-password raw-provider-token');
    if (mode === 'cloud-tag-delete-conflict') return { provenance: 'single-rpc', status: 409, body: { code: 'PT409', message: 'tag revision conflict' } };
    if (mode === 'cloud-tag-delete-rejected') return { provenance: 'single-rpc', status: 403, body: { code: '42501', message: 'raw-provider-token' } };
    return { provenance: mode === 'cloud-tag-delete-unverified' ? 'unverified' : 'single-rpc', status: 204,
      body: mode === 'cloud-tag-delete-invalid' ? { message: 'raw-provider-token' } : null };
  }
  if (mode.startsWith('cloud-tag') && rpc === 'memo_save_tag') {
    stateArgs = args;
    if (mode === 'cloud-tag-pending') await new Promise<void>(resolve => { releaseState = resolve; });
    if (mode === 'cloud-tag-unknown') throw new Error('synthetic-password raw-provider-token');
    if (mode === 'cloud-tag-duplicate') return { provenance: 'single-rpc', status: 409, body: { code: '23505', message: 'raw-provider-token' } };
    if (mode === 'cloud-tag-conflict') return { provenance: 'single-rpc', status: 409, body: { code: 'PT409', message: 'tag revision conflict' } };
    if (mode === 'cloud-tag-rejected') return { provenance: 'single-rpc', status: 403, body: { code: '42501', message: 'raw-provider-token' } };
    return { provenance: mode === 'cloud-tag-unverified' ? 'unverified' : 'single-rpc', status: 200,
      body: { id: mode === 'cloud-tag-invalid-id' ? '00000000-0000-4000-8000-000000000999' : args.p_id, user_id: value.user.id,
        name: mode === 'cloud-tag-invalid-name' ? 'raw-provider-token' : args.p_name,
        revision: mode === 'cloud-tag-invalid-revision' ? 99 : args.p_expected_revision === null ? 1 : Number(args.p_expected_revision) + 1,
        created_at: '2026-11-14T00:00:00Z' } };
  }
  if (mode.startsWith('cloud-empty') && rpc === 'memo_empty_trash') {
    stateArgs = args;
    if (mode === 'cloud-empty-pending') await new Promise<void>(resolve => { releaseState = resolve; });
    if (mode === 'cloud-empty-unknown') throw new Error('synthetic-password raw-provider-token');
    if (mode === 'cloud-empty-conflict' || mode === 'cloud-empty-revision') return { provenance: 'single-rpc', status: 409,
      body: { code: 'PT409', message: mode === 'cloud-empty-conflict' ? 'trash snapshot conflict' : 'trash revision conflict' } };
    if (mode === 'cloud-empty-rejected') return { provenance: 'single-rpc', status: 403, body: { code: '42501', message: 'raw-provider-token' } };
    return { provenance: mode === 'cloud-empty-unverified' ? 'unverified' : 'single-rpc', status: 200,
      body: mode === 'cloud-empty-count' ? 1 : mode === 'cloud-empty-invalid' ? 'raw-provider-token' : (args.p_ids as readonly string[]).length };
  }
  if (mode.startsWith('cloud-delete') && rpc === 'memo_delete_permanently') {
    stateArgs = args;
    if (mode === 'cloud-delete-pending') await new Promise<void>(resolve => { releaseState = resolve; });
    if (mode === 'cloud-delete-unknown') throw new Error('synthetic-password raw-provider-token');
    if (mode === 'cloud-delete-conflict') return { provenance: 'single-rpc', status: 409, body: { code: 'PT409', message: 'not found or revision conflict' } };
    if (mode === 'cloud-delete-rejected') return { provenance: 'single-rpc', status: 403, body: { code: '42501', message: 'raw-provider-token' } };
    if (mode === 'cloud-delete-not-found') return { provenance: 'single-rpc', status: 404, body: { code: 'P0002', message: 'raw-provider-token' } };
    return { provenance: mode === 'cloud-delete-unverified' ? 'unverified' : 'single-rpc', status: 204,
      body: mode === 'cloud-delete-invalid' ? { message: 'raw-provider-token' } : null };
  }
  if (stateMode.startsWith('cloud-trash') && rpc === 'memo_change_state') {
    stateArgs = args;
    if (args.p_action !== (mode.startsWith('cloud-pin') ? 'pin' : mode.startsWith('cloud-unpin') ? 'unpin' : mode.startsWith('cloud-restore') ? 'restore' : 'trash')) throw new Error('unexpected-state-action');
    if (stateMode === 'cloud-trash-pending') await new Promise<void>(resolve => { releaseState = resolve; });
    if (stateMode === 'cloud-trash-unknown') throw new Error('synthetic-password raw-provider-token');
    if (stateMode === 'cloud-trash-conflict') return { provenance: 'single-rpc', status: 409, body: { code: 'PT409', message: 'revision conflict' } };
    if (stateMode === 'cloud-trash-rejected') return { provenance: 'single-rpc', status: 403, body: { code: '42501', message: 'raw-provider-token' } };
    if (stateMode === 'cloud-trash-deleted') return { provenance: 'single-rpc', status: 500, body: { code: 'P0002', message: 'previously applied, memo deleted' } };
    return { provenance: stateMode === 'cloud-trash-unverified' ? 'unverified' : 'single-rpc', status: 200,
      body: stateMode === 'cloud-trash-invalid' ? { message: 'synthetic-password raw-provider-token' }
        : { ...snapshot().memos[mode.startsWith('cloud-restore') ? 1 : 0]!, id: args.p_id, deleted_at: args.p_action === 'trash' ? '2026-11-14T00:00:00Z' : null,
          pinned_at: args.p_action === 'pin' ? (mode.endsWith('invalid-pin') ? null : '2026-11-14T00:00:00Z') : args.p_action === 'unpin' ? (mode.endsWith('invalid-pin') ? '2026-11-14T00:00:00Z' : null) : snapshot().memos[0]!.pinned_at,
          revision: Number(args.p_expected_revision) + 1, last_request_id: args.p_request_id } };
  }
  if (operationMode.startsWith('cloud-edit') && (rpc === 'memo_save' || rpc === 'memo_resolve_request')) {
    const saved = () => ({ memo: { ...snapshot().memos[0]!, id: args.p_id, title: args.p_title, body: args.p_body,
      revision: args.p_expected_revision === null ? 1 : Number(args.p_expected_revision) + 1, last_request_id: args.p_request_id }, tagIds: args.p_tag_ids });
    if (rpc === 'memo_save') {
      savedArgs = args;
      if (operationMode.startsWith('cloud-edit-pending')) await new Promise<void>(resolve => { releaseSave = resolve; });
      if (operationMode === 'cloud-edit-conflict' || operationMode === 'cloud-edit-pending-conflict') return { provenance: 'single-rpc', status: 409, body: { code: 'PT409', message: args.p_expected_revision === null ? 'previously used memo id' : 'memo revision conflict' } };
      if (operationMode === 'cloud-edit-rejected') return { provenance: 'single-rpc', status: 403, body: { code: '42501', message: 'raw-provider-token' } };
      if (operationMode === 'cloud-edit-unknown' || operationMode === 'cloud-edit-no-record' || operationMode === 'cloud-edit-deleted' || operationMode.startsWith('cloud-edit-resolve-pending')) throw new Error('synthetic-password raw-provider-token');
      return { provenance: 'single-rpc', status: 200, body: saved() };
    }
    if (JSON.stringify(args) !== JSON.stringify(savedArgs)) throw new Error('mismatched-original-request');
    if (operationMode.startsWith('cloud-edit-resolve-pending')) await new Promise<void>(resolve => { releaseResolve = resolve; });
    return { provenance: 'single-rpc', status: 200, body: operationMode === 'cloud-edit-no-record' ? null
      : operationMode === 'cloud-edit-deleted' || operationMode === 'cloud-edit-resolve-pending-deleted' ? { status: 'previously-applied-deleted' } : { status: 'saved', result: saved() } };
  }
  if (rpc !== 'memo_load_snapshot') throw new Error('write-not-allowed');
  if (mode === 'cloud-pending' || mode === 'cloud-snapshot-pending') await new Promise<void>(resolve => { releaseRead = resolve; });
  if (mode === 'cloud-failure' || snapshotMode === 'failure') throw new Error('synthetic-email@example.invalid synthetic-password raw-provider-token');
  return { provenance: mode === 'cloud-unverified' || snapshotMode === 'unverified' ? 'unverified' : 'single-rpc', status: 200,
    body: mode === 'cloud-permission' || snapshotMode === 'permission' ? null
      : snapshotMode === 'invalid' ? { message: 'raw-provider-token', user_id: id }
      : mode.startsWith('cloud-snapshot') || stateMode.startsWith('cloud-trash') || operationMode.startsWith('cloud-edit') ? snapshot() : { memos: [], tags: [], memoTags: [] } };
};
const session = createMemoAuthSession(api, () => clock, sender);
const targets = createStorageTargetController();
const cloudController = createCloudController(session);
const cloudPort = {
  async load(context: Parameters<typeof cloudController.load>[0]) {
    try { return await cloudController.load(context); } finally { calls.readCompleted++; }
  },
  dispose() { calls.cloudDispose++; return cloudController.dispose(); },
  ...(operationMode.startsWith('cloud-edit') || (stateMode.startsWith('cloud-trash') && stateMode !== 'cloud-trash-no-writer') ? { async save(...args: Parameters<typeof cloudController.save>) {
    try { return await cloudController.save(...args); } finally { calls.saveCompleted++; }
  }, async resolve(...args: Parameters<typeof cloudController.resolve>) {
    try { return await cloudController.resolve(...args); } finally { calls.resolveCompleted++; }
  } } : {}),
  ...(mode.startsWith('cloud-tag-delete') ? { async deleteTag(...args: Parameters<typeof cloudController.deleteTag>) {
    try { const result = await cloudController.deleteTag(...args); stateResult = result; return result; } finally { calls.stateCompleted++; }
  } } : {}),
  ...(mode.startsWith('cloud-tag') || mode.startsWith('cloud-pin') || mode.startsWith('cloud-unpin') ? { async saveTag(...args: Parameters<typeof cloudController.saveTag>) {
    try { const result = await cloudController.saveTag(...args); stateResult = result; return result; } finally { calls.stateCompleted++; }
  } } : {}),
  ...(mode.startsWith('cloud-empty') ? { async emptyTrash(...args: Parameters<typeof cloudController.emptyTrash>) {
    try { const result = await cloudController.emptyTrash(...args); stateResult = result; return result; } finally { calls.stateCompleted++; }
  } } : {}),
  ...(mode.startsWith('cloud-delete') ? { async deletePermanently(...args: Parameters<typeof cloudController.deletePermanently>) {
    try { const result = await cloudController.deletePermanently(...args); stateResult = result; return result; } finally { calls.stateCompleted++; }
  } } : {}),
  ...(stateMode.startsWith('cloud-trash') ? { async changeState(...args: Parameters<typeof cloudController.changeState>) {
    try { const result = await cloudController.changeState(...args); stateResult = result; return result; } finally { calls.stateCompleted++; }
  } } : {}),
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
  createId: () => { const id = crypto.randomUUID(); generatedIds.push(id); return id; }, now: () => '2026-11-14T00:00:00.000Z',
}, undefined, mode === 'absent' || mode === 'cloud-no-session' ? undefined : injected,
  mode.startsWith('cloud') && mode !== 'cloud-no-host' ? { target: targets, controller: cloudPort } : undefined);
Object.assign(window, { fixture: {
  calls, state: () => app.controller.getState(), auth: () => session.getState(),
  rpcNames, target: targets.current, releaseRead: () => releaseRead?.(),
  generatedIds, changePin: (kind: 'state' | 'revision') => { changedPin = kind; }, changeTag: (kind: 'both' | 'name' | 'revision' = 'both') => { changedTag = kind; }, changeTrashSet: () => { changedTrashSet = true; },
  stateArgs: () => stateArgs, stateResult: () => stateResult, releaseState: () => releaseState?.(),
  invalidateSnapshot: () => targets.setDirty(false),
  differentUser: () => { value.user.id = '00000000-0000-4000-8000-000000000999'; },
  externalLogout: () => session.logout(),
  savedArgs: () => savedArgs, releaseSave: () => releaseSave?.(),
  releaseResolve: () => releaseResolve?.(),
  forceLocal: () => { const result = targets.request('local', null, { kind: 'allowed' });
    return result.kind === 'confirmation-required' ? targets.confirm(result, true, null, { kind: 'allowed' }) : result; },
  snapshotMode: (next: typeof snapshotMode) => { snapshotMode = next; },
  expireSilently: () => { clock = 200_000; },
  voiceCalls,
  lateVoice: () => lateVoiceResult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: '停止後の旧結果' } }] }),
  voiceDetached: () => latestVoice?.onresult === null,
  uppercaseAuth: () => { value.user.id = value.user.id.toUpperCase(); value.expires_at++; emit('TOKEN_REFRESHED', value); },
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

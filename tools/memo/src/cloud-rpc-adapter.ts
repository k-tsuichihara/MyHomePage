import { array, record, reject, revision, uuid, uuidKey } from './read-primitives';
import { persistedMemo, persistedTag } from './legacy-validation';
import { CloudOwnerMismatch, cloudMemo, cloudSnapshot, cloudTag, freeze, sameIds, tagIds } from './cloud-rpc-validation';
import type { CloudCall, CloudMutation, CloudResolution, CloudResult, CloudSaveInput, CloudSaved, CloudSaveOutcome,
  CloudStateOutcome, CloudTarget, CloudTransport, ConflictReason, RpcArgument, RpcName } from './cloud-rpc-types';

const conflicts: Partial<Record<RpcName, Readonly<Record<string, ConflictReason>>>> = {
  memo_save: { 'previously used memo id': 'used-memo-id', 'memo revision conflict': 'memo-revision' },
  memo_change_state: { 'revision conflict': 'state-revision' },
  memo_delete_permanently: { 'not found or revision conflict': 'delete-not-found-or-revision' },
  memo_empty_trash: { 'trash snapshot conflict': 'trash-snapshot', 'trash revision conflict': 'trash-revision' },
  memo_save_tag: { 'tag revision conflict': 'tag-revision' }, memo_delete_tag: { 'tag revision conflict': 'tag-revision' },
};
const expected = (raw: unknown): number => revision(raw) as number;
const optionalRevision = (raw: unknown) => raw === null ? null : expected(raw);
const equalId = (a: string, b: string) => uuidKey(a) === uuidKey(b);
function receipt(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object' || !Object.hasOwn(raw, 'status')) return false;
  const descriptor = Object.getOwnPropertyDescriptor(raw, 'status');
  if (!descriptor || !('value' in descriptor)) return reject('structure');
  if (descriptor.value !== 'previously-applied-deleted') return false;
  return record(raw, ['status']).status === 'previously-applied-deleted';
}

/**
 * 期待所有者と注入通信先だけを固定する。UI状態・認証セッション・ローカル保存先は扱わない。
 * 返却callはメモリ専用。本文を含むためログや永続記録へ転記しない。
 */
export function createCloudRpcAdapter(ownerId: string, transport: CloudTransport) {
  const owner = uuid(ownerId);
  async function invoke<T>(rpc: RpcName, write: boolean, prepare: () => { args: Record<string, RpcArgument>; requestId: string | null },
    decode: (raw: unknown, call: CloudCall) => T, voidResponse = false, deletedState?: () => T): Promise<CloudResult<T>> {
    let call: CloudCall;
    try { call = freeze({ ownerId: owner, rpc, ...prepare() }); }
    catch { return { kind: 'not-attempted', reason: 'invalid-input' }; }
    const failure = (reason: 'communication' | 'invalid-response' | 'owner-mismatch' | 'unclassified-http' | 'unverified-response'): CloudResult<T> =>
      freeze({ kind: write ? 'unknown' : 'failed', reason, call });
    let response: Awaited<ReturnType<CloudTransport>>;
    try { response = await transport(rpc, call.args); }
    catch { return failure('communication'); }
    try {
      const { provenance, status, body } = record(response, ['provenance', 'status', 'body']);
      // HTTP/codeの見た目だけでDBの拒否や成功を認定しない。信頼できない成功応答も同じ扱い。
      if (provenance !== 'single-rpc') return failure('unverified-response');
      if (status !== (voidResponse ? 204 : 200)) {
        // PostgreSQLエラーの任意message/details/hintは返さない。操作・HTTP・codeの組だけで分類する。
        if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status > 599) return failure('invalid-response');
        if (body === null || typeof body !== 'object') return failure('unclassified-http');
        const fields = Object.getOwnPropertyDescriptors(body);
        const code = fields.code && 'value' in fields.code ? fields.code.value as unknown : null;
        const message = fields.message && 'value' in fields.message ? fields.message.value as unknown : null;
        if (status === 409 && code === 'PT409' && typeof message === 'string') {
          const known = conflicts[rpc];
          if (known && Object.hasOwn(known, message)) return freeze({ kind: 'rejected', reason: 'conflict', conflict: known[message]!, call });
        }
        if ((status === 401 || status === 403) && code === '42501') return freeze({ kind: 'rejected', reason: 'permission', call });
        if (status === 400 && code === '22023') return freeze({ kind: 'rejected', reason: 'invalid-argument', call });
        if ((status === 409 && (code === '23505' || code === '23503')) || (status === 400 && (code === '23514' || code === '23502')))
          return freeze({ kind: 'rejected', reason: 'constraint', call });
        // PostgREST 14はP0*を500へ写像する。404や汎用500だけを根拠にしない。
        if (status === 500 && code === 'P0002') {
          if (rpc === 'memo_change_state' && message === 'previously applied, memo deleted' && deletedState)
            return freeze({ kind: 'ok', value: deletedState(), call });
          if ((rpc === 'memo_save' || rpc === 'memo_change_state') && message === 'memo not found')
            return freeze({ kind: 'rejected', reason: 'not-found', call });
        }
        return failure('unclassified-http');
      }
      if (voidResponse && body !== null && body !== undefined) return failure('invalid-response');
      if (rpc === 'memo_load_snapshot' && body === null) return freeze({ kind: 'rejected', reason: 'permission', call });
      return freeze({ kind: 'ok', value: decode(body, call), call });
    } catch (error) { return failure(error instanceof CloudOwnerMismatch ? 'owner-mismatch' : 'invalid-response'); }
  }
  function saveArgs(input: CloudSaveInput) {
    const row = record(input, ['memoId', 'title', 'body', 'tagIds', 'expectedRevision', 'requestId']);
    const tags = tagIds(row.tagIds).sort((a, b) => uuidKey(a) < uuidKey(b) ? -1 : uuidKey(a) > uuidKey(b) ? 1 : 0);
    const requestId = uuid(row.requestId);
    return { requestId, args: { p_id: uuid(row.memoId), p_request_id: requestId,
      p_title: persistedMemo(row.title, row.body).title, p_body: row.body as string,
      p_tag_ids: tags, p_expected_revision: optionalRevision(row.expectedRevision) } };
  }
  function saved(raw: unknown, call: CloudCall): CloudSaved {
    const root = record(raw, ['memo', 'tagIds']), memo = cloudMemo(root.memo, owner), ids = tagIds(root.tagIds);
    const args = call.args;
    if (!equalId(memo.id, args.p_id as string) || !memo.lastRequestId || !equalId(memo.lastRequestId, call.requestId!)
      || memo.title !== args.p_title || memo.body !== args.p_body || !sameIds(ids, args.p_tag_ids as readonly string[])
      || memo.revision !== (args.p_expected_revision === null ? 1 : (args.p_expected_revision as number) + 1) || memo.deletedAt !== null) reject('integrity');
    return { memo, tagIds: ids };
  }
  function saveOutcome(raw: unknown, call: CloudCall): CloudSaveOutcome {
    return receipt(raw) ? { kind: 'previously-applied-deleted' }
      : { kind: 'saved', value: saved(raw, call), currentMayDiffer: true };
  }
  function mutationArgs(id: string, context: CloudMutation) {
    const row = record(context, ['expectedRevision', 'requestId']);
    return { requestId: uuid(row.requestId), args: { p_id: uuid(id), p_expected_revision: expected(row.expectedRevision) } };
  }
  return Object.freeze({
    load: () => invoke('memo_load_snapshot', false, () => ({ args: {}, requestId: null }), raw => cloudSnapshot(raw, owner)),
    save: (input: CloudSaveInput) => invoke('memo_save', true, () => saveArgs(input), saveOutcome),
    resolve: (input: CloudSaveInput) => invoke<CloudResolution>('memo_resolve_request', false, () => saveArgs(input), (raw, call) => {
      if (raw === null) return { kind: 'no-record' };
      if (receipt(raw)) return { kind: 'previously-applied-deleted' };
      const row = record(raw, ['status', 'result']); if (row.status !== 'saved') return reject('structure');
      return { kind: 'saved', value: saved(row.result, call), currentMayDiffer: true };
    }),
    changeState: (id: string, action: 'pin' | 'unpin' | 'trash' | 'restore', context: CloudMutation) => invoke<CloudStateOutcome>('memo_change_state', true, () => {
      if (!['pin', 'unpin', 'trash', 'restore'].includes(action)) reject('structure');
      const value = mutationArgs(id, context); return { ...value, args: { ...value.args, p_request_id: value.requestId, p_action: action } };
    }, (raw, call) => {
      const memo = cloudMemo(raw, owner);
      if (!equalId(memo.id, call.args.p_id as string) || memo.revision !== (call.args.p_expected_revision as number) + 1
        || !memo.lastRequestId || !equalId(memo.lastRequestId, call.requestId!)
        || (action === 'pin' && memo.pinnedAt === null) || (action === 'unpin' && memo.pinnedAt !== null)
        || (action === 'trash' ? memo.deletedAt === null : memo.deletedAt !== null)) reject('integrity');
      // 状態RPCも過去要求の行を返し得る。現存・最新状態の証明には使わない。
      return { kind: 'changed', memo, currentMayDiffer: true };
    }, false, () => ({ kind: 'previously-applied-deleted' })),
    deletePermanently: (id: string, context: CloudMutation) => invoke('memo_delete_permanently', true, () => mutationArgs(id, context), () => undefined, true),
    emptyTrash: (targets: readonly CloudTarget[], requestId: string) => invoke('memo_empty_trash', true, () => {
      const rows = array(targets).map(raw => { const row = record(raw, ['id', 'revision']); return { id: uuid(row.id), revision: expected(row.revision) }; });
      const ids = rows.map(row => row.id); tagIds(ids);
      return { requestId: uuid(requestId), args: { p_ids: ids, p_revisions: rows.map(row => row.revision) } };
    }, (raw, call) => {
      if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0 || raw !== (call.args.p_ids as readonly string[]).length) return reject('integrity');
      return raw;
    }),
    saveTag: (id: string, name: string, expectedRevision: number | null) => invoke('memo_save_tag', true, () => ({ requestId: null,
      args: { p_id: uuid(id), p_name: persistedTag(name), p_expected_revision: optionalRevision(expectedRevision) } }), (raw, call) => {
      const tag = cloudTag(raw, owner);
      if (!equalId(tag.id, call.args.p_id as string) || tag.name !== call.args.p_name
        || tag.revision !== (call.args.p_expected_revision === null ? 1 : (call.args.p_expected_revision as number) + 1)) reject('integrity');
      return tag;
    }),
    deleteTag: (id: string, expectedRevision: number) => invoke('memo_delete_tag', true, () => ({ requestId: null,
      args: { p_id: uuid(id), p_expected_revision: expected(expectedRevision) } }), () => undefined, true),
  });
}

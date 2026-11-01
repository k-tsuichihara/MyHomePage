import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createCloudRpcAdapter } from '../src/cloud-rpc-adapter';
import type { CloudCall, CloudResult, CloudSaveInput, CloudTransport, CloudTransportResponse, RpcName } from '../src/cloud-rpc-types';
import { token } from './local-save-fixtures';

const OWNER = token(100), OTHER = token(101), ID = token(1), TAG = token(2), TAG2 = token(3), REQUEST = token(4);
const DATE = '2024-02-29T23:59:59.123456+09:00';
const request = (): CloudSaveInput => ({ memoId: ID, title: '合成メモ', body: ' 本文\n', tagIds: [TAG], expectedRevision: null, requestId: REQUEST });
const context = () => ({ expectedRevision: 1, requestId: REQUEST });
const memo = () => ({ id: ID, user_id: OWNER, title: '合成メモ', body: ' 本文\n', created_at: DATE, updated_at: DATE,
  pinned_at: null as string | null, deleted_at: null as string | null, revision: '1' as number | string, last_request_id: REQUEST as string | null });
const tag = () => ({ id: TAG, user_id: OWNER, name: 'Tag', created_at: DATE, revision: '1' as number | string });
const saved = () => ({ memo: memo(), tagIds: [TAG] });
const snapshot = () => ({ memos: [memo()], tags: [tag()], memoTags: [{ user_id: OWNER, memo_id: ID, tag_id: TAG }] });
function fixture(body: unknown, status = 200) {
  const transport = vi.fn<CloudTransport>(async () => ({ provenance: 'single-rpc', status, body }));
  return { transport, adapter: createCloudRpcAdapter(OWNER, transport) };
}
function ok<T>(result: CloudResult<T>): T { expect(result.kind).toBe('ok'); if (result.kind !== 'ok') throw Error('Expected ok'); return result.value; }
function call(result: CloudResult<unknown>): CloudCall { if (result.kind === 'not-attempted') throw Error('Expected call'); return result.call; }
const error = (code: string, message = '合成エラー') => ({ code, message, details: '本文を含めない', hint: null });

describe('正式RPCの引数・型変換', () => {
  it('snapshotは全行を変換し、所有者を除去、日時原表記・配列順序を保持する', async () => {
    const source = snapshot(), { adapter, transport } = fixture(source);
    const result = await adapter.load(); const data = ok(result);
    expect(transport).toHaveBeenCalledExactlyOnceWith('memo_load_snapshot', {});
    expect(data).toEqual({ memos: [{ id: ID, title: '合成メモ', body: ' 本文\n', createdAt: DATE, updatedAt: DATE,
      pinnedAt: null, deletedAt: null, revision: 1, lastRequestId: REQUEST }],
    tags: [{ id: TAG, name: 'Tag', createdAt: DATE, revision: 1 }], memoTags: [{ memoId: ID, tagId: TAG }] });
    source.memos[0]!.title = '後続変更'; expect(data.memos[0]!.title).toBe('合成メモ'); expect(Object.isFrozen(data.memos[0])).toBe(true);
  });
  it.each([null, 7])('保存revision=%sとタグ集合を正式引数へ固定する', async revision => {
    const input = { ...request(), tagIds: [TAG2, TAG], expectedRevision: revision };
    const body = { memo: { ...memo(), revision: revision === null ? 1 : revision + 1 }, tagIds: [TAG2, TAG] };
    const { adapter, transport } = fixture(body); const result = await adapter.save(input);
    expect(transport).toHaveBeenCalledExactlyOnceWith('memo_save', { p_id: ID, p_title: input.title, p_body: input.body,
      p_tag_ids: [TAG, TAG2], p_expected_revision: revision, p_request_id: REQUEST });
    expect(ok(result)).toMatchObject({ kind: 'saved', currentMayDiffer: true, value: { memo: { revision: revision === null ? 1 : 8 } } });
  });
  it.each(['pin', 'unpin', 'trash', 'restore'] as const)('状態変更%sは履歴要求と行検証を維持する', async action => {
    const body = { ...memo(), revision: '2', pinned_at: action === 'pin' ? DATE : null, deleted_at: action === 'trash' ? DATE : null };
    const { adapter, transport } = fixture(body); expect(ok(await adapter.changeState(ID, action, context()))).toMatchObject({ kind: 'changed', memo: { revision: 2 }, currentMayDiffer: true });
    expect(transport).toHaveBeenCalledExactlyOnceWith('memo_change_state', { p_id: ID, p_expected_revision: 1, p_request_id: REQUEST, p_action: action });
  });
  it.each([null, 4])('タグ保存revision=%sにSQLにないrequestIdを追加しない', async revision => {
    const { adapter, transport } = fixture({ ...tag(), revision: revision === null ? 1 : 5 });
    expect(ok(await adapter.saveTag(TAG, 'Tag', revision))).toEqual({ id: TAG, name: 'Tag', createdAt: DATE, revision: revision === null ? 1 : 5 });
    expect(transport).toHaveBeenCalledExactlyOnceWith('memo_save_tag', { p_id: TAG, p_name: 'Tag', p_expected_revision: revision });
  });
  it('個別/タグ削除は204空応答、requestIdをSQLに追加せず保持する', async () => {
    const { adapter, transport } = fixture(undefined, 204);
    const result = await adapter.deletePermanently(ID, context()); expect(ok(result)).toBeUndefined(); expect(call(result).requestId).toBe(REQUEST);
    expect(transport).toHaveBeenLastCalledWith('memo_delete_permanently', { p_id: ID, p_expected_revision: 1 });
    expect(ok(await adapter.deleteTag(TAG, 2))).toBeUndefined();
    expect(transport).toHaveBeenLastCalledWith('memo_delete_tag', { p_id: TAG, p_expected_revision: 2 });
  });
  it.each([0, 2])('一括削除はID/revisionの対応と整数件数%sを保持する', async count => {
    const targets = [{ id: ID, revision: 3 }, { id: TAG2, revision: 5 }].slice(0, count);
    const { adapter, transport } = fixture(count); expect(ok(await adapter.emptyTrash(targets, REQUEST))).toBe(count);
    expect(transport).toHaveBeenCalledExactlyOnceWith('memo_empty_trash', { p_ids: targets.map(t => t.id), p_revisions: targets.map(t => t.revision) });
  });
  it('呼出し引数はSQLの8関数だけに対応する', async () => {
    const calls: CloudCall[] = [];
    const adapter = createCloudRpcAdapter(OWNER, async () => { throw Error('合成切断'); });
    for (const result of [await adapter.load(), await adapter.save(request()), await adapter.resolve(request()),
      await adapter.changeState(ID, 'pin', context()), await adapter.deletePermanently(ID, context()), await adapter.emptyTrash([], REQUEST),
      await adapter.saveTag(TAG, 'Tag', null), await adapter.deleteTag(TAG, 1)]) calls.push(call(result));
    const sql = readFileSync(new URL('../doc/v1.1.0/memo_v1_1_schema_review8.sql', import.meta.url), 'utf8');
    for (const sent of calls) {
      const signature = sql.match(new RegExp(`create function public\\.${sent.rpc}\\(([\\s\\S]*?)\\)`))![1]!;
      const parameters = [...signature.matchAll(/\b(p_[a-z_]+)\s/g)].map(match => match[1]).sort();
      expect(Object.keys(sent.args).sort()).toEqual(parameters);
    }
  });
});

describe('要求照合は現在値や未実行の証明と区別する', () => {
  it('履歴savedは凍結した全内容で照合しcurrentMayDifferを返す', async () => {
    const { adapter, transport } = fixture({ status: 'saved', result: saved() });
    const result = await adapter.resolve(request()); expect(ok(result)).toMatchObject({ kind: 'saved', currentMayDiffer: true });
    expect(transport).toHaveBeenCalledExactlyOnceWith('memo_resolve_request', { p_id: ID, p_request_id: REQUEST,
      p_title: '合成メモ', p_body: ' 本文\n', p_tag_ids: [TAG], p_expected_revision: null });
  });
  it('照合nullはno-record、snapshot nullはpermissionで空一覧にしない', async () => {
    const { adapter } = fixture(null);
    expect(ok(await adapter.resolve(request()))).toEqual({ kind: 'no-record' });
    expect(await adapter.load()).toMatchObject({ kind: 'rejected', reason: 'permission' });
  });
  it('save/resolveの削除済みreceiptにメモを捏造しない', async () => {
    const { adapter } = fixture({ status: 'previously-applied-deleted' });
    expect(ok(await adapter.save(request()))).toEqual({ kind: 'previously-applied-deleted' });
    expect(ok(await adapter.resolve(request()))).toEqual({ kind: 'previously-applied-deleted' });
  });
  it('状態要求のP0002削除履歴を通常変更成功・単なるnot-foundへ変換しない', async () => {
    const { adapter } = fixture(error('P0002', 'previously applied, memo deleted'), 404);
    expect(ok(await adapter.changeState(ID, 'pin', context()))).toEqual({ kind: 'previously-applied-deleted' });
    expect(await adapter.save(request())).toMatchObject({ kind: 'unknown', reason: 'unclassified-http' });
  });
  it('状態RPCのHTTP200にSQL契約外のJSON receiptは受理しない', async () => {
    expect(await fixture({ status: 'previously-applied-deleted' }).adapter.changeState(ID, 'pin', context()))
      .toMatchObject({ kind: 'unknown', reason: 'invalid-response' });
  });
});

describe('HTTP/SQLSTATE/操作の分類', () => {
  it.each([[401, '42501'], [403, '42501'], [400, '22023'], [409, '23505'], [409, '23503'],
    [400, '23514'], [400, '23502'], [409, 'PT409'], [404, 'P0002']] as const)
  ('出所未確認HTTP%s/%sは見た目が正式エラーでも確定拒否にしない', async (status, code) => {
    const transport = vi.fn<CloudTransport>(async () => ({ provenance: 'unverified', status, body: error(code, 'memo revision conflict') }));
    const adapter = createCloudRpcAdapter(OWNER, transport);
    expect(await adapter.save(request())).toMatchObject({ kind: 'unknown', reason: 'unverified-response', call: { args: { p_id: ID } } });
    expect(await adapter.load()).toMatchObject({ kind: 'failed', reason: 'unverified-response' });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('出所未確認の200/204も成功扱いせず全write経路を保護する', async () => {
    const transport: CloudTransport = async rpc => ({ provenance: 'unverified', status: rpc === 'memo_delete_tag' ? 204 : 200, body: saved() });
    const adapter = createCloudRpcAdapter(OWNER, transport);
    const results = [await adapter.save(request()), await adapter.changeState(ID, 'pin', context()), await adapter.saveTag(TAG, 'Tag', null),
      await adapter.deleteTag(TAG, 1), await adapter.deletePermanently(ID, context()), await adapter.emptyTrash([], REQUEST)];
    results.forEach(result => expect(result).toMatchObject({ kind: 'unknown', reason: 'unverified-response' }));
    expect(await adapter.resolve(request())).toMatchObject({ kind: 'failed', reason: 'unverified-response' });
  });
  it('古いtransportの許可情報欠落を実行時にも拒否する', async () => {
    const transport = (async () => ({ status: 400, body: error('22023') })) as unknown as CloudTransport;
    expect(await createCloudRpcAdapter(OWNER, transport).save(request())).toMatchObject({ kind: 'unknown', reason: 'invalid-response' });
  });
  it('後続の単一RPC拒否は過去試行の結果不明を取り消さない', async () => {
    let calls = 0;
    const transport = vi.fn<CloudTransport>(async () => {
      if (++calls === 1) throw Error('Response lost');
      return { provenance: 'single-rpc', status: 400, body: error('22023') };
    });
    const adapter = createCloudRpcAdapter(OWNER, transport), previous = await adapter.save(request());
    const subsequent = await adapter.save(request());
    expect(previous).toMatchObject({ kind: 'unknown', reason: 'communication' });
    expect(subsequent).toMatchObject({ kind: 'rejected', reason: 'invalid-argument' });
    expect(call(previous).args).toEqual(call(subsequent).args); expect(transport).toHaveBeenCalledTimes(2);
  });
  const cases: [RpcName, string, string][] = [
    ['memo_save', 'previously used memo id', 'used-memo-id'], ['memo_save', 'memo revision conflict', 'memo-revision'],
    ['memo_change_state', 'revision conflict', 'state-revision'], ['memo_delete_permanently', 'not found or revision conflict', 'delete-not-found-or-revision'],
    ['memo_empty_trash', 'trash snapshot conflict', 'trash-snapshot'], ['memo_empty_trash', 'trash revision conflict', 'trash-revision'],
    ['memo_save_tag', 'tag revision conflict', 'tag-revision'], ['memo_delete_tag', 'tag revision conflict', 'tag-revision'],
  ];
  function operation(adapter: ReturnType<typeof createCloudRpcAdapter>, name: RpcName) {
    switch (name) {
      case 'memo_save': return adapter.save(request());
      case 'memo_change_state': return adapter.changeState(ID, 'pin', context());
      case 'memo_delete_permanently': return adapter.deletePermanently(ID, context());
      case 'memo_empty_trash': return adapter.emptyTrash([], REQUEST);
      case 'memo_save_tag': return adapter.saveTag(TAG, 'Tag', 1);
      case 'memo_delete_tag': return adapter.deleteTag(TAG, 1);
      default: return adapter.load();
    }
  }
  it.each(cases)('%s/%sを厳密な競合に分類する', async (rpc, message, conflict) => {
    expect(await operation(fixture(error('PT409', message), 409).adapter, rpc)).toMatchObject({ kind: 'rejected', reason: 'conflict', conflict });
  });
  it.each([[400, 'PT409', 'memo revision conflict'], [409, '40001', 'memo revision conflict'], [409, 'PT409', 'unknown conflict'],
    [409, 'PT409', 'revision conflict'], [500, 'XX000', 'server error'], [409, 'PT409', 'constructor']] as const)
  ('HTTP%s/%s/%sを既知競合へ読み替えない', async (status, code, message) => {
    expect(await fixture(error(code, message), status).adapter.save(request())).toMatchObject({ kind: 'unknown', reason: 'unclassified-http' });
  });
  it.each([[401, '42501', 'permission'], [403, '42501', 'permission'], [400, '22023', 'invalid-argument'],
    [409, '23505', 'constraint'], [409, '23503', 'constraint'], [400, '23514', 'constraint'], [400, '23502', 'constraint'], [404, 'P0002', 'not-found']] as const)
  ('HTTP%s/%sは%sとして確定拒否する', async (status, code, reason) => {
    expect(await fixture(error(code, code === 'P0002' ? 'memo not found' : '合成'), status).adapter.save(request())).toMatchObject({ kind: 'rejected', reason });
  });
});

describe('全体検証・応答と要求の対応', () => {
  it.each(['memos', 'tags', 'memoTags'] as const)('%sの所有者不一致を区別する', async collection => {
    const body = snapshot(); body[collection][0]!.user_id = OTHER;
    expect(await fixture(body).adapter.load()).toMatchObject({ kind: 'failed', reason: 'owner-mismatch' });
  });
  it('書込応答の所有者不一致も未保存とは断定しない', async () => {
    expect(await fixture({ ...saved(), memo: { ...memo(), user_id: OTHER } }).adapter.save(request())).toMatchObject({ kind: 'unknown', reason: 'owner-mismatch' });
  });
  const invalidMemo: [string, unknown][] = [['revision', '9007199254740992'], ['revision', 0], ['revision', '01'], ['id', 'bad'],
    ['updated_at', '2024-02-30T00:00:00Z'], ['title', ' x '], ['body', '\u0000'], ['last_request_id', 'bad']];
  it.each(invalidMemo)('不正DBメモ%s=%sを拒否する', async (key, value) => {
    expect(await fixture({ ...saved(), memo: { ...memo(), [key]: value } }).adapter.save(request())).toMatchObject({ kind: 'unknown', reason: 'invalid-response' });
  });
  it.each(['id', 'title', 'body', 'revision', 'last_request_id', 'deleted_at'] as const)('形式正常でも別要求の%s応答を拒否する', async key => {
    const values = { id: OTHER, title: '別タイトル', body: '別本文', revision: 2, last_request_id: OTHER, deleted_at: DATE };
    expect(await fixture({ ...saved(), memo: { ...memo(), [key]: values[key] } }).adapter.save(request())).toMatchObject({ kind: 'unknown', reason: 'invalid-response' });
  });
  it.each([{}, { ...saved(), extra: 1 }, { memo: { ...memo(), extra: 1 }, tagIds: [TAG] },
    { memo: memo(), tagIds: [] }, { memo: memo(), tagIds: [TAG, TAG] }, { status: 'previously-applied-deleted', memo: memo() }])
  ('未知/欠落/不一致/重複の保存応答を拒否する %#', async body => {
    expect(await fixture(body).adapter.save(request())).toMatchObject({ kind: 'unknown', reason: 'invalid-response' });
  });
  it.each([
    { ...snapshot(), memos: [memo(), memo()] },
    { ...snapshot(), tags: [tag(), { ...tag(), id: TAG2, name: 'tag' }] },
    { ...snapshot(), memoTags: [{ user_id: OWNER, memo_id: OTHER, tag_id: TAG }] },
    { ...snapshot(), memoTags: [...snapshot().memoTags, ...snapshot().memoTags] },
    { ...snapshot(), tags: [{ ...tag(), extra: 1 }] },
  ])('snapshotの重複/孤立/未知項目を全体拒否する %#', async body => {
    expect(await fixture(body).adapter.load()).toMatchObject({ kind: 'failed', reason: 'invalid-response' });
  });
  it.each(['2', -1, 1.5, 0, null])('一括削除の不正件数%sを成功にしない', async body => {
    expect(await fixture(body).adapter.emptyTrash([{ id: ID, revision: 1 }], REQUEST)).toMatchObject({ kind: 'unknown', reason: 'invalid-response' });
  });
  it.each([[200, null], [204, {}], [201, null]])('voidのHTTP%s/本文を厳格検証する', async (status, body) => {
    expect(await fixture(body, status as number).adapter.deleteTag(TAG, 1)).toMatchObject({ kind: 'unknown', reason: 'invalid-response' });
  });
  it('UUID大小文字同値は比較だけ、原表記と最大安全revisionは保持する', async () => {
    const input = { ...request(), memoId: 'abcdef00-0000-0000-0000-000000000001', expectedRevision: Number.MAX_SAFE_INTEGER - 1 };
    const body = { ...saved(), memo: { ...memo(), id: input.memoId.toUpperCase(), revision: '9007199254740991' } };
    const result = ok(await fixture(body).adapter.save(input));
    if (result.kind !== 'saved') throw Error('Expected saved');
    expect(result.value.memo.id).toBe(input.memoId.toUpperCase()); expect(result.value.memo.revision).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('タグ保存の別対象/名称/初期revisionを受理しない', async () => {
    for (const row of [{ ...tag(), id: OTHER }, { ...tag(), name: '別タグ' }, { ...tag(), revision: 2 }])
      expect(await fixture(row).adapter.saveTag(TAG, 'Tag', null)).toMatchObject({ kind: 'unknown', reason: 'invalid-response' });
  });
  it('状態応答の対象・requestId・revision・ピン/ゴミ箱状態を検証する', async () => {
    const valid = { ...memo(), revision: 2, pinned_at: DATE };
    for (const row of [{ ...valid, id: OTHER }, { ...valid, last_request_id: OTHER }, { ...valid, revision: 3 },
      { ...valid, pinned_at: null }, { ...valid, deleted_at: DATE }])
      expect(await fixture(row).adapter.changeState(ID, 'pin', context())).toMatchObject({ kind: 'unknown', reason: 'invalid-response' });
  });
  it('壊れた履歴応答も照合成功にはしない', async () => {
    for (const body of [{ status: 'saved', result: { ...saved(), memo: { ...memo(), last_request_id: OTHER } } },
      { status: 'saved', result: saved(), extra: true }, { status: 'unknown' }])
      expect(await fixture(body).adapter.resolve(request())).toMatchObject({ kind: 'failed', reason: 'invalid-response' });
  });
  it('応答アクセサを起動せず拒否し、例外本文を返さない', async () => {
    let gets = 0; const body = { ...memo() };
    Object.defineProperty(body, 'title', { enumerable: true, get() { gets++; throw Error('応答の秘密'); } });
    const result = await fixture({ memo: body, tagIds: [TAG] }).adapter.save(request());
    expect(result).toMatchObject({ kind: 'unknown', reason: 'invalid-response' }); expect(gets).toBe(0);
    expect(JSON.stringify(result)).not.toContain('応答の秘密');
  });
});

describe('送信前拒否・凍結・遅延・無自動再送', () => {
  it.each([{ ...request(), title: ' trim ' }, { ...request(), tagIds: [TAG, TAG] }, { ...request(), expectedRevision: -1 },
    { ...request(), requestId: 'bad' }, { ...request(), extra: true }])('不正入力は送信0件 %#', async input => {
    const { adapter, transport } = fixture(saved()); expect(await adapter.save(input)).toEqual({ kind: 'not-attempted', reason: 'invalid-input' }); expect(transport).not.toHaveBeenCalled();
  });
  it('全操作の不正ID/revision/重複集合は送信0件', async () => {
    const { adapter, transport } = fixture(null);
    const results = [await adapter.resolve({ ...request(), tagIds: [TAG, TAG] }), await adapter.changeState('bad', 'pin', context()),
      await adapter.deletePermanently(ID, { ...context(), expectedRevision: 0 }), await adapter.saveTag(TAG, ' trim ', null),
      await adapter.deleteTag(TAG, 0), await adapter.emptyTrash([{ id: ID, revision: 1 }, { id: ID, revision: 1 }], REQUEST)];
    results.forEach(result => expect(result.kind).toBe('not-attempted')); expect(transport).not.toHaveBeenCalled();
  });
  it('切断は読取failed/書込unknown、凍結要求を保持して無自動再送', async () => {
    const transport = vi.fn<CloudTransport>(async () => { throw Error('秘密のサーバー内容'); });
    const adapter = createCloudRpcAdapter(OWNER, transport), input = { ...request() };
    const result = await adapter.save(input); input.title = '変更';
    expect(result).toMatchObject({ kind: 'unknown', reason: 'communication', call: { ownerId: OWNER, args: { p_title: '合成メモ' } } });
    expect(Object.isFrozen(call(result).args.p_tag_ids)).toBe(true); expect(JSON.stringify(result)).not.toContain('秘密のサーバー内容');
    expect(await adapter.load()).toMatchObject({ kind: 'failed', reason: 'communication' });
    expect(await adapter.resolve(request())).toMatchObject({ kind: 'failed', reason: 'communication' });
    expect(transport).toHaveBeenCalledTimes(3); await Promise.resolve(); expect(transport).toHaveBeenCalledTimes(3);
  });
  it('状態・タグ・個別/一括削除の切断も結果不明で対象を保持する', async () => {
    const transport = vi.fn<CloudTransport>(async () => { throw Error('Synthetic disconnect'); });
    const adapter = createCloudRpcAdapter(OWNER, transport);
    const results = [await adapter.changeState(ID, 'trash', context()), await adapter.saveTag(TAG, 'Tag', 1),
      await adapter.deleteTag(TAG, 1), await adapter.deletePermanently(ID, context()), await adapter.emptyTrash([{ id: ID, revision: 1 }], REQUEST)];
    results.forEach(result => expect(result).toMatchObject({ kind: 'unknown', reason: 'communication', call: { ownerId: OWNER } }));
    expect(call(results[4]!).args).toEqual({ p_ids: [ID], p_revisions: [1] }); expect(transport).toHaveBeenCalledTimes(5);
  });
  it('後続入力変更は通信中の凍結内容に影響せず、独立した結果だけを返す', async () => {
    let release!: (value: CloudTransportResponse) => void;
    const transport = vi.fn<CloudTransport>(() => new Promise(resolve => { release = resolve; }));
    const input = { ...request(), tagIds: [TAG] }, adapter = createCloudRpcAdapter(OWNER, transport), pending = adapter.save(input);
    input.title = '後続編集'; input.tagIds.push(TAG2);
    expect(transport.mock.calls[0]![1].p_title).toBe('合成メモ'); expect(transport.mock.calls[0]![1].p_tag_ids).toEqual([TAG]);
    release({ provenance: 'single-rpc', status: 200, body: saved() }); expect(ok(await pending).kind).toBe('saved');
  });
  it('同requestIdの明示的な同内容再呼出しをローカル使用済み集合で拒否しない', async () => {
    const { adapter, transport } = fixture(saved()); expect(ok(await adapter.save(request())).kind).toBe('saved');
    expect(ok(await adapter.save(request())).kind).toBe('saved'); expect(transport).toHaveBeenCalledTimes(2);
  });
  it('順序逆転でadapterの現在状態を上書きせず、各callの所有者/要求を返す', async () => {
    const releases: ((value: CloudTransportResponse) => void)[] = [];
    const transport: CloudTransport = () => new Promise(resolve => releases.push(resolve));
    const adapter = createCloudRpcAdapter(OWNER, transport);
    const first = adapter.save(request()), second = adapter.save({ ...request(), requestId: OTHER });
    releases[1]!({ provenance: 'single-rpc', status: 200, body: { ...saved(), memo: { ...memo(), last_request_id: OTHER } } });
    const recent = await second; expect(call(recent).requestId).toBe(OTHER);
    releases[0]!({ provenance: 'single-rpc', status: 200, body: saved() }); const old = await first; expect(call(old).requestId).toBe(REQUEST);
    expect(call(recent).requestId).toBe(OTHER); expect(Object.keys(adapter)).not.toContain('getState');
  });
});

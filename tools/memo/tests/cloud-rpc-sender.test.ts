import { describe, expect, it, vi } from 'vitest';
import { createMemoRpcSender, MEMO_RPC_ORIGIN, RpcSenderError } from '../src/cloud-rpc-sender';
import type { CloudCall, RpcName } from '../src/cloud-rpc-types';

const KEY = 'sb_publishable_synthetic', TOKEN = 'header.payload.signature';
const url = (rpc: RpcName) => `${MEMO_RPC_ORIGIN}/rest/v1/rpc/${rpc}`;
const response = (rpc: RpcName, body: unknown = {}, status = 200) => ({ status, url: url(rpc), redirected: false,
  text: async () => status === 204 ? '' : JSON.stringify(body) });
const args = (rpc: RpcName): CloudCall['args'] => rpc === 'memo_load_snapshot' ? {} : rpc === 'memo_empty_trash'
  ? { p_ids: [], p_revisions: [] } : rpc === 'memo_save_tag' ? { p_id: '00000000-0000-0000-0000-000000000001', p_name: '合成', p_expected_revision: null }
  : rpc === 'memo_delete_tag' || rpc === 'memo_delete_permanently' ? { p_id: '00000000-0000-0000-0000-000000000001', p_expected_revision: 1 }
  : rpc === 'memo_change_state' ? { p_id: '00000000-0000-0000-0000-000000000001', p_expected_revision: 1, p_request_id: '00000000-0000-0000-0000-000000000002', p_action: 'pin' }
  : { p_id: '00000000-0000-0000-0000-000000000001', p_title: '合成', p_body: '本文', p_tag_ids: [], p_expected_revision: null, p_request_id: '00000000-0000-0000-0000-000000000002' };
const factory = (fetchPort: Parameters<typeof createMemoRpcSender>[1] = async (requestUrl) => {
  const rpc = requestUrl.split('/').pop() as RpcName; return response(rpc);
}) => createMemoRpcSender({ origin: MEMO_RPC_ORIGIN, publishableKey: KEY, accessToken: TOKEN }, fetchPort);

describe('通信なし製品RPC sender境界', () => {
  it('8 RPCだけを正式パス・POST・単一呼出しで送信する', async () => {
    const fetchPort = vi.fn<Parameters<typeof createMemoRpcSender>[1]>(async (requestUrl) => response(requestUrl.split('/').pop() as RpcName));
    const sender = factory(fetchPort);
    const rpcs: RpcName[] = ['memo_load_snapshot', 'memo_save', 'memo_resolve_request', 'memo_change_state',
      'memo_delete_permanently', 'memo_empty_trash', 'memo_save_tag', 'memo_delete_tag'];
    for (const rpc of rpcs) expect((await sender(rpc, args(rpc))).provenance).toBe('unverified');
    expect(fetchPort).toHaveBeenCalledTimes(8);
    expect(fetchPort.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', redirect: 'error' });
  });

  it.each(['http://yohoppqflnhhvqypwhfv.supabase.co', `${MEMO_RPC_ORIGIN}/`, 'https://other.invalid'])(
    '固定origin以外を生成時に拒否する: %s', origin => {
      expect(() => createMemoRpcSender({ origin, publishableKey: KEY, accessToken: TOKEN }, async () => response('memo_load_snapshot')))
        .toThrowError(new RpcSenderError('boundary'));
    });

  it('認証情報形式とfetch注入を厳格に検証し、UI結果へ秘密値を出さない', async () => {
    expect(() => createMemoRpcSender({ origin: MEMO_RPC_ORIGIN, publishableKey: 'secret', accessToken: TOKEN }, async () => response('memo_load_snapshot')))
      .toThrowError('boundary');
    const sender = factory(async (_url, init) => {
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      return response('memo_load_snapshot', { memos: [], tags: [], memoTags: [] });
    });
    const result = await sender('memo_load_snapshot', {});
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('引数キー・型を拒否し、fetchを呼ばない', async () => {
    const fetchPort = vi.fn<Parameters<typeof createMemoRpcSender>[1]>(async () => response('memo_save'));
    const sender = factory(fetchPort);
    await expect(sender('memo_save', { p_id: 'id', p_title: 'x', p_body: 'x', p_tag_ids: [{} as never], p_expected_revision: null, p_request_id: 'id' }))
      .rejects.toThrow('boundary');
    await expect(sender('memo_save', { p_id: 'id', p_title: 'x', p_body: 'x', p_tag_ids: [], p_expected_revision: null, p_request_id: 'id', extra: 1 }))
      .rejects.toThrow('boundary');
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it.each([301, 302, 303, 307, 308])('redirect status %sを拒否し、再送しない', async status => {
    const fetchPort = vi.fn(async () => ({ ...response('memo_load_snapshot', null, status), redirected: false }));
    await expect(factory(fetchPort)('memo_load_snapshot', {})).rejects.toThrow('redirect');
    expect(fetchPort).toHaveBeenCalledOnce();
  });

  it('redirected/URL差替え応答を拒否する', async () => {
    const redirected = factory(async () => ({ ...response('memo_load_snapshot'), redirected: true }));
    await expect(redirected('memo_load_snapshot', {})).rejects.toThrow('redirect');
    const changed = factory(async () => ({ ...response('memo_load_snapshot'), url: 'https://other.invalid' }));
    await expect(changed('memo_load_snapshot', {})).rejects.toThrow('redirect');
  });

  it('204空本文とJSON本文を解析するがsingle-rpcには昇格しない', async () => {
    const sender = factory(async (requestUrl) => response(requestUrl.split('/').pop() as RpcName, undefined, 204));
    const empty = await sender('memo_delete_tag', args('memo_delete_tag'));
    expect(empty).toEqual({ provenance: 'unverified', status: 204, body: undefined });
    const json = await factory()('memo_load_snapshot', {});
    expect(json.provenance).toBe('unverified');
  });

  it('本文解析失敗・不正status・通信断を固定理由へ変換する', async () => {
    await expect(factory(async () => ({ ...response('memo_load_snapshot'), text: async () => '{bad' }))('memo_load_snapshot', {})).rejects.toThrow('json');
    await expect(factory(async () => ({ ...response('memo_load_snapshot'), status: 99 }))('memo_load_snapshot', {})).rejects.toThrow('body');
    await expect(factory(async () => { throw Error('private detail'); })('memo_load_snapshot', {})).rejects.toThrow('communication');
  });

  it('timeout後にfetchを再送せず、signalをabortする', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetchPort = vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise<never>(() => {});
      });
      const operation = factory(fetchPort)('memo_load_snapshot', {});
      const settled = operation.then(() => null, value => value);
      await vi.advanceTimersByTimeAsync(15_000);
      const error = await settled;
      expect(error).toMatchObject({ reason: 'timeout' });
      expect(fetchPort).toHaveBeenCalledOnce(); expect(signal?.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('自動再送を行わず、後続呼出しとは独立した1回送信を維持する', async () => {
    let calls = 0;
    const fetchPort = vi.fn(async (requestUrl: string) => { calls++; if (calls === 1) throw Error('disconnect'); return response(requestUrl.split('/').pop() as RpcName); });
    await expect(factory(fetchPort)('memo_save_tag', args('memo_save_tag'))).rejects.toThrow('communication');
    expect(fetchPort).toHaveBeenCalledOnce();
    await factory(fetchPort)('memo_save_tag', args('memo_save_tag'));
    expect(fetchPort).toHaveBeenCalledTimes(2);
  });
});

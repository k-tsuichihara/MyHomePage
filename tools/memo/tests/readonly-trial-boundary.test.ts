import { describe, expect, it, vi } from 'vitest';
import { createCloudController } from '../src/cloud-controller';
import type { AuthContext, AuthRpcPreparation } from '../src/auth-session';
import type { CloudTransport } from '../src/cloud-rpc-types';

const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const context: AuthContext = Object.freeze({ userId: OWNER, generation: 1 });

function fixture(response: Awaited<ReturnType<CloudTransport>> | Error = {
  provenance: 'unverified', status: 200, body: { memos: [], tags: [], memoTags: [] },
}) {
  const calls: Array<{ rpc: string; args: unknown }> = [];
  const transport: CloudTransport = async (rpc, args) => {
    calls.push({ rpc, args });
    if (response instanceof Error) throw response;
    return response;
  };
  const preparation: AuthRpcPreparation = { kind: 'ready', ownerId: OWNER, transport, wasSent: () => calls.length > 0 };
  const auth = {
    isCurrent: vi.fn((value: AuthContext) => value === context),
    prepareRpc: vi.fn(async () => preparation),
  };
  return { controller: createCloudController(auth), auth, calls };
}

describe('C04 初回読み取り試験の通信なし境界', () => {
  it('memo_load_snapshotを1回だけ呼び、他RPCを呼ばない', async () => {
    const f = fixture();
    const result = await f.controller.load(context);
    expect(result.kind).toBe('completed');
    expect(f.calls).toEqual([{ rpc: 'memo_load_snapshot', args: {} }]);
    expect(f.calls.filter(call => call.rpc !== 'memo_load_snapshot')).toHaveLength(0);
    expect(f.auth.prepareRpc).toHaveBeenCalledOnce();
  });

  it('senderがunverifiedを返しても自動再送せず、観測結果をそのまま上位へ返す', async () => {
    const f = fixture({ provenance: 'unverified', status: 200, body: { memos: [], tags: [], memoTags: [] } });
    const first = await f.controller.load(context);
    const second = await f.controller.load(context);
    expect(first.kind).toBe('completed');
    expect(second.kind).toBe('completed');
    expect(f.calls).toHaveLength(2);
    expect(f.calls.every(call => call.rpc === 'memo_load_snapshot')).toBe(true);
  });

  it('通信断では1回の送信後に停止し、自動再送しない', async () => {
    const f = fixture(new Error('synthetic disconnect'));
    const result = await f.controller.load(context);
    expect(result.kind).toBe('completed');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.rpc).toBe('memo_load_snapshot');
  });
});

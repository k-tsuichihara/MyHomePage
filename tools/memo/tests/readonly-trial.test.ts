import { describe, expect, it, vi } from 'vitest';
import { createReadonlyTrial } from '../src/readonly-trial';
import type { AuthContext, AuthRpcPreparation } from '../src/auth-session';
import type { CloudTransport } from '../src/cloud-rpc-types';

const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const context: AuthContext = Object.freeze({ userId: OWNER, generation: 1 });

function fixture(response: Awaited<ReturnType<CloudTransport>>) {
  const transport: CloudTransport = vi.fn(async () => response);
  const ready: AuthRpcPreparation = { kind: 'ready', ownerId: OWNER, transport, wasSent: () => true };
  const auth = { isCurrent: vi.fn(() => true), prepareRpc: vi.fn(async () => ready) };
  return { trial: createReadonlyTrial(auth), auth, transport };
}

describe('初回読み取り試験ゲート', () => {
  it('既存controller経路でloadだけを観測する', async () => {
    const f = fixture({ provenance: 'unverified', status: 200, body: { memos: [], tags: [], memoTags: [] } });
    const result = await f.trial.load(context);
    expect(result.kind).toBe('completed');
    expect(f.transport).toHaveBeenCalledOnce();
    expect(f.transport).toHaveBeenCalledWith('memo_load_snapshot', {});
    expect(f.trial.observation()).toMatchObject({ rpcCalls: 1, rpcNames: ['memo_load_snapshot'], nonLoadRpcCalls: 0, stopped: false });
  });

  it('認証世代が変わった場合は送信後の反映を停止する', async () => {
    const f = fixture({ provenance: 'unverified', status: 200, body: { memos: [], tags: [], memoTags: [] } });
    f.auth.isCurrent.mockReturnValueOnce(true).mockReturnValue(false);
    const result = await f.trial.load(context);
    expect(result.kind).toBe('stale-response');
    expect(f.trial.observation().rpcCalls).toBe(1);
  });

  it('UIへAuth秘密値を返さず、Auth通信は未観測として明示する', async () => {
    const f = fixture({ provenance: 'unverified', status: 200, body: { memos: [], tags: [], memoTags: [] } });
    await f.trial.load(context);
    const observation = f.trial.observation();
    expect(observation.authCommunication).toBe('not-observed-at-boundary');
    expect(JSON.stringify(observation)).not.toContain('token');
    expect(JSON.stringify(observation)).not.toContain('password');
  });
});

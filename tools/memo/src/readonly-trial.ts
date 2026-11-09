import type { AuthContext } from './auth-session';
import type { AuthenticatedRpcSender } from './auth-session';
import { createBrowserMemoAuth, type BrowserAuthEnvironment } from './browser-auth';
import type { PersistencePermit } from './browser-local-adapter';
import { createMemoRpcSender } from './cloud-rpc-sender';
import { createCloudController, type CloudAuthBoundary, type CloudLoadControlResult } from './cloud-controller';
import type { CloudTransport } from './cloud-rpc-types';

export interface ReadonlyTrialObservation {
  readonly authCommunication: 'not-observed-at-boundary';
  readonly rpcCalls: number;
  readonly rpcNames: readonly string[];
  readonly nonLoadRpcCalls: number;
  readonly stopped: boolean;
}

/**
 * 初回読み取り試験用のUI非依存ゲート。
 * Authの実通信はC03境界の外側で観測し、ここではcontroller→senderの
 * memo_load_snapshot限定と秘密値を含まない観測値だけを提供する。
 */
export function createReadonlyTrial(auth: CloudAuthBoundary) {
  let rpcCalls = 0;
  const rpcNames: string[] = [];
  let stopped = false;
  const trialAuth: CloudAuthBoundary = {
    isCurrent: auth.isCurrent,
    async prepareRpc(context) {
      const prepared = await auth.prepareRpc(context);
      if (prepared.kind !== 'ready') return prepared;
      const transport: CloudTransport = async (rpc, args) => {
        if (rpc !== 'memo_load_snapshot') { stopped = true; throw new Error('readonly-trial-rpc-denied'); }
        rpcCalls++;
        rpcNames.push(rpc);
        return prepared.transport(rpc, args);
      };
      return Object.freeze({ ...prepared, transport });
    },
  };
  const controller = createCloudController(trialAuth);
  return Object.freeze({
    async load(context: AuthContext): Promise<CloudLoadControlResult> {
      const result = await controller.load(context);
      if (result.kind === 'stale-response' || result.kind === 'stopped') stopped = true;
      return result;
    },
    observation(): ReadonlyTrialObservation {
      return Object.freeze({ authCommunication: 'not-observed-at-boundary', rpcCalls,
        rpcNames: Object.freeze([...rpcNames]), nonLoadRpcCalls: rpcNames.filter(name => name !== 'memo_load_snapshot').length, stopped });
    },
    dispose: () => controller.dispose(),
  });
}

/** 実環境値を呼出側から注入する、ブラウザ用composition root。表示UIやBearerを返さない。 */
export function createBrowserReadonlyTrial(env: BrowserAuthEnvironment, permit: PersistencePermit | undefined,
  config: { url: string; publicKey: string }, authTransport: typeof fetch,
  rpcConfig: { origin: string; publishableKey: string }, rpcFetch: Parameters<typeof createMemoRpcSender>[1]) {
  const sender: AuthenticatedRpcSender = (accessToken, rpc, args) =>
    createMemoRpcSender({ ...rpcConfig, accessToken }, rpcFetch)(rpc, args);
  const auth = createBrowserMemoAuth(env, permit, config, authTransport, sender);
  const trial = createReadonlyTrial(auth.session);
  return Object.freeze({ session: auth.session, trial, dispose: auth.dispose });
}

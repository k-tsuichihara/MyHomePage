import type { CloudTransport, RpcName } from './cloud-rpc-types';
import { array, record } from './read-primitives';

/** 現在の承認済み開発origin。製品composition rootへの接続は別承認とする。 */
export const MEMO_RPC_ORIGIN = 'https://yohoppqflnhhvqypwhfv.supabase.co';
export const MEMO_RPC_KEYS: Readonly<Record<RpcName, readonly string[]>> = Object.freeze({
  memo_load_snapshot: [], memo_save: ['p_id', 'p_title', 'p_body', 'p_tag_ids', 'p_expected_revision', 'p_request_id'],
  memo_resolve_request: ['p_id', 'p_request_id', 'p_title', 'p_body', 'p_tag_ids', 'p_expected_revision'],
  memo_change_state: ['p_id', 'p_expected_revision', 'p_request_id', 'p_action'],
  memo_delete_permanently: ['p_id', 'p_expected_revision'], memo_empty_trash: ['p_ids', 'p_revisions'],
  memo_save_tag: ['p_id', 'p_name', 'p_expected_revision'], memo_delete_tag: ['p_id', 'p_expected_revision'],
});
Object.values(MEMO_RPC_KEYS).forEach(Object.freeze);

export type RpcFetchPort = (url: string, init: RequestInit) => Promise<Pick<Response, 'status' | 'text' | 'url' | 'redirected'>>;
export type RpcSenderErrorReason = 'boundary' | 'communication' | 'timeout' | 'body' | 'json' | 'redirect';
export class RpcSenderError extends Error {
  constructor(readonly reason: RpcSenderErrorReason) { super(`Memo RPC sender stopped: ${reason}`); }
}

function scalar(value: unknown): string | number | null {
  if (value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value;
  throw new RpcSenderError('boundary');
}

/**
 * C02の許可境界を製品sender用に固定した注入実装。
 * fetchPortはテストまたは後続の明示承認済みcomposition rootからのみ注入する。
 */
export function createMemoRpcSender(config: { origin: string; publishableKey: string; accessToken: string },
  fetchPort: RpcFetchPort): CloudTransport {
  if (config.origin !== MEMO_RPC_ORIGIN || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey)
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(config.accessToken)
    || typeof fetchPort !== 'function') throw new RpcSenderError('boundary');

  return async (rpc, args) => {
    let body: string;
    try {
      if (!Object.hasOwn(MEMO_RPC_KEYS, rpc)) throw new RpcSenderError('boundary');
      const values = record(args, MEMO_RPC_KEYS[rpc]);
      body = JSON.stringify(Object.fromEntries(Object.entries(values).map(([key, value]) => [key,
        Array.isArray(value) ? array(value).map(scalar) : scalar(value)])));
    } catch (error) { throw error instanceof RpcSenderError ? error : new RpcSenderError('boundary'); }

    const url = `${MEMO_RPC_ORIGIN}/rest/v1/rpc/${rpc}`;
    const controller = new AbortController();
    let timer!: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new RpcSenderError('timeout')); }, 15_000);
    });
    const receive = async () => {
      let response: Awaited<ReturnType<RpcFetchPort>>;
      try {
        response = await fetchPort(url, { method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { apikey: config.publishableKey, Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' }, body });
      } catch { throw new RpcSenderError(controller.signal.aborted ? 'timeout' : 'communication'); }
      if (controller.signal.aborted) throw new RpcSenderError('timeout');
      let status: number;
      try {
        status = response.status;
        if (!Number.isInteger(status) || status < 100 || status > 599) throw new RpcSenderError('body');
        if (response.redirected || (status >= 300 && status < 400) || response.url !== url) throw new RpcSenderError('redirect');
      } catch (error) { throw error instanceof RpcSenderError ? error : new RpcSenderError('body'); }
      let text: string;
      try { text = await response.text(); } catch { throw new RpcSenderError(controller.signal.aborted ? 'timeout' : 'body'); }
      if (controller.signal.aborted) throw new RpcSenderError('timeout');
      let parsed: unknown;
      try {
        if (status === 204) { if (text !== '') throw Error(); parsed = undefined; }
        else parsed = JSON.parse(text) as unknown;
      } catch { throw new RpcSenderError('json'); }
      // 経路の再試行・中継・出所はこの注入境界から証明できないため、常に未検証とする。
      return { provenance: 'unverified' as const, status, body: parsed };
    };
    try { return await Promise.race([receive(), deadline]); }
    catch (error) { controller.abort(); throw error instanceof RpcSenderError ? error : new RpcSenderError('communication'); }
    finally { clearTimeout(timer); }
  };
}

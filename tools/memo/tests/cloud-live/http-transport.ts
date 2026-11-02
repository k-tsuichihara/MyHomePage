import type { CloudTransport, RpcName } from '../../src/cloud-rpc-types';
import { array, record } from '../../src/read-primitives';

// 既存cli.mjsの開発専用固定照合を維持する。実設定や認証情報をこのモジュールから取得しない。
export const DEV_ORIGIN = 'https://yohoppqflnhhvqypwhfv.supabase.co';
export const RPC_KEYS: Readonly<Record<RpcName, readonly string[]>> = Object.freeze({
  memo_load_snapshot: [], memo_save: ['p_id', 'p_title', 'p_body', 'p_tag_ids', 'p_expected_revision', 'p_request_id'],
  memo_resolve_request: ['p_id', 'p_request_id', 'p_title', 'p_body', 'p_tag_ids', 'p_expected_revision'],
  memo_change_state: ['p_id', 'p_expected_revision', 'p_request_id', 'p_action'],
  memo_delete_permanently: ['p_id', 'p_expected_revision'], memo_empty_trash: ['p_ids', 'p_revisions'],
  memo_save_tag: ['p_id', 'p_name', 'p_expected_revision'], memo_delete_tag: ['p_id', 'p_expected_revision'],
});
Object.values(RPC_KEYS).forEach(Object.freeze);
export type FetchPort = (url: string, init: RequestInit) => Promise<Pick<Response, 'status' | 'text' | 'url' | 'redirected'>>;
export class TestTransportError extends Error {
  constructor(readonly reason: 'boundary' | 'communication' | 'timeout' | 'body' | 'json' | 'redirect') { super(`Test transport stopped: ${reason}`); }
}

/**
 * 必須注入したfetchだけを使い、実fetchの既定接続を作らない。実行入口は本factoryをimportしない。
 * 認証情報は呼出側のメモリからのみ受け取り、例外/cause/log/返り値へ含めない。
 */
export function createTestHttpTransport(config: { origin: string; publishableKey: string; accessToken: string }, fetchPort: FetchPort): CloudTransport {
  const { origin, publishableKey, accessToken } = config;
  if (origin !== DEV_ORIGIN || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken) || typeof fetchPort !== 'function') throw new TestTransportError('boundary');
  return async (rpc, args) => {
    let body: string;
    try {
      if (!Object.hasOwn(RPC_KEYS, rpc)) throw Error();
      const values = record(args, RPC_KEYS[rpc]);
      const scalar = (value: unknown) => {
        if (value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value;
        throw Error();
      };
      body = JSON.stringify(Object.fromEntries(Object.entries(values).map(([key, value]) => [key,
        Array.isArray(value) ? array(value).map(scalar) : scalar(value)])));
    } catch { throw new TestTransportError('boundary'); }
    const url = `${origin}/rest/v1/rpc/${rpc}`, controller = new AbortController(), signal = controller.signal;
    // 注入先がsignalを無視しても呼出側の待機を終える。期限はfetchと本文で共用し延長しない。
    let timer!: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new TestTransportError('timeout')); controller.abort(); }, 15000);
    });
    const receive = async () => {
      let response: Awaited<ReturnType<FetchPort>>;
      try { response = await fetchPort(url, { method: 'POST', redirect: 'error', signal,
        headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body }); }
      catch { throw new TestTransportError(signal.aborted ? 'timeout' : 'communication'); }
      // 期限後にfetchが遅れて返っても、その本文の読取は開始しない。
      if (signal.aborted) throw new TestTransportError('timeout');
      let status: number;
      try {
        status = response.status;
        if (!Number.isInteger(status) || status < 100 || status > 599) throw new TestTransportError('body');
        if (response.redirected || (status >= 300 && status < 400) || response.url !== url) throw new TestTransportError('redirect');
      } catch (error) { throw new TestTransportError(error instanceof TestTransportError ? error.reason : 'body'); }
      let text: string;
      try { text = await response.text(); }
      catch { throw new TestTransportError(signal.aborted ? 'timeout' : 'body'); }
      if (signal.aborted) throw new TestTransportError('timeout');
      let parsed: unknown;
      try {
        if (status === 204) { if (text !== '') throw Error(); parsed = undefined; }
        else parsed = JSON.parse(text) as unknown;
      } catch { throw new TestTransportError('json'); }
      // TLSやHTTP/codeの見た目だけで当該DB実行との対応を認定しない。実経路の認定は保留。
      return { provenance: 'unverified' as const, status, body: parsed };
    };
    try { return await Promise.race([receive(), deadline]); }
    catch (error) {
      // 中止はbest-effort。DB未実行/未コミットや、signalを無視する処理の終了は証明しない。
      controller.abort();
      throw new TestTransportError(error instanceof TestTransportError ? error.reason : 'communication');
    } finally { clearTimeout(timer); }
  };
}

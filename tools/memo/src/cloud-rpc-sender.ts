import type { CloudTransport, RpcName } from './cloud-rpc-types';
import { array, nullable, record, revision, uuid } from './read-primitives';

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

function stringValue(value: unknown): string {
  if (typeof value !== 'string') throw new RpcSenderError('boundary');
  return value;
}

function uuidValue(value: unknown): string { try { return uuid(value); } catch { throw new RpcSenderError('boundary'); } }
function revisionValue(value: unknown): number { try {
  const result = revision(value); return typeof result === 'number' ? result : (() => { throw new RpcSenderError('boundary'); })();
} catch { throw new RpcSenderError('boundary'); } }
function optionalRevision(value: unknown): number | null {
  try { return nullable(value, revisionValue); } catch { throw new RpcSenderError('boundary'); }
}
function uuidArray(value: unknown): string[] {
  try { return Object.freeze(array(value).map(uuidValue)) as unknown as string[]; } catch { throw new RpcSenderError('boundary'); }
}
function revisionArray(value: unknown): number[] {
  try { return Object.freeze(array(value).map(revisionValue)) as unknown as number[]; } catch { throw new RpcSenderError('boundary'); }
}

function validateArgs(rpc: RpcName, raw: unknown): Record<string, string | number | null | readonly string[] | readonly number[]> {
  const values = record(raw, MEMO_RPC_KEYS[rpc]);
  switch (rpc) {
    case 'memo_load_snapshot': return {};
    case 'memo_save': return { p_id: uuidValue(values.p_id), p_title: stringValue(values.p_title),
      p_body: stringValue(values.p_body), p_tag_ids: uuidArray(values.p_tag_ids),
      p_expected_revision: optionalRevision(values.p_expected_revision), p_request_id: uuidValue(values.p_request_id) };
    case 'memo_resolve_request': return { p_id: uuidValue(values.p_id), p_request_id: uuidValue(values.p_request_id),
      p_title: stringValue(values.p_title), p_body: stringValue(values.p_body), p_tag_ids: uuidArray(values.p_tag_ids),
      p_expected_revision: optionalRevision(values.p_expected_revision) };
    case 'memo_change_state': {
      const action = stringValue(values.p_action);
      if (!['pin', 'unpin', 'trash', 'restore'].includes(action)) throw new RpcSenderError('boundary');
      return { p_id: uuidValue(values.p_id), p_expected_revision: revisionValue(values.p_expected_revision),
        p_request_id: uuidValue(values.p_request_id), p_action: action };
    }
    case 'memo_delete_permanently': return { p_id: uuidValue(values.p_id), p_expected_revision: revisionValue(values.p_expected_revision) };
    case 'memo_empty_trash': {
      const ids = uuidArray(values.p_ids), revisions = revisionArray(values.p_revisions);
      if (ids.length !== revisions.length) throw new RpcSenderError('boundary');
      return { p_ids: ids, p_revisions: revisions };
    }
    case 'memo_save_tag': return { p_id: uuidValue(values.p_id), p_name: stringValue(values.p_name),
      p_expected_revision: optionalRevision(values.p_expected_revision) };
    case 'memo_delete_tag': return { p_id: uuidValue(values.p_id), p_expected_revision: revisionValue(values.p_expected_revision) };
  }
}

/**
 * C02の許可境界を製品sender用に固定した注入実装。
 * fetchPortはテストまたは後続の明示承認済みcomposition rootからのみ注入する。
 */
export function createMemoRpcSender(config: { origin: string; publishableKey: string; accessToken: string },
  fetchPort: RpcFetchPort): CloudTransport {
  const { origin, publishableKey, accessToken } = config;
  if (origin !== MEMO_RPC_ORIGIN || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)
    || typeof fetchPort !== 'function') throw new RpcSenderError('boundary');

  return async (rpc, args) => {
    let body: string;
    try {
      if (!Object.hasOwn(MEMO_RPC_KEYS, rpc)) throw new RpcSenderError('boundary');
      const values = validateArgs(rpc, args);
      body = JSON.stringify(values);
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
          headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body });
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

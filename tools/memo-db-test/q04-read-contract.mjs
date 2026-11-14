import { DEV_SANDBOX_PROJECT_REF } from './cli.mjs';
import { compareTagDeleteSnapshots } from './tag-delete-contract.mjs';

// 新しいAuth実装ではなく既存DB用CLIの読取ケース。製品SDK認定には使用しない。
const helpers = Object.freeze([
  ['memo_edge_spaces', {}], ['memo_trim_edges', { s: ' Q04 ' }],
  ['memo_valid_text', { s: 'Q04', field: 'title' }], ['memo_tag_key', { s: 'Q04' }],
]);
export const Q04_READ_LIMITS = Object.freeze({ auth: 1, rpc: 9, write: 0, requestMs: 15000, totalMs: 30000 });

/** 許可経路・引数はこのケース内で固定。資格情報は受け取るが結果/記録へ転送しない。 */
export function createQ04ReadCheck({ origin, key, fetchImpl, record, totalMs = 30000, requestMs = 15000 }) {
  let used = false;
  return {
    async run(credentials, approved = false) {
      if (used) return { schema: 'memo-q04-read-v1', state: 'stopped', reason: 'already-used' };
      used = true;
      let authCalls = 0, rpcCalls = 0, verifiedDenials = 0, stage = 'preflight', target = 'none';
      let httpStatus = null, responseCode = 'none';
      let token, userId, timer;
      const overall = new AbortController();
      const receipt = (state, reason) => ({ schema: 'memo-q04-read-v1', scope: 'db-cli-read-only',
        state, reason, stage, target, authCalls, rpcCalls, writeRpcCalls: 0, verifiedDenials, retryCount: 0,
        httpStatus, responseCode, singleRpc: 'unverified' });
      const journal = async value => { try { await record(Object.freeze({ ...value })); }
        catch { throw new Error('record-failed'); } };
      const request = async (path, body, authenticated = false) => {
        if (overall.signal.aborted) throw new Error('timeout');
        httpStatus = null; responseCode = 'none';
        // 記録失敗なら送らない。preparedは実行済み/未実行の証明ではない。
        await journal(receipt('running', 'prepared'));
        if (overall.signal.aborted) throw new Error('timeout');
        if (stage === 'auth') authCalls++; else rpcCalls++;
        const controller = new AbortController();
        const signal = AbortSignal.any([overall.signal, controller.signal]);
        let requestTimer;
        const deadline = new Promise((_, reject) => {
          requestTimer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, requestMs);
        });
        try {
          return await Promise.race([deadline, new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
          }), (async () => {
            const response = await fetchImpl(`${origin}${path}`, { method: 'POST', redirect: 'error', signal,
              headers: { apikey: key, 'Content-Type': 'application/json',
                ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
            if (response.redirected || response.url !== `${origin}${path}`) throw new Error('response-source');
            httpStatus = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
              ? response.status : null;
            let data;
            try { data = JSON.parse(await response.text()); } catch { throw new Error('invalid-response'); }
            responseCode = ['42501', 'PGRST202'].includes(data?.code) ? data.code : 'other';
            return { status: response.status, data };
          })()]);
        } finally { clearTimeout(requestTimer); controller.abort(); }
      };
      let result;
      try {
        if (!approved) { result = receipt('stopped', 'approval-required'); return result; }
        if (origin !== `https://${DEV_SANDBOX_PROJECT_REF}.supabase.co`
          || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key ?? '') || typeof fetchImpl !== 'function'
          || typeof record !== 'function' || !Number.isInteger(totalMs) || totalMs < 1 || totalMs > 30000
          || !Number.isInteger(requestMs) || requestMs < 1 || requestMs > 15000
          || typeof credentials?.email !== 'string' || !credentials.email
          || typeof credentials?.password !== 'string' || !credentials.password) {
          result = receipt('stopped', 'preflight'); return result;
        }
        timer = setTimeout(() => overall.abort(), totalMs);
        stage = 'auth';
        target = 'password-auth';
        const auth = await request('/auth/v1/token?grant_type=password',
          { email: credentials.email, password: credentials.password });
        credentials = undefined;
        if (auth.status !== 200 || typeof auth.data?.access_token !== 'string' || !auth.data.access_token
          || typeof auth.data?.user?.id !== 'string' || !auth.data.user.id) {
          result = receipt('stopped', 'auth-failed'); return result;
        }
        token = auth.data.access_token; userId = auth.data.user.id;
        // 認証後の一時応答からも継続参照を外す。JSメモリ完全消去の保証ではない。
        auth.data = undefined;
        for (const authenticated of [false, true]) {
          for (const [name, args] of helpers) {
            stage = authenticated ? 'helper-authenticated' : 'helper-anon';
            target = name;
            const response = await request(`/rest/v1/rpc/${name}`, args, authenticated);
            const expectedStatus = authenticated ? 403 : 401;
            if (response.status !== expectedStatus || response.data?.code !== '42501'
              || response.data?.message !== `permission denied for function ${name}`) {
              result = receipt(response.status >= 200 && response.status < 300 ? 'failed' : 'unknown',
                response.status >= 200 && response.status < 300 ? 'helper-executable' : 'denial-unconfirmed');
              return result;
            }
            verifiedDenials++;
            await journal(receipt('running', 'denial-verified'));
          }
        }
        stage = 'snapshot';
        target = 'memo_load_snapshot';
        const snapshot = await request('/rest/v1/rpc/memo_load_snapshot', {}, true);
        if (snapshot.status !== 200) { result = receipt('unknown', 'snapshot-http'); return result; }
        try {
          compareTagDeleteSnapshots(snapshot.data, snapshot.data);
          if (['memos', 'tags', 'memoTags'].some(collection =>
            snapshot.data[collection].some(row => row.user_id !== userId))) throw new Error();
        } catch { result = receipt('unknown', 'snapshot-invalid'); return result; }
        result = receipt('passed', 'read-checks-only');
        return result;
      } catch (error) {
        const reason = ['record-failed', 'timeout', 'response-source', 'invalid-response'].includes(error?.message)
          ? error.message : 'transport';
        result = receipt(authCalls + rpcCalls ? 'unknown' : 'stopped', reason);
        return result;
      } finally {
        clearTimeout(timer); overall.abort(); credentials = undefined; token = undefined; userId = undefined;
        // 終了記録失敗を成功扱いしない。返却する固定receiptだけを変更する。
        if (result && result.reason !== 'record-failed' && typeof record === 'function') {
          try { await journal(result); } catch { result.state = 'unknown'; result.reason = 'record-failed'; }
        }
      }
    },
  };
}

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { loadConfig, readPassword, requestJson } from './cli.mjs';
import { collectRecordedIds, freshId } from './resolve-missing-contract.mjs';
import { runPinCase } from './pin-contract.mjs';

async function question(text) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return await prompt.question(text); } finally { prompt.close(); }
}

// Match the common timeout/redirect policy and require the RPC's normal HTTP 200.
export function pinRpc(origin, headers, fetchImpl = fetch) {
  const allowed = new Set(['memo_save', 'memo_change_state', 'memo_load_snapshot', 'memo_resolve_request']);
  return async (name, payload) => {
    if (!allowed.has(name)) throw new Error('rpc');
    const response = await fetchImpl(`${origin}/rest/v1/rpc/${name}`, {
      method: 'POST', headers, body: JSON.stringify(payload),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 200) {
      try { await response.body?.cancel(); } catch {}
      throw new Error('unexpected HTTP');
    }
    return response.json();
  };
}

async function main() {
  let password = '', token, identity, writeNew, recorded = false, stage = '設定';
  try {
    const { origin, key } = await loadConfig();
    if (!process.stdin.isTTY || !process.stdout.isTTY || process.argv.length !== 2) throw new Error('invocation');
    console.log('dev-sandbox専用。最大RPC8回（save1・change_state2・snapshot4・resolve1）、別途認証1回。');
    console.log('pin/unpinの読み取り専用要求照合は検証不可。再送による代替確認は行いません。');
    stage = '認証';
    let email = (await question('テストユーザーのメールアドレス: ')).trim();
    if (!email) throw new Error('email');
    password = await readPassword();
    const auth = await requestJson(`${origin}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    email = ''; password = '';
    if (typeof auth?.access_token !== 'string' || !auth.access_token || typeof auth?.user?.id !== 'string' || !auth.user.id) throw new Error('auth');
    token = auth.access_token;
    stage = '識別記録';
    const directory = new URL('runs/', import.meta.url);
    await mkdir(directory, { recursive: true });
    const records = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.name.endsWith('.json')) continue;
      if (!entry.isFile()) throw new Error('record');
      records.push(JSON.parse(await readFile(new URL(entry.name, directory), 'utf8')));
    }
    const ids = collectRecordedIds(records);
    const runId = freshId(ids), memoId = freshId(ids), requestId = freshId(ids), pinRequestId = freshId(ids), unpinRequestId = freshId(ids);
    identity = { version: 1, test: 'pin-read', runId, memoId, requestId, pinRequestId, unpinRequestId,
      userId: auth.user.id, projectHost: new URL(origin).hostname, status: 'prepared',
      stateRequestResolution: 'not-verified-no-readonly-api', startedAt: new Date().toISOString() };
    writeNew = (suffix, value) => writeFile(new URL(`${runId}.pin${suffix}.json`, directory),
      JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await writeNew('', identity); recorded = true;
    console.log(`識別記録: tools/memo-db-test/runs/${runId}.pin.json`);
    const headers = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const result = await runPinCase({
      base: { p_id: memoId, p_request_id: requestId, p_expected_revision: null,
        p_title: `DBTEST-PIN-${runId}`, p_body: `pin test ${runId}`, p_tag_ids: [] },
      pinRequestId, unpinRequestId, userId: auth.user.id, rpc: pinRpc(origin, headers),
      setStage: (value) => { stage = value; },
      confirm: async (action, target) => {
        stage = `${action}確認`;
        const labels = { create: '専用メモ1件の新規作成', pin: '専用メモのピン留め（revision 1→2）',
          unpin: '専用メモのピン解除（revision 2→3）' };
        console.log(`対象: ${target} / ${labels[action]}。既存PASS対象は操作せず、専用メモは残ります。自動再送・削除・復旧なし。`);
        return await question(`続行は ${action.toUpperCase()} と入力: `) === action.toUpperCase();
      },
      progress: async (action, detail) => {
        stage = `${action}結果記録`;
        await writeNew(`.${action}.result`, { runId, memoId, action, ...detail, status: 'passed', completedAt: new Date().toISOString() });
        console.log(`PASS: ${action}・revision=${detail.revision}・応答とスナップショット一致`);
      },
    });
    await writeNew('.result', { ...identity, ...result, status: 'passed', completedAt: new Date().toISOString() });
    console.log('PASS: ピン留め・解除。専用メモ1件（revision=3、未ピン留め）を保持。pin/unpin要求照合は検証対象外。');
  } catch {
    if (recorded) {
      try { await writeNew('.failure', { runId: identity.runId, memoId: identity.memoId, stage, status: 'failed',
        stateRequestResolution: 'not-verified-no-readonly-api', completedAt: new Date().toISOString() }); }
      catch { console.log('FAIL: 失敗結果の保存に失敗。元の識別記録は保持。'); }
    }
    console.log(`FAIL: ${stage}。応答不明でも再送・復旧・削除しません。`);
    if (recorded) console.log('識別記録を保持しています。次の操作前に読み取り専用で状態を確認してください。');
    process.exitCode = 1;
  } finally { password = ''; token = undefined; }
}

// Importing this module for local tests never starts authentication or network access.
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.log('FAIL: ピンテスト終了。'); process.exitCode = 1; });
}

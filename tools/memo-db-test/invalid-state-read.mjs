import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { loadConfig, readPassword, requestJson } from './cli.mjs';
import { collectRecordedIds, freshId } from './resolve-missing-contract.mjs';
import { pinRpc } from './pin-read.mjs';
import { runInvalidStateCase, REJECTION_NAMES, invalidStateResponse } from './invalid-state-contract.mjs';

async function question(text) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return await prompt.question(text); } finally { prompt.close(); }
}
async function main() {
  let password = '', token, identity, writeNew, recorded = false, stage = '設定';
  try {
    const { origin, key } = await loadConfig();
    if (!process.stdin.isTTY || !process.stdout.isTTY || process.argv.length !== 2) throw new Error('invocation');
    console.log('dev-sandbox専用。最大RPC32回（save1・change_state14・snapshot16・resolve1）、確認15回、別途認証1回。');
    console.log('状態変更要求の読み取り専用照合・内部台帳の直接確認は対象外。');
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
    const runId = freshId(ids), memoId = freshId(ids), requestId = freshId(ids), trashRequestId = freshId(ids);
    const rejectionIds = Object.fromEntries(REJECTION_NAMES.map((name) => [name,freshId(ids)]));
    identity = { version: 1, test: 'invalid-state-read', runId, memoId, requestId, trashRequestId, rejectionIds,
      userId: auth.user.id, projectHost: new URL(origin).hostname, status: 'prepared',
      stateRequestResolution: 'not-verified-no-readonly-api', startedAt: new Date().toISOString() };
    writeNew = (suffix, value) => writeFile(new URL(`${runId}.invalid-state${suffix}.json`, directory),
      JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await writeNew('', identity); recorded = true;
    console.log(`識別記録: tools/memo-db-test/runs/${runId}.invalid-state.json`);
    const headers = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const result = await runInvalidStateCase({
      base: { p_id: memoId, p_request_id: requestId, p_expected_revision: null,
        p_title: `DBTEST-INVALID-STATE-${runId}`, p_body: `invalid state test ${runId}`, p_tag_ids: [] },
      trashRequestId, rejectionIds, userId: auth.user.id, rpc: pinRpc(origin, headers),
      reject: (payload) => invalidStateResponse(`${origin}/rest/v1/rpc/memo_change_state`,headers,payload),
      setStage: (value) => { stage = value; },
      confirm: async (action, target, payload) => {
        stage = `${action}確認`;
        const label = action==='create'?'専用メモ作成':action==='prepare-trash'?'準備用ゴミ箱移動（revision1→2）':'拒否期待の不正要求（誤成功時は専用メモが変化し得ます）';
        console.log(`対象: ${target} / ${action} / ${label}。既存PASS対象は操作しません。`);
        console.log(`状態操作の引数（作成時は本文・タイトルを省略）: ${JSON.stringify(payload)}`);
        console.log('正常終了時は専用メモをゴミ箱内に残します。自動再送・削除・復旧なし。');
        return await question(`続行は ${action.toUpperCase()} と入力: `) === action.toUpperCase();
      },
      progress: async (action, detail) => {
        stage = `${action}結果記録`;
        await writeNew(`.${action}.result`, { runId, memoId, action, ...detail, status: 'passed', completedAt: new Date().toISOString() });
        console.log(`PASS: ${action}・revision=${detail.revision}・応答とスナップショット一致`);
      },
    });
    await writeNew('.result', { ...identity, ...result, status: 'passed', completedAt: new Date().toISOString() });
    console.log('PASS: 不正要求13件の期待拒否・全データ不変。専用メモ1件をゴミ箱内・revision=2で保持。内部台帳・状態変更要求照合は検証対象外。');
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.log('FAIL: 不正操作・状態テスト終了。'); process.exitCode = 1; });
}

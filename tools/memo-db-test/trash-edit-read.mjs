import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { loadConfig, readPassword, requestJson } from './cli.mjs';
import { collectRecordedIds, freshId } from './resolve-missing-contract.mjs';
import { pinRpc } from './pin-read.mjs';
import { runTrashEditCase, trashEditResponse } from './trash-edit-contract.mjs';

async function question(text) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return await prompt.question(text); } finally { prompt.close(); }
}
async function main() {
  let password = '', token, identity, writeNew, recorded = false, stage = '設定';
  try {
    const { origin, key } = await loadConfig();
    if (!process.stdin.isTTY || !process.stdout.isTTY || process.argv.length !== 2) throw new Error('invocation');
    console.log('dev-sandbox専用。最大RPC9回（save2・change_state1・snapshot4・resolve2）、確認3回、別途認証1回。');
    console.log('最新revision=2でゴミ箱内メモのタイトル・本文編集を試行。タグ変更とサーバー側の拒否理由の区別は検証対象外。');
    console.log('ゴミ箱移動要求の読み取り専用照合は検証対象外。再送で代替しません。');
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
    const runId = freshId(ids), memoId = freshId(ids), requestId = freshId(ids), trashRequestId = freshId(ids), editRequestId = freshId(ids);
    identity = { version: 1, test: 'trash-edit-read', runId, memoId, requestId, trashRequestId, editRequestId,
      userId: auth.user.id, projectHost: new URL(origin).hostname, status: 'prepared',
      stateRequestResolution: 'not-verified-no-readonly-api', startedAt: new Date().toISOString() };
    writeNew = (suffix, value) => writeFile(new URL(`${runId}.trash-edit${suffix}.json`, directory),
      JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await writeNew('', identity); recorded = true;
    console.log(`識別記録: tools/memo-db-test/runs/${runId}.trash-edit.json`);
    const headers = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const result = await runTrashEditCase({
      base: { p_id: memoId, p_request_id: requestId, p_expected_revision: null,
        p_title: `DBTEST-TRASH-EDIT-${runId}`, p_body: `trash edit test ${runId}`, p_tag_ids: [] },
      trashRequestId, editRequestId, userId: auth.user.id, rpc: pinRpc(origin, headers),
      rejectEdit: (payload) => trashEditResponse(`${origin}/rest/v1/rpc/memo_save`,headers,payload),
      setStage: (value) => { stage = value; },
      confirm: async (action, target) => {
        stage = `${action}確認`;
        const labels={create:'新規専用メモ1件を作成',trash:'専用メモをゴミ箱へ移動（revision1→2）',
          edit:'新規requestId・expected_revision=2でタイトルと本文を変更試行。拒否期待。誤成功時も元に戻しません'};
        console.log(`対象: ${target} / ${labels[action]}。既存PASS対象は操作しません。`);
        console.log('専用メモをゴミ箱内に残します。自動再送・削除・復旧なし。');
        return await question(`続行は ${action.toUpperCase()} と入力: `) === action.toUpperCase();
      },
      progress: async (action, detail) => {
        stage = `${action}結果記録`;
        await writeNew(`.${action}.result`, { runId, memoId, action, ...detail, status: 'passed', completedAt: new Date().toISOString() });
        console.log(`PASS: ${action}・revision=${detail.revision}・応答とスナップショット一致`);
      },
    });
    await writeNew('.result', { ...identity, ...result, status: 'passed', completedAt: new Date().toISOString() });
    console.log('PASS: 最新revisionでゴミ箱内編集を期待拒否、全取得データ不変。専用メモ1件をゴミ箱内revision=2で保持。');
    console.log('拒否要求照合nullは未実行の証明ではありません。拒否理由はSQLの複合条件に基づく評価で、応答単独では区別できません。');
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
  main().catch(() => { console.log('FAIL: ゴミ箱内編集拒否テスト終了。'); process.exitCode = 1; });
}

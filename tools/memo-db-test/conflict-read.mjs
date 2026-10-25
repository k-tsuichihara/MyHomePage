import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { evaluateConflictResponse, verifyConflictUnchanged } from './conflict-response.mjs';
import { loadConfig, readPassword, requestJson } from './cli.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function check(value) { if (!value) throw new Error('verification failed'); }
async function question(message) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return await prompt.question(message); } finally { prompt.close(); }
}
async function record(name) {
  return JSON.parse(await readFile(new URL(`runs/${name}`, import.meta.url), 'utf8'));
}

async function main() {
  let stage = '設定・記録検証';
  let token;
  let password = '';
  let attemptCreated = false;
  try {
    const { origin, key } = await loadConfig();
    check(process.stdin.isTTY && process.stdout.isTTY);
    const updateRunId = process.argv[2];
    check(process.argv.length === 3 && UUID.test(updateRunId ?? ''));
    const update = await record(`${updateRunId}.update.json`);
    const updateResult = await record(`${updateRunId}.update.result.json`);
    check(update.version === 1 && update.test === 'update-read' && update.status === 'prepared'
      && update.runId === updateRunId && UUID.test(update.sourceRunId) && UUID.test(update.memoId)
      && UUID.test(update.requestId) && update.expectedRevision === 1
      && update.projectHost === new URL(origin).hostname && typeof update.userId === 'string');
    check(updateResult.version === 1 && updateResult.test === 'update-read' && updateResult.status === 'passed'
      && updateResult.runId === updateRunId && updateResult.sourceRunId === update.sourceRunId
      && updateResult.memoId === update.memoId && updateResult.requestId === update.requestId && updateResult.revision === 2);
    const creation = await record(`${update.sourceRunId}.json`);
    const creationResult = await record(`${update.sourceRunId}.result.json`);
    check(creation.version === 1 && creation.test === 'create-read' && creation.status === 'prepared'
      && creation.runId === update.sourceRunId && creation.memoId === update.memoId
      && creation.userId === update.userId && creation.projectHost === update.projectHost
      && UUID.test(creation.requestId) && creation.requestId !== update.requestId);
    check(creationResult.version === 1 && creationResult.test === 'create-read' && creationResult.status === 'passed'
      && creationResult.runId === creation.runId && creationResult.memoId === creation.memoId && creationResult.revision === 1);
    stage = '認証';
    const email = (await question('同じテストユーザーのメールアドレス: ')).trim();
    check(email.length > 0);
    password = await readPassword();
    const auth = await requestJson(`${origin}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    password = '';
    check(typeof auth?.access_token === 'string' && auth.access_token.length > 0 && auth?.user?.id === update.userId);
    token = auth.access_token;
    const headers = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const snapshot = async () => {
      const data = await requestJson(`${origin}/rest/v1/rpc/memo_load_snapshot`, { method: 'POST', headers, body: '{}' });
      check(data && Array.isArray(data.memos) && Array.isArray(data.tags) && Array.isArray(data.memoTags));
      return data;
    };
    stage = '競合要求前確認';
    const before = await snapshot();
    const matches = before.memos.filter((memo) => memo.id === update.memoId);
    check(matches.length === 1);
    const original = matches[0];
    check(original.user_id === update.userId && String(original.revision) === '2'
      && original.title === `DBTEST-${creation.runId}`
      && original.body === `update-read test ${updateRunId}\n正常更新・引用符 "・タブ\tを保持`
      && original.last_request_id === update.requestId && original.pinned_at === null && original.deleted_at === null
      && typeof original.created_at === 'string' && Number.isFinite(Date.parse(original.created_at))
      && typeof original.updated_at === 'string' && Date.parse(original.updated_at) > Date.parse(original.created_at));
    check(!before.memoTags.some((relation) => relation.memo_id === update.memoId));
    const answer = await question('古いrevision=1で更新を1回試みます。続行するには CONFLICT と入力: ');
    if (answer !== 'CONFLICT') { console.log('中止: 更新要求は送信していません。'); return; }
    const runId = randomUUID();
    const requestId = randomUUID();
    check(requestId !== creation.requestId && requestId !== update.requestId);
    stage = '競合識別記録の準備';
    const identity = { version: 1, test: 'conflict-read', runId, updateRunId, sourceRunId: creation.runId,
      memoId: update.memoId, requestId, userId: update.userId, projectHost: update.projectHost,
      expectedRevision: 1, observedRevision: 2, status: 'prepared', startedAt: new Date().toISOString() };
    await writeFile(new URL(`runs/${runId}.conflict.json`, import.meta.url), JSON.stringify(identity, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    attemptCreated = true;
    console.log(`識別記録: tools/memo-db-test/runs/${runId}.conflict.json`);
    const expectedError = await evaluateConflictResponse(`${origin}/rest/v1/rpc/memo_save`, {
      method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ p_id: update.memoId, p_title: original.title,
        p_body: `conflict-read test ${runId}\nこの本文は保存されてはいけません`,
        p_tag_ids: [], p_expected_revision: 1, p_request_id: requestId }),
    }, { fetchImpl: fetch, setStage: (value) => { stage = value; } });
    // 応答が成功や別エラーでも再読込して確認し、期待エラーとの両方が成立した場合のみPASS。
    stage = '再読み込み・不変照合';
    const after = await snapshot();
    verifyConflictUnchanged(before, after, update.memoId, expectedError);
    stage = 'PASS結果の記録';
    const result = { version: 1, test: 'conflict-read', runId, updateRunId, sourceRunId: creation.runId,
      memoId: update.memoId, requestId, status: 'passed', revision: 2,
      errorCode: 'PT409', httpStatus: 409, completedAt: new Date().toISOString() };
    await writeFile(new URL(`runs/${runId}.conflict.result.json`, import.meta.url), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log('PASS: 期待するrevision競合（HTTP 409・PT409）を確認。対象・対象外の全取得データ不変、revision=2維持。');
  } catch {
    console.log(`FAIL: ${stage}。自動再送・自動削除は行いません。`);
    if (attemptCreated) console.log('競合識別記録を保持しています。次の操作前に対象の状態を確認してください。');
    process.exitCode = 1;
  } finally { token = undefined; password = ''; }
}

main().catch(() => { console.log('FAIL: テストを終了しました。'); process.exitCode = 1; });


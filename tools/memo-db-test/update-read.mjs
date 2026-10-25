import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { isDeepStrictEqual } from 'node:util';
import { loadConfig, readPassword, requestJson } from './cli.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function check(value) { if (!value) throw new Error('verification failed'); }
async function question(message) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return await prompt.question(message); } finally { prompt.close(); }
}

async function main() {
  let stage = '設定・対象記録';
  let token;
  let password = '';
  let attemptCreated = false;
  try {
    const { origin, key } = await loadConfig();
    check(process.stdin.isTTY && process.stdout.isTTY);
    // 任意のファイルパスやメモIDを受け取らず、作成テストの実行UUIDだけを受け付ける。
    const sourceRunId = process.argv[2];
    check(process.argv.length === 3 && UUID.test(sourceRunId ?? ''));
    const source = JSON.parse(await readFile(new URL(`runs/${sourceRunId}.json`, import.meta.url), 'utf8'));
    const creation = JSON.parse(await readFile(new URL(`runs/${sourceRunId}.result.json`, import.meta.url), 'utf8'));
    check(source.version === 1 && source.test === 'create-read' && source.status === 'prepared'
      && source.runId === sourceRunId && UUID.test(source.memoId) && UUID.test(source.requestId)
      && typeof source.userId === 'string' && source.projectHost === new URL(origin).hostname);
    check(creation.version === 1 && creation.test === 'create-read' && creation.status === 'passed'
      && creation.runId === sourceRunId && creation.memoId === source.memoId && creation.revision === 1);
    stage = '認証';
    const email = (await question('作成時と同じテストユーザーのメールアドレス: ')).trim();
    check(email.length > 0);
    password = await readPassword();
    const auth = await requestJson(`${origin}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    password = '';
    check(typeof auth?.access_token === 'string' && auth.access_token.length > 0 && auth?.user?.id === source.userId);
    token = auth.access_token;
    const headers = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const snapshot = async () => {
      const data = await requestJson(`${origin}/rest/v1/rpc/memo_load_snapshot`, { method: 'POST', headers, body: '{}' });
      check(data && Array.isArray(data.memos) && Array.isArray(data.tags) && Array.isArray(data.memoTags));
      return data;
    };
    stage = '更新前確認';
    const before = await snapshot();
    const matches = before.memos.filter((memo) => memo.id === source.memoId);
    check(matches.length === 1);
    const original = matches[0];
    check(original.user_id === source.userId && String(original.revision) === '1'
      && original.title === `DBTEST-${sourceRunId}`
      && original.body === `create-read test ${sourceRunId}\n日本語・引用符 "・タブ\tを保持`
      && original.last_request_id === source.requestId && original.pinned_at === null && original.deleted_at === null
      && typeof original.created_at === 'string' && Number.isFinite(Date.parse(original.created_at))
      && original.updated_at === original.created_at);
    check(!before.memoTags.some((relation) => relation.memo_id === source.memoId));
    const confirmed = await question('確認したテストメモ1件の本文を更新します。続行するには UPDATE と入力: ');
    if (confirmed !== 'UPDATE') { console.log('中止: 更新要求は送信していません。'); return; }
    const runId = randomUUID();
    const requestId = randomUUID();
    const body = `update-read test ${runId}\n正常更新・引用符 "・タブ\tを保持`;
    const payload = { p_id: source.memoId, p_title: original.title, p_body: body,
      p_tag_ids: [], p_expected_revision: Number(original.revision), p_request_id: requestId };
    const identity = { version: 1, test: 'update-read', runId, sourceRunId, memoId: source.memoId,
      requestId, userId: source.userId, projectHost: source.projectHost,
      expectedRevision: 1, status: 'prepared', startedAt: new Date().toISOString() };
    stage = '更新識別記録の準備';
    await writeFile(new URL(`runs/${runId}.update.json`, import.meta.url), JSON.stringify(identity, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    attemptCreated = true;
    console.log(`識別記録: tools/memo-db-test/runs/${runId}.update.json`);
    stage = '更新要求（結果不明の可能性あり）';
    const saved = await requestJson(`${origin}/rest/v1/rpc/memo_save`, { method: 'POST', headers, body: JSON.stringify(payload) });
    const validUpdated = (memo) => {
      if (!memo || memo.body !== body || String(memo.revision) !== '2' || memo.last_request_id !== requestId
        || typeof memo.updated_at !== 'string' || !Number.isFinite(Date.parse(memo.updated_at))
        || Date.parse(memo.updated_at) <= Date.parse(original.updated_at)) return false;
      // 変更を許可する4項目以外は作成日時を含めすべて維持。
      const rest = ({ body: ignoredBody, revision: ignoredRevision, updated_at: ignoredTime, last_request_id: ignoredRequest, ...unchanged }) => unchanged;
      return isDeepStrictEqual(rest(memo), rest(original));
    };
    check(validUpdated(saved?.memo) && Array.isArray(saved.tagIds) && saved.tagIds.length === 0);
    stage = '再読み込み・照合';
    const after = await snapshot();
    const updated = after.memos.filter((memo) => memo.id === source.memoId);
    check(updated.length === 1 && validUpdated(updated[0]) && isDeepStrictEqual(updated[0], saved.memo));
    const others = (rows) => rows.filter((memo) => memo.id !== source.memoId).sort((a, b) => a.id.localeCompare(b.id));
    check(after.memos.length === before.memos.length && isDeepStrictEqual(others(after.memos), others(before.memos)));
    check(isDeepStrictEqual(after.tags, before.tags) && isDeepStrictEqual(after.memoTags, before.memoTags));
    stage = 'PASS結果の記録';
    const result = { version: 1, test: 'update-read', runId, sourceRunId, memoId: source.memoId,
      requestId, status: 'passed', revision: 2, completedAt: new Date().toISOString() };
    await writeFile(new URL(`runs/${runId}.update.result.json`, import.meta.url), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log('PASS: 本文更新一致、revision=2、作成日時・その他状態維持、更新日時更新、対象外データ不変。');
  } catch {
    console.log(`FAIL: ${stage}。自動再送・自動削除は行いません。`);
    if (attemptCreated) console.log('更新識別記録を保持しています。再実行前に対象の状態を確認してください。');
    process.exitCode = 1;
  } finally { token = undefined; password = ''; }
}

main().catch(() => { console.log('FAIL: テストを終了しました。'); process.exitCode = 1; });

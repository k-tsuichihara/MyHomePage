import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { isDeepStrictEqual } from 'node:util';
import { loadConfig, readPassword, requestJson } from './cli.mjs';

async function question(message) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return await prompt.question(message); }
  finally { prompt.close(); }
}

function check(condition) {
  if (!condition) throw new Error('verification failed');
}

function validInitialMemo(memo, payload, userId) {
  return memo && memo.id === payload.p_id && memo.user_id === userId
    && memo.title === payload.p_title && memo.body === payload.p_body
    && String(memo.revision) === '1' && memo.pinned_at === null && memo.deleted_at === null
    && memo.last_request_id === payload.p_request_id
    && typeof memo.created_at === 'string' && Number.isFinite(Date.parse(memo.created_at))
    && memo.created_at === memo.updated_at;
}

async function main() {
  let stage = '設定';
  let token;
  let password = '';
  let record;
  let recordPath;
  let recordCreated = false;
  try {
    const { origin, key } = await loadConfig();
    check(process.stdin.isTTY && process.stdout.isTTY);
    const confirmation = await question('dev-sandboxにテストメモ1件を作成し残します。続行するには CREATE と入力: ');
    if (confirmation !== 'CREATE') {
      console.log('中止: 保存要求は送信していません。');
      return;
    }
    stage = '認証';
    const email = (await question('テストユーザーのメールアドレス: ')).trim();
    check(email.length > 0);
    password = await readPassword();
    const auth = await requestJson(`${origin}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    password = '';
    check(typeof auth?.access_token === 'string' && auth.access_token.length > 0 && typeof auth?.user?.id === 'string');
    token = auth.access_token;
    const headers = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const snapshot = async () => {
      const data = await requestJson(`${origin}/rest/v1/rpc/memo_load_snapshot`, {
        method: 'POST', headers, body: '{}',
      });
      check(data && Array.isArray(data.memos) && Array.isArray(data.tags) && Array.isArray(data.memoTags));
      return data;
    };
    stage = '保存前読み込み';
    const before = await snapshot();
    const runId = randomUUID();
    const payload = {
      p_id: randomUUID(), p_request_id: randomUUID(), p_expected_revision: null,
      p_title: `DBTEST-${runId}`, p_body: `create-read test ${runId}\n日本語・引用符 "・タブ\tを保持`, p_tag_ids: [],
    };
    check(!before.memos.some((memo) => memo.id === payload.p_id));
    // 認証情報・メモ内容を含まない識別記録を、送信前に確保する。
    stage = '識別記録の準備';
    await mkdir(new URL('runs/', import.meta.url), { recursive: true });
    recordPath = new URL(`runs/${runId}.json`, import.meta.url);
    record = { version: 1, test: 'create-read', runId, memoId: payload.p_id,
      requestId: payload.p_request_id, userId: auth.user.id, projectHost: new URL(origin).hostname,
      startedAt: new Date().toISOString(), status: 'prepared' };
    await writeFile(recordPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    recordCreated = true;
    console.log(`識別記録: tools/memo-db-test/runs/${runId}.json`);
    // 応答消失・強制終了でも、preparedを「未実行」と断定しない。
    stage = '保存要求（結果不明の可能性あり）';
    const saved = await requestJson(`${origin}/rest/v1/rpc/memo_save`, {
      method: 'POST', headers, body: JSON.stringify(payload),
    });
    check(validInitialMemo(saved?.memo, payload, auth.user.id));
    check(Array.isArray(saved.tagIds) && saved.tagIds.length === 0);
    stage = '再読み込み・照合';
    const after = await snapshot();
    const matches = after.memos.filter((memo) => memo.id === payload.p_id);
    check(matches.length === 1 && validInitialMemo(matches[0], payload, auth.user.id));
    check(isDeepStrictEqual(matches[0], saved.memo));
    check(after.memos.length === before.memos.length + 1);
    // 他の行はIDで対応づけて比較する。取得順の変化は許容する。
    const byId = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
    check(isDeepStrictEqual(byId(after.memos.filter((memo) => memo.id !== payload.p_id)), byId(before.memos)));
    check(isDeepStrictEqual(after.tags, before.tags) && isDeepStrictEqual(after.memoTags, before.memoTags));
    stage = 'PASS結果の記録';
    const resultPath = new URL(`runs/${runId}.result.json`, import.meta.url);
    const resultRecord = { version: 1, test: 'create-read', runId, memoId: payload.p_id,
      status: 'passed', revision: 1, completedAt: new Date().toISOString() };
    await writeFile(resultPath, JSON.stringify(resultRecord, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log('PASS: 新規メモ1件、内容一致、revision=1、初期状態一致、既存データ不変。自動削除なし。');
  } catch {
    console.log(`FAIL: ${stage}。自動再送・自動削除は行いません。`);
    if (recordCreated) console.log('識別記録を保持しています。保存結果は再実行前に確認してください。');
    process.exitCode = 1;
  } finally { token = undefined; password = ''; }
}

main().catch(() => { console.log('FAIL: テストを終了しました。'); process.exitCode = 1; });

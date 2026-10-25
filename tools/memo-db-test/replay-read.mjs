import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { loadConfig, readPassword, requestJson } from './cli.mjs';
import { collectRecordedIds, freshId } from './resolve-missing-contract.mjs';
import { runReplayCase } from './replay-contract.mjs';

async function question(message) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return await prompt.question(message); } finally { prompt.close(); }
}
async function main() {
  let stage = '設定';
  let password = '';
  let token;
  let prepared = false;
  try {
    const { origin, key } = await loadConfig();
    if (!process.stdin.isTTY || !process.stdout.isTTY || process.argv.length !== 2) throw new Error('invalid invocation');
    if (await question('dev-sandboxに専用メモ1件を作成し、同一保存要求を1回再送します。メモは残ります。続行するには REPLAY と入力: ') !== 'REPLAY') {
      console.log('中止: 通信していません。'); return;
    }
    stage = '認証';
    let email = (await question('テストユーザーのメールアドレス: ')).trim();
    if (!email) throw new Error('missing email');
    password = await readPassword();
    const auth = await requestJson(`${origin}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    password = ''; email = '';
    if (typeof auth?.access_token !== 'string' || !auth.access_token || typeof auth?.user?.id !== 'string' || !auth.user.id) throw new Error('invalid auth');
    token = auth.access_token;
    stage = '識別記録の準備';
    await mkdir(new URL('runs/', import.meta.url), { recursive: true });
    const records = [];
    for (const entry of await readdir(new URL('runs/', import.meta.url), { withFileTypes: true })) {
      if (!entry.name.endsWith('.json')) continue;
      if (!entry.isFile()) throw new Error('invalid record');
      records.push(JSON.parse(await readFile(new URL(`runs/${entry.name}`, import.meta.url), 'utf8')));
    }
    const ids = collectRecordedIds(records);
    const runId = freshId(ids); const memoId = freshId(ids); const requestId = freshId(ids);
    const submitted = { p_id: memoId, p_request_id: requestId, p_expected_revision: null,
      p_title: `DBTEST-REPLAY-${runId}`, p_body: `replay test ${runId}\n引用符 "・タブ\tを保持`, p_tag_ids: [] };
    const identity = { version: 1, test: 'replay-read', runId, memoId, requestId, userId: auth.user.id,
      projectHost: new URL(origin).hostname, status: 'prepared', startedAt: new Date().toISOString() };
    await writeFile(new URL(`runs/${runId}.replay.json`, import.meta.url), JSON.stringify(identity, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    prepared = true;
    console.log(`識別記録: tools/memo-db-test/runs/${runId}.replay.json`);
    const headers = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    await runReplayCase({ submitted, userId: auth.user.id,
      setStage: (value) => { stage = value; },
      snapshot: () => requestJson(`${origin}/rest/v1/rpc/memo_load_snapshot`, { method: 'POST', headers, body: '{}' }),
      save: (body) => requestJson(`${origin}/rest/v1/rpc/memo_save`, { method: 'POST', headers, body }),
    });
    stage = 'PASS結果記録';
    const result = { version: 1, test: 'replay-read', runId, memoId, requestId, status: 'passed',
      revision: 1, saveCalls: 2, completedAt: new Date().toISOString() };
    await writeFile(new URL(`runs/${runId}.replay.result.json`, import.meta.url), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log('PASS: 同一要求の再送結果一致、revision=1・日時・全取得データ不変。専用メモ1件を保持。');
  } catch {
    console.log(`FAIL: ${stage}。追加の再試行・自動削除は行いません。`);
    if (prepared) console.log('識別記録を保持しています。再実行前に対象を確認してください。');
    process.exitCode = 1;
  } finally { password = ''; token = undefined; }
}
main().catch(() => { console.log('FAIL: 再送テストを終了しました。'); process.exitCode = 1; });

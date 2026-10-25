import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { loadConfig, readPassword, requestJson } from './cli.mjs';
import { collectRecordedIds, freshId, missingSubmitted, verifyMissingOnce } from './resolve-missing-contract.mjs';

async function inventory() {
  const directory = new URL('runs/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue;
    if (!entry.isFile()) throw new Error('invalid record entry');
    records.push(JSON.parse(await readFile(new URL(`runs/${entry.name}`, import.meta.url), 'utf8')));
  }
  return collectRecordedIds(records);
}
async function main() {
  let stage = '設定・既存記録確認';
  let password = '';
  let token;
  let created = false;
  try {
    const { origin, key } = await loadConfig();
    if (!process.stdin.isTTY || !process.stdout.isTTY || process.argv.length !== 2) throw new Error('invalid invocation');
    await inventory(); // 不正JSON・読取失敗時は認証前に停止。
    stage = '認証';
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    let email;
    try { email = (await prompt.question('dev-sandboxテストユーザーのメールアドレス: ')).trim(); }
    finally { prompt.close(); }
    if (!email) throw new Error('missing email');
    password = await readPassword();
    const auth = await requestJson(`${origin}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    password = ''; email = '';
    if (typeof auth?.access_token !== 'string' || !auth.access_token || typeof auth?.user?.id !== 'string' || !auth.user.id) throw new Error('invalid auth');
    token = auth.access_token;
    stage = '新規識別記録';
    const reserved = await inventory();
    const runId = freshId(reserved);
    const requestId = freshId(reserved);
    const memoId = freshId(reserved);
    const submitted = missingSubmitted(memoId, requestId);
    const identity = { version: 1, test: 'resolve-missing', runId, requestId, memoId,
      userId: auth.user.id, projectHost: new URL(origin).hostname, status: 'prepared', startedAt: new Date().toISOString() };
    await writeFile(new URL(`runs/${runId}.missing.json`, import.meta.url), JSON.stringify(identity, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    created = true;
    console.log(`識別記録: tools/memo-db-test/runs/${runId}.missing.json`);
    stage = '未記録要求の照合';
    await verifyMissingOnce(origin, key, token, submitted, requestJson);
    stage = 'PASS結果記録';
    const result = { version: 1, test: 'resolve-missing', runId, requestId, memoId,
      status: 'passed', response: null, completedAt: new Date().toISOString() };
    await writeFile(new URL(`runs/${runId}.missing.result.json`, import.meta.url), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log('PASS: HTTP成功かつ照合結果がnull。DB書き込みなし。');
  } catch {
    console.log(`FAIL: ${stage}。自動再試行・DB書き込みは行いません。`);
    if (created) console.log('新規識別記録は保持しています。');
    process.exitCode = 1;
  } finally {
    password = ''; token = undefined;
    console.log('注意: nullは未実行の証明ではありません。');
  }
}
main().catch(() => { console.log('FAIL: 未記録要求照合を終了しました。'); process.exitCode = 1; });

import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { loadConfig, readPassword, requestJson } from './cli.mjs';
import { validateRunId, buildSubmitted, verifyResolved, resolveOnce } from './resolve-contract.mjs';

async function readRecord(name) {
  return JSON.parse(await readFile(new URL(`runs/${name}`, import.meta.url), 'utf8'));
}
async function main() {
  let stage = '設定・記録照合';
  let password = '';
  let token;
  try {
    const { origin, key } = await loadConfig();
    if (!process.stdin.isTTY || !process.stdout.isTTY || process.argv.length !== 3) throw new Error('invalid invocation');
    const updateRunId = process.argv[2];
    validateRunId(updateRunId);
    const update = await readRecord(`${updateRunId}.update.json`);
    validateRunId(update.sourceRunId);
    const records = { update,
      updateResult: await readRecord(`${updateRunId}.update.result.json`),
      creation: await readRecord(`${update.sourceRunId}.json`),
      creationResult: await readRecord(`${update.sourceRunId}.result.json`) };
    const submitted = buildSubmitted(updateRunId, records, new URL(origin).hostname);
    stage = '認証';
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    let email;
    try { email = (await prompt.question('更新時と同じテストユーザーのメールアドレス: ')).trim(); }
    finally { prompt.close(); }
    if (!email) throw new Error('missing email');
    password = await readPassword();
    const auth = await requestJson(`${origin}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    password = ''; email = '';
    if (typeof auth?.access_token !== 'string' || !auth.access_token || auth?.user?.id !== update.userId) throw new Error('auth mismatch');
    token = auth.access_token;
    stage = '保存結果照合RPC';
    const response = await resolveOnce(origin, key, token, submitted, requestJson);
    stage = '過去保存結果の検証';
    verifyResolved(response, submitted, update.userId);
    stage = 'PASS結果の記録';
    const runId = randomUUID();
    const result = { version: 1, test: 'resolve-read', runId, updateRunId, sourceRunId: update.sourceRunId,
      memoId: update.memoId, requestId: update.requestId, status: 'passed', revision: 2,
      completedAt: new Date().toISOString() };
    await writeFile(new URL(`runs/${runId}.resolve.result.json`, import.meta.url), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log('PASS: 更新要求の保存結果・revision=2・初期状態を照合。DB書き込みなし。');
    console.log(`結果記録: tools/memo-db-test/runs/${runId}.resolve.result.json`);
  } catch {
    console.log(`FAIL: ${stage}。自動再送・DB書き込みは行いません。`);
    process.exitCode = 1;
  } finally {
    password = ''; token = undefined;
    console.log('注意: 過去の保存結果の確認です。現在のDB状態・日時の完全一致を証明しません。');
  }
}
main().catch(() => { console.log('FAIL: 照合を終了しました。'); process.exitCode = 1; });

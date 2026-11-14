import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { loadConfig, readPassword } from './cli.mjs';
import { createQ04ReadCheck, Q04_READ_LIMITS } from './q04-read-contract.mjs';

async function main() {
  if (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('Q04: 対話型ターミナルから引数なしで起動してください。');
    process.exitCode = 1; return;
  }
  // 既存の固定環境/公開キー検査を再利用。設定を表示しない。
  const config = await loadConfig();
  console.log('Q04読取確認（未承認の間は実行禁止）。S04適用と本読取試験は別承認です。');
  console.log(`Auth上限${Q04_READ_LIMITS.auth}、RPC上限${Q04_READ_LIMITS.rpc}（helper拒否8 + snapshot1）、write 0。15秒/要求、全体30秒。`);
  console.log('通常Authの合成テストユーザーのみ。UNKNOWN/失敗時は停止、再実行は別承認。製品SDK試験ではありません。');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let approved;
  try { approved = await prompt.question('個別承認済みの場合だけ Q04-READ と入力: '); }
  finally { prompt.close(); }
  if (approved !== 'Q04-READ') { console.log('STOP（通信0）'); return; }
  let email, password;
  try {
    email = await readPassword('合成テストユーザーemail（非表示）: ');
    password = await readPassword();
    const directory = new URL(`runs/q04-read/${randomUUID()}/`, import.meta.url);
    const s04SqlSha256 = createHash('sha256').update(await readFile(
      new URL('../memo/tests/db-audit/s04-helper-execute.sql', import.meta.url))).digest('hex');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let sequence = 0;
    const check = createQ04ReadCheck({ ...config, fetchImpl: globalThis.fetch,
      record: async value => writeFile(new URL(`${String(sequence++).padStart(3, '0')}.json`, directory),
        JSON.stringify({ ...value, recordedAt: new Date().toISOString(), s04SqlSha256 }, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 }) });
    const pending = check.run({ email, password }, true);
    email = undefined; password = undefined;
    const result = await pending;
    console.log(JSON.stringify(result));
    console.log('サニタイズ済み記録: runs/q04-read/（Git/公開対象外で保持）。');
    if (result.state !== 'passed') process.exitCode = 1;
  } finally { email = undefined; password = undefined; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Q04: STOP（設定/入力/記録失敗。詳細非表示、再試行禁止）'); process.exitCode = 1; });
}

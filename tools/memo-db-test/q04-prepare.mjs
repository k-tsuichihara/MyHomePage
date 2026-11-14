import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** 既存S04 SQLをそのまま包むだけ。SQL実行・設定読取・DB接続は一切行わない。 */
export function prepareS04(source) {
  return {
    sql: `-- Q04個別承認後のみdev-sandboxで実行。自動再送禁止。\nBEGIN;\nSET LOCAL statement_timeout = '15s';\nSET LOCAL lock_timeout = '3s';\n${source}\nCOMMIT;\n`,
    metadata: { schema: 'memo-q04-apply-v1', applied: false, environment: 'dev-sandbox',
      sourceSha256: createHash('sha256').update(source).digest('hex'), statementTimeoutMs: 15000, lockTimeoutMs: 3000 },
  };
}

async function main() {
  if (process.argv.length !== 2) throw new Error('arguments');
  const source = await readFile(new URL('../memo/tests/db-audit/s04-helper-execute.sql', import.meta.url), 'utf8');
  const prepared = prepareS04(source);
  const directory = new URL(`runs/q04-prepared/${randomUUID()}/`, import.meta.url);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(new URL('s04-apply.sql', directory), prepared.sql, { flag: 'wx', mode: 0o600 });
  await writeFile(new URL('manifest.json', directory), JSON.stringify(prepared.metadata, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
  console.log('SQLファイル生成のみ。実行・適用はしていません。個別承認までは実行禁止。');
  console.log(new URL('s04-apply.sql', directory).pathname);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Q04: 準備失敗（詳細非表示、SQL未実行）'); process.exitCode = 1; });
}

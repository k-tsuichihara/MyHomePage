import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { loadConfig, readPassword, requestJson } from './cli.mjs';
import { collectRecordedIds, freshId } from './resolve-missing-contract.mjs';
import { runUsedIdCase } from './used-id-contract.mjs';
async function question(text) {
  const r = createInterface({ input: process.stdin, output: process.stdout });
  try { return await r.question(text); } finally { r.close(); }
}
async function main() {
  let stage = '設定'; let password = ''; let token; let recorded = false;
  try {
    const { origin, key } = await loadConfig();
    if (!process.stdin.isTTY || !process.stdout.isTTY || process.argv.length !== 2) throw new Error('invalid invocation');
    stage = '認証';
    let email = (await question('テストユーザーのメールアドレス: ')).trim();
    if (!email) throw new Error('email');
    password = await readPassword();
    const auth = await requestJson(`${origin}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    email = ''; password = '';
    if (!auth?.access_token || typeof auth.access_token !== 'string' || !auth?.user?.id) throw new Error('auth');
    token = auth.access_token;
    stage = '識別記録';
    await mkdir(new URL('runs/', import.meta.url), { recursive: true });
    const records = [];
    for (const entry of await readdir(new URL('runs/', import.meta.url), { withFileTypes: true })) {
      if (!entry.name.endsWith('.json')) continue;
      if (!entry.isFile()) throw new Error('record');
      records.push(JSON.parse(await readFile(new URL(`runs/${entry.name}`, import.meta.url), 'utf8')));
    }
    const ids = collectRecordedIds(records);
    const runId = freshId(ids), memoId = freshId(ids), secondRequestId = freshId(ids), requestId = freshId(ids);
    const identity = { version: 1, test: 'used-id-read', runId, memoId, secondRequestId, requestId,
      userId: auth.user.id, projectHost: new URL(origin).hostname, status: 'prepared', startedAt: new Date().toISOString() };
    const writeNew = (suffix, value) => writeFile(new URL(`runs/${runId}.used-id${suffix}.json`, import.meta.url), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await writeNew('', identity); recorded = true;
    console.log(`識別記録: tools/memo-db-test/runs/${runId}.used-id.json`);
    const headers = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const labels = { create: '新規専用メモ1件を作成（残ります）', reuse: '同じ専用メモID・別requestIdで作成を試行（拒否を期待、成功時は状態変更の可能性）。削除なし' };
    await runUsedIdCase({
      base: { p_id: memoId, p_request_id: requestId, p_expected_revision: null, p_title: `DBTEST-USED-ID-${runId}`, p_body: `used-id test ${runId}`, p_tag_ids: [] },
      secondRequestId, userId: auth.user.id, setStage: (s) => { stage = s; },
      confirm: async (kind, target) => {
        console.log(`対象: ${target} / ${labels[kind]}。既存PASS対象・他ユーザーは操作しません。`);
        return await question(`続行は ${kind.toUpperCase()} と入力: `) === kind.toUpperCase();
      },
      snapshot: () => requestJson(`${origin}/rest/v1/rpc/memo_load_snapshot`, { method: 'POST', headers, body: '{}' }),
      rpc: async (name, payload, rejection = false) => {
        if (name !== 'memo_save') throw new Error('rpc');
        if (!rejection) return requestJson(`${origin}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(payload) });
        const response = await fetch(`${origin}/rest/v1/rpc/${name}`, {
          method: 'POST', headers, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(15000),
        });
        if (response.ok) { try { await response.body?.cancel(); } catch {} throw new Error('unexpected success'); }
        return { status: response.status, error: await response.json() };
      },
      progress: async (kind) => {
        await writeNew(`.${kind}.result`, { version: 1, test: 'used-id-read', runId, memoId, secondRequestId, requestId,
          case: kind, status: 'passed', completedAt: new Date().toISOString() });
        console.log(`PASS: ${kind}（${kind === 'create' ? '専用メモ作成確認' : '期待拒否・全取得データ不変'}）`);
      },
    });
    await writeNew('.result', { ...identity, status: 'passed', completedAt: new Date().toISOString() });
    console.log('PASS: HTTP409・PT409・使用済みID拒否、全取得データ不変。専用メモ1件を保持。');
  } catch {
    console.log(`FAIL: ${stage}。再試行・自動復旧・削除は行いません。`);
    if (recorded) console.log('識別記録を保持。再実行前に専用IDの状態を確認してください。');
    process.exitCode = 1;
  } finally { password = ''; token = undefined; }
}
main().catch(() => { console.log('FAIL: 使用済みIDテスト終了。'); process.exitCode = 1; });


import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { loadConfig, readPassword, requestJson } from './cli.mjs';
import { collectRecordedIds, freshId } from './resolve-missing-contract.mjs';
import { runConcurrentCase, sendTimed } from './concurrent-contract.mjs';

async function question(text) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return await prompt.question(text); } finally { prompt.close(); }
}
async function main() {
  let password = '', token, writeNew, identity, recorded = false;
  let stage = '設定';
  try {
    const { origin, key } = await loadConfig();
    if (!process.stdin.isTTY || !process.stdout.isTTY || process.argv.length !== 2) throw new Error('invocation');
    stage = '認証';
    let email = (await question('テストユーザーのメールアドレス: ')).trim();
    if (!email) throw new Error('email');
    password = await readPassword();
    const auth = await requestJson(`${origin}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    email = ''; password = '';
    if (typeof auth?.access_token !== 'string' || !auth.access_token || typeof auth?.user?.id !== 'string') throw new Error('auth');
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
    const runId = freshId(ids), memoId = freshId(ids), requestId = freshId(ids), requestA = freshId(ids), requestB = freshId(ids);
    identity = { version: 1, test: 'concurrent-read', runId, memoId, requestId, requestA, requestB,
      userId: auth.user.id, projectHost: new URL(origin).hostname, status: 'prepared', expectedRevision: 1,
      startedAt: new Date().toISOString() };
    writeNew = (suffix, value) => writeFile(new URL(`${runId}.concurrent${suffix}.json`, directory),
      JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await writeNew('', identity); recorded = true;
    console.log(`識別記録: tools/memo-db-test/runs/${runId}.concurrent.json`);
    const headers = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const rpc = (name, payload) => requestJson(`${origin}/rest/v1/rpc/${name}`, {
      method: 'POST', headers, body: JSON.stringify(payload),
    });
    const result = await runConcurrentCase({
      base: { p_id: memoId, p_request_id: requestId, p_expected_revision: null,
        p_title: `DBTEST-CONCURRENT-${runId}`, p_body: `concurrent initial ${runId}`, p_tag_ids: [] },
      requestA, requestB, userId: auth.user.id,
      snapshot: () => { stage = 'スナップショット'; return rpc('memo_load_snapshot', {}); },
      save: (payload) => { stage = '専用メモ作成'; return rpc('memo_save', payload); },
      resolve: (payload) => { stage = '要求照合'; return rpc('memo_resolve_request', payload); },
      send: (body) => { stage = '並行更新応答'; return sendTimed(`${origin}/rest/v1/rpc/memo_save`, headers, body); },
      confirm: async (kind, target) => {
        console.log(`対象: ${target} / ${kind === 'create' ? '専用メモ1件を作成' : 'A/B各1回を並行更新、同じrevision=1、どちらか一方の成功を期待'}。`);
        console.log('最大RPC8回（save3・snapshot3・resolve2）。既存PASS対象は操作せず、専用メモは残ります。自動再送・復旧・削除なし。');
        return await question(`続行は ${kind.toUpperCase()} と入力: `) === kind.toUpperCase();
      },
      progress: async (kind, detail) => {
        stage = `${kind}記録`;
        await writeNew(`.${kind}`, { runId, memoId, stage: kind, ...detail, recordedAt: new Date().toISOString() });
        if (kind === 'responses') {
          for (let i = 0; i < detail.outcomes.length; i++) {
            const r = detail.outcomes[i];
            console.log(`${i === 0 ? 'A' : 'B'}: 分類=${r.kind} HTTP=${r.status ?? '不明'} 所要ms=${r.timing?.durationMs ?? '不明'}`);
            for (const line of r.diagnostics ?? []) console.log(line);
          }
          console.log(`通信期間重複: ${detail.overlap === true ? '確認' : '未確認・要再設計'}。DB内部の同時実行・ロック待ちは証明しません。`);
        }
      },
    });
    await writeNew('.result', { ...identity, ...result, status: 'passed', completedAt: new Date().toISOString() });
    console.log(`PASS: ${result.winner}成功、他方は期待競合。revision=2・全状態・要求照合を確認。競合側nullは未実行の証明ではありません。`);
  } catch {
    if (recorded) {
      try { await writeNew('.failure', { runId: identity.runId, memoId: identity.memoId, status: 'failed', stage,
        completedAt: new Date().toISOString() }); } catch { console.log('FAIL: 失敗結果の新規保存に失敗。元の識別記録は保持。'); }
    }
    console.log(`FAIL: ${stage}。応答不明・タイムアウトはPASSにしません。自動再送・復旧・削除なし。`);
    if (recorded) console.log('識別記録を保持しています。次の操作前に読み取り専用で状態を確認してください。');
    process.exitCode = 1;
  } finally { password = ''; token = undefined; }
}
main().catch(() => { console.log('FAIL: 同時更新テスト終了。'); process.exitCode = 1; });

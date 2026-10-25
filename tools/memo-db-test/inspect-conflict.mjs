import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { loadConfig, readPassword } from './cli.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
class DiagnosticError extends Error {
  constructor(kind, status) { super(kind); this.kind = kind; this.status = status; }
}
function check(value) { if (!value) throw new DiagnosticError('検証不一致'); }
function report(label, passed) {
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${label}`);
  if (!passed) process.exitCode = 1;
}
async function readRecord(name) {
  let raw;
  try { raw = await readFile(new URL(`runs/${name}`, import.meta.url), 'utf8'); }
  catch { throw new DiagnosticError('記録ファイル読み取り失敗'); }
  try {
    const value = JSON.parse(raw);
    check(value && typeof value === 'object' && !Array.isArray(value));
    return value;
  } catch { throw new DiagnosticError('記録JSON解析・形式失敗'); }
}

// 呼び出し先は2種類に固定。任意URL・任意RPCを受け付けない。
async function request(origin, key, kind, payload, token) {
  check(kind === 'login' || kind === 'snapshot');
  const path = kind === 'login' ? '/auth/v1/token?grant_type=password' : '/rest/v1/rpc/memo_load_snapshot';
  let response;
  try {
    response = await fetch(`${origin}${path}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
    });
  } catch { throw new DiagnosticError('通信失敗（タイムアウト・TLS・リダイレクト等）'); }
  if (!response.ok) {
    // 応答本文・エラーメッセージは表示も保存もしない。
    try { await response.body?.cancel(); } catch { /* HTTPエラーを優先する */ }
    throw new DiagnosticError('HTTPエラー', response.status);
  }
  let text;
  try { text = await response.text(); }
  catch { throw new DiagnosticError('通信失敗（応答本文の受信）'); }
  try { return JSON.parse(text); }
  catch { throw new DiagnosticError('応答JSON解析失敗'); }
}

async function main() {
  let stage = '設定';
  let token;
  let password = '';
  let email = '';
  try {
    const { origin, key } = await loadConfig();
    check(process.stdin.isTTY && process.stdout.isTTY);
    stage = '記録照合';
    const conflictRunId = process.argv[2];
    check(process.argv.length === 3 && UUID.test(conflictRunId ?? ''));
    const conflict = await readRecord(`${conflictRunId}.conflict.json`);
    check(conflict.version === 1 && conflict.test === 'conflict-read' && conflict.status === 'prepared'
      && conflict.runId === conflictRunId && UUID.test(conflict.updateRunId) && UUID.test(conflict.sourceRunId)
      && UUID.test(conflict.memoId) && UUID.test(conflict.requestId)
      && typeof conflict.userId === 'string' && conflict.expectedRevision === 1 && conflict.observedRevision === 2
      && conflict.projectHost === new URL(origin).hostname);
    const update = await readRecord(`${conflict.updateRunId}.update.json`);
    const updateResult = await readRecord(`${conflict.updateRunId}.update.result.json`);
    const creation = await readRecord(`${conflict.sourceRunId}.json`);
    const creationResult = await readRecord(`${conflict.sourceRunId}.result.json`);
    check(update.version === 1 && update.test === 'update-read' && update.status === 'prepared'
      && update.runId === conflict.updateRunId && update.sourceRunId === conflict.sourceRunId
      && update.memoId === conflict.memoId && update.userId === conflict.userId
      && update.projectHost === conflict.projectHost && UUID.test(update.requestId) && update.expectedRevision === 1);
    check(updateResult.version === 1 && updateResult.test === 'update-read' && updateResult.status === 'passed'
      && updateResult.runId === update.runId && updateResult.sourceRunId === update.sourceRunId
      && updateResult.memoId === update.memoId && updateResult.requestId === update.requestId && updateResult.revision === 2);
    check(creation.version === 1 && creation.test === 'create-read' && creation.status === 'prepared'
      && creation.runId === conflict.sourceRunId && creation.memoId === conflict.memoId
      && creation.userId === conflict.userId && creation.projectHost === conflict.projectHost && UUID.test(creation.requestId));
    check(creationResult.version === 1 && creationResult.test === 'create-read' && creationResult.status === 'passed'
      && creationResult.runId === creation.runId && creationResult.memoId === creation.memoId && creationResult.revision === 1);
    check(new Set([creation.requestId, update.requestId, conflict.requestId]).size === 3);
    report('作成・更新PASS結果と競合識別記録の対応', true);
    stage = '認証';
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try { email = (await prompt.question('同じテストユーザーのメールアドレス: ')).trim(); }
    finally { prompt.close(); }
    check(email.length > 0);
    password = await readPassword();
    const auth = await request(origin, key, 'login', { email, password });
    password = ''; email = '';
    check(typeof auth?.access_token === 'string' && auth.access_token.length > 0 && auth?.user?.id === conflict.userId);
    token = auth.access_token;
    report('認証・記録の所有者一致', true);
    stage = '読み取りRPC';
    const snapshot = await request(origin, key, 'snapshot', {}, token);
    check(snapshot && Array.isArray(snapshot.memos) && Array.isArray(snapshot.tags) && Array.isArray(snapshot.memoTags));
    report('読み取りRPC・応答形式', true);
    stage = '現在状態';
    const matches = snapshot.memos.filter((memo) => memo?.id === conflict.memoId);
    report('対象メモが1件存在', matches.length === 1);
    if (matches.length !== 1) return;
    const memo = matches[0];
    report('対象所有者・テストタイトル一致', memo.user_id === conflict.userId && memo.title === `DBTEST-${creation.runId}`);
    report('revision=2', String(memo.revision) === '2');
    report('本文が正常更新後の期待値と一致', memo.body === `update-read test ${update.runId}\n正常更新・引用符 "・タブ\tを保持`);
    report('last_request_idが正常更新要求と一致', memo.last_request_id === update.requestId);
    report('ピン未設定', memo.pinned_at === null);
    report('ゴミ箱外', memo.deleted_at === null);
    report('対象のタグ関連なし', !snapshot.memoTags.some((relation) => relation?.memo_id === conflict.memoId));
  } catch (error) {
    const detail = error instanceof DiagnosticError ? error.kind : '設定・対話入力失敗';
    const status = error instanceof DiagnosticError && Number.isInteger(error.status) ? ` HTTP ${error.status}` : '';
    console.log(`FAIL: ${stage} — ${detail}${status}`);
    process.exitCode = 1;
  } finally {
    token = undefined; password = ''; email = '';
    console.log('注意: これは現在状態の確認のみです。競合テストをPASSへ変更しません。');
    console.log('限界: 要求前のDB日時を保存していないため、日時の完全な不変は証明できません。');
  }
}

main().catch(() => { console.log('FAIL: 状態確認を終了しました。'); process.exitCode = 1; });

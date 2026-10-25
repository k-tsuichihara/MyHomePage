import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConflictResponse, verifyConflictUnchanged } from './conflict-response.mjs';

// 誤って実fetchを使用した場合も、ネットワークへ進ませない。
globalThis.fetch = () => { throw new Error('real network forbidden'); };
const expected = { code: 'PT409', message: 'memo revision conflict' };
const options = { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), body: '{}' };
async function simulate(fetchImpl) {
  const logs = [];
  const stages = [];
  let accepted;
  let failed = false;
  try {
    accepted = await evaluateConflictResponse('https://local-mock.invalid/', options,
      { fetchImpl, log: (line) => logs.push(line), setStage: (stage) => stages.push(stage) });
  } catch { failed = true; }
  return { logs, stages, accepted, failed };
}
function reply(value, status = 409) {
  return async () => new Response(typeof value === 'string' ? value : JSON.stringify(value), { status });
}

test('期待競合JSONとHTTP状態を認識し、1回だけ要求する', async () => {
  let calls = 0;
  const result = await simulate(async (url, received) => {
    calls++;
    assert.equal(url, 'https://local-mock.invalid/');
    assert.equal(received, options);
    return new Response(JSON.stringify(expected), { status: 409 });
  });
  assert.equal(calls, 1);
  assert.equal(result.failed, false);
  assert.equal(result.accepted, true);
  assert.match(result.logs.join('\n'), /HTTP 409/);
  assert.match(result.logs.join('\n'), /HTTP 409=一致.*PT409=一致.*期待メッセージ=一致/);
});
for (const [name, value] of [
  ['別SQLSTATE', { code: '42501', message: expected.message }],
  ['旧40001', { code: '40001', message: expected.message }],
  ['使用済みID', { code: expected.code, message: 'previously used memo id' }],
  ['別メッセージ', { code: expected.code, message: 'unrelated' }],
]) {
  test(name + 'を競合成功にしない', async () => {
    const result = await simulate(reply(value));
    assert.equal(result.failed, false);
    assert.equal(result.accepted, false);
  });
}
test('成功HTTPに期待競合JSONがあっても拒否', async () => {
  const result = await simulate(reply(expected, 200));
  assert.equal(result.accepted, false);
});
for (const status of [400, 500, 503]) {
  test(`HTTP ${status}ではPT409でも拒否`, async () => {
    const result = await simulate(reply(expected, status));
    assert.equal(result.failed, false);
    assert.equal(result.accepted, false);
  });
}
test('非JSONと応答形式不正を区別', async () => {
  const nonJson = await simulate(reply('not-json'));
  const malformed = await simulate(reply({ code: 'PT409' }));
  assert.equal(nonJson.failed, true);
  assert.equal(nonJson.stages.at(-1), '競合エラー応答のJSON解析');
  assert.equal(malformed.failed, true);
  assert.equal(malformed.stages.at(-1), '競合エラー応答形式・一致判定');
});
for (const [name, error, category] of [
  ['タイムアウト', new DOMException('sensitive', 'TimeoutError'), 'タイムアウト通知'],
  ['中断', new DOMException('sensitive', 'AbortError'), '中断通知'],
  ['接続リセット', new TypeError('sensitive', { cause: { code: 'ECONNRESET' } }), '接続リセット'],
  ['DNS', new TypeError('sensitive', { cause: { code: 'ENOTFOUND' } }), 'DNS解決失敗'],
  ['TLS', new TypeError('sensitive', { cause: { code: 'CERT_HAS_EXPIRED' } }), 'TLS証明書期限切れ'],
  ['未知コード', { name: 'sensitive', cause: { code: 'sensitive' } }, '不明'],
]) {
  test(name + 'を安全に分類し再送しない', async () => {
    let calls = 0;
    const result = await simulate(async () => { calls++; throw error; });
    assert.equal(calls, 1);
    assert.equal(result.failed, true);
    assert.match(result.logs.join('\n'), new RegExp(`分類=${category}`));
    assert.equal(result.logs.join('\n').includes('sensitive'), false);
  });
}
test('本文受信失敗・成功本文キャンセル失敗の到達点を識別', async () => {
  const read = await simulate(async () => ({ ok: false, status: 409, text: async () => { throw new Error('private'); } }));
  const cancel = await simulate(async () => ({ ok: true, status: 200, body: { cancel: async () => { throw new Error('private'); } } }));
  assert.equal(read.failed, true);
  assert.equal(cancel.failed, true);
  assert.match(read.stages.at(-1), /本文の受信/);
  assert.match(cancel.stages.at(-1), /本文破棄/);
  assert.equal([...read.logs, ...cancel.logs].join('\n').includes('private'), false);
});
const before = { memos: [{ id: 'target', body: 'dummy', revision: 2, updated_at: 'dummy-time' }, { id: 'other', revision: 1 }],
  tags: [{ id: 'tag' }], memoTags: [{ memo_id: 'other', tag_id: 'tag' }] };
test('期待競合と全データ不変の両方がある場合のみ最終判定成功', () => {
  assert.doesNotThrow(() => verifyConflictUnchanged(before, structuredClone(before), 'target', true));
  assert.throws(() => verifyConflictUnchanged(before, before, 'target', false));
  for (const field of ['body', 'revision', 'updated_at']) {
    const after = structuredClone(before);
    after.memos[0][field] = 'changed';
    assert.throws(() => verifyConflictUnchanged(before, after, 'target', true));
  }
  for (const collection of ['memos', 'tags', 'memoTags']) {
    const after = structuredClone(before);
    after[collection].push({ id: 'additional' });
    assert.throws(() => verifyConflictUnchanged(before, after, 'target', true));
  }
});

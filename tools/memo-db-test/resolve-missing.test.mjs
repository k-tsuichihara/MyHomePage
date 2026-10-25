import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJson } from './cli.mjs';
import { collectRecordedIds, freshId, missingSubmitted, verifyMissingOnce } from './resolve-missing-contract.mjs';
globalThis.fetch = () => { throw new Error('network forbidden'); };
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const submitted = missingSubmitted(a, b);
test('既存の階層内UUIDを収集し重複候補を避ける', () => {
  const ids = collectRecordedIds([{ requestId: a.toUpperCase(), nested: [{ requestId: b }] }]);
  const c = '33333333-3333-4333-8333-333333333333';
  const candidates = [a, b, c];
  assert.equal(freshId(ids, () => candidates.shift()), c);
  assert.throws(() => freshId(ids, () => a));
  assert.throws(() => missingSubmitted(a, a));
});
async function mocked(responseFactory, run) {
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://mock.invalid/rest/v1/rpc/memo_resolve_request');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), submitted);
    return responseFactory();
  };
  try { await run(); assert.equal(calls, 1); }
  finally { globalThis.fetch = () => { throw new Error('network forbidden'); }; }
}
const execute = () => verifyMissingOnce('https://mock.invalid', 'dummy-key', 'dummy-token', submitted, requestJson);
test('HTTP成功と厳密nullだけを許可し照合先へ1回だけ送る', async () => {
  await mocked(() => new Response('null', { status: 200 }), execute);
});
for (const value of ['{}', '[]', 'false', '0', '"null"', '{"status":"saved"}', '{"status":"previously-applied-deleted"}']) {
  test('null以外の応答を拒否: ' + value, async () => {
    await mocked(() => new Response(value), () => assert.rejects(execute()));
  });
}
test('HTTPエラーで本文がnullでも拒否', async () => {
  await mocked(() => new Response('null', { status: 403 }), () => assert.rejects(execute()));
});
test('空応答・JSON解析失敗を拒否', async () => {
  await mocked(() => new Response(null, { status: 204 }), () => assert.rejects(execute()));
  await mocked(() => new Response('invalid-json'), () => assert.rejects(execute()));
});
test('通信失敗・タイムアウト時も1回だけで停止', async () => {
  for (const error of [new TypeError('mock'), new DOMException('mock', 'TimeoutError')]) {
    await mocked(() => { throw error; }, () => assert.rejects(execute()));
  }
});

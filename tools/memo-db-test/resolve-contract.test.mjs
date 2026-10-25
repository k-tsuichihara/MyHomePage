import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSubmitted, verifyResolved, validateRunId, resolveOnce } from './resolve-contract.mjs';
globalThis.fetch = () => { throw new Error('network forbidden'); };
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];
const [run, sourceRun, memoId, requestId, oldRequest] = ids;
const records = {
  update: { version: 1, test: 'update-read', status: 'prepared', runId: run, sourceRunId: sourceRun,
    memoId, requestId, userId: 'dummy-user', projectHost: 'mock.invalid', expectedRevision: 1 },
  updateResult: { version: 1, test: 'update-read', status: 'passed', runId: run, sourceRunId: sourceRun, memoId, requestId, revision: 2 },
  creation: { version: 1, test: 'create-read', status: 'prepared', runId: sourceRun, memoId, requestId: oldRequest,
    userId: 'dummy-user', projectHost: 'mock.invalid' },
  creationResult: { version: 1, test: 'create-read', status: 'passed', runId: sourceRun, memoId, revision: 1 },
};
const submitted = buildSubmitted(run, records, 'mock.invalid');
const response = { status: 'saved', result: { memo: { id: memoId, user_id: 'dummy-user', title: submitted.p_title,
  body: submitted.p_body, revision: 2, last_request_id: requestId, pinned_at: null, deleted_at: null,
  created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:01:00Z' }, tagIds: [] } };
test('正常履歴と完全な期待結果だけを受け入れる', () => {
  assert.doesNotThrow(() => verifyResolved(response, submitted, 'dummy-user'));
  assert.equal(submitted.p_expected_revision, 1);
  assert.equal(submitted.p_request_id, requestId);
});
test('記録欠落・不一致・非PASS・別プロジェクト・パス指定は停止', () => {
  assert.throws(() => buildSubmitted(run, {}, 'mock.invalid'));
  assert.throws(() => buildSubmitted(run, records, 'other.invalid'));
  assert.throws(() => validateRunId('../record'));
  for (const [part, field, value] of [['updateResult', 'status', 'failed'], ['creation', 'memoId', oldRequest],
    ['update', 'expectedRevision', 2], ['creationResult', 'revision', 2], ['updateResult', 'requestId', oldRequest]]) {
    const altered = structuredClone(records); altered[part][field] = value;
    assert.throws(() => buildSubmitted(run, altered, 'mock.invalid'));
  }
});
test('null・削除済み・本文等の不一致はPASSにしない', () => {
  assert.throws(() => verifyResolved(null, submitted, 'dummy-user'));
  assert.throws(() => verifyResolved({ status: 'previously-applied-deleted' }, submitted, 'dummy-user'));
  for (const [field, value] of [['id', oldRequest], ['user_id', 'other'], ['title', 'other'], ['body', 'other'],
    ['revision', 3], ['last_request_id', oldRequest], ['pinned_at', 'set'], ['deleted_at', 'set'], ['updated_at', 'invalid']]) {
    const altered = structuredClone(response); altered.result.memo[field] = value;
    assert.throws(() => verifyResolved(altered, submitted, 'dummy-user'));
  }
  const altered = structuredClone(response); altered.result.tagIds.push(oldRequest);
  assert.throws(() => verifyResolved(altered, submitted, 'dummy-user'));
});
test('照合APIだけを1回呼び、要求・応答を一致させる', async () => {
  let calls = 0;
  const result = await resolveOnce('https://mock.invalid', 'dummy-key', 'dummy-token', submitted, async (url, options) => {
    calls++; assert.equal(url, 'https://mock.invalid/rest/v1/rpc/memo_resolve_request');
    assert.equal(options.method, 'POST'); assert.deepEqual(JSON.parse(options.body), submitted);
    return response;
  });
  assert.equal(calls, 1); verifyResolved(result, submitted, 'dummy-user');
});
test('通信例外時に自動再送しない', async () => {
  let calls = 0;
  await assert.rejects(resolveOnce('https://mock.invalid', 'dummy-key', 'dummy-token', submitted,
    async () => { calls++; throw new Error('simulated'); }));
  assert.equal(calls, 1);
});

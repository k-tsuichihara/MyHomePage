import test from 'node:test';
import assert from 'node:assert/strict';
import { runReplayCase } from './replay-contract.mjs';
globalThis.fetch = () => { throw new Error('network forbidden'); };
const submitted = { p_id: 'dummy-id', p_request_id: 'dummy-request', p_title: 'dummy', p_body: 'dummy', p_tag_ids: [], p_expected_revision: null };
const memo = { id: submitted.p_id, user_id: 'dummy-user', title: submitted.p_title, body: submitted.p_body,
  revision: 1, last_request_id: submitted.p_request_id, pinned_at: null, deleted_at: null,
  created_at: '2026-10-15T00:00:00Z', updated_at: '2026-10-15T00:00:00Z' };
function fixture() {
  const first = { memo: structuredClone(memo), tagIds: [] };
  const before = { memos: [{ id: 'other' }], tags: [{ id: 'tag' }], memoTags: [] };
  const middle = structuredClone(before); middle.memos.push(structuredClone(memo));
  return { first, replay: structuredClone(first), snapshots: [before, middle, structuredClone(middle)] };
}
async function execute(f, failSave = 0, failSnapshot = 0) {
  let saves = 0; let reads = 0; const bodies = [];
  let rejected = false;
  try {
    await runReplayCase({ submitted, userId: 'dummy-user',
      save: async (body) => { bodies.push(body); saves++; if (saves === failSave) throw new Error('simulated'); return saves === 1 ? f.first : f.replay; },
      snapshot: async () => { reads++; if (reads === failSnapshot) throw new Error('simulated'); return f.snapshots[reads - 1]; },
    });
  } catch { rejected = true; }
  return { saves, reads, bodies, rejected };
}
test('正常再送: 完全同一ボディを2回、スナップショット3回', async () => {
  const result = await execute(fixture());
  assert.equal(result.rejected, false); assert.equal(result.saves, 2); assert.equal(result.reads, 3);
  assert.equal(result.bodies[0], result.bodies[1]);
});
for (const kind of ['revision', 'count', 'body', 'time', 'tags', 'relations', 'response']) {
  test(kind + 'の変化を拒否', async () => {
    const f = fixture();
    if (kind === 'revision') f.snapshots[2].memos[1].revision = 2;
    if (kind === 'count') f.snapshots[2].memos.push({ id: 'duplicate' });
    if (kind === 'body') f.snapshots[2].memos[1].body = 'changed';
    if (kind === 'time') f.snapshots[2].memos[1].updated_at = 'changed';
    if (kind === 'tags') f.snapshots[2].tags.push({ id: 'new' });
    if (kind === 'relations') f.snapshots[2].memoTags.push({ memo_id: submitted.p_id });
    if (kind === 'response') f.replay.memo.updated_at = 'changed';
    assert.equal((await execute(f)).rejected, true);
  });
}
for (const [saveFailure, readFailure, expectedCalls] of [[1, 0, 1], [2, 0, 2], [0, 1, 0], [0, 2, 1], [0, 3, 2]]) {
  test(`途中失敗で停止: save=${saveFailure}, snapshot=${readFailure}`, async () => {
    const result = await execute(fixture(), saveFailure, readFailure);
    assert.equal(result.rejected, true); assert.equal(result.saves, expectedCalls);
  });
}
test('HTTPエラーとタイムアウトで共通通信処理が停止し再送しない', async () => {
  const { requestJson } = await import('./cli.mjs');
  for (const timeout of [false, true]) {
    let calls = 0;
    globalThis.fetch = async () => { calls++; if (timeout) throw new DOMException('dummy', 'TimeoutError'); return new Response('null', { status: 500 }); };
    try {
      await assert.rejects(runReplayCase({ submitted, userId: 'dummy-user', snapshot: async () => fixture().snapshots[0],
        save: (body) => requestJson('https://mock.invalid/rest/v1/rpc/memo_save', { method: 'POST', body }) }));
      assert.equal(calls, 1);
    } finally { globalThis.fetch = () => { throw new Error('network forbidden'); }; }
  }
});

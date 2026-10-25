import test from 'node:test';
import assert from 'node:assert/strict';
import { runMixCase } from './mix-contract.mjs';
globalThis.fetch = () => { throw new Error('network forbidden'); };
const base = { p_id: 'a', p_request_id: 'r', p_title: 'dummy', p_body: 'dummy', p_expected_revision: null, p_tag_ids: [] };
async function simulate(mode = '') {
  let reads = 0, calls = [], confirmations = [], progress = [], failed = false;
  const memo = { id: 'a', user_id: 'u', title: 'dummy', body: 'dummy', revision: 1, last_request_id: 'r',
    pinned_at: null, deleted_at: null, created_at: '2026-10-15T00:00:00Z', updated_at: '2026-10-15T00:00:00Z' };
  try {
    await runMixCase({ base, alternateId: 'b', userId: 'u',
      confirm: async (kind) => { confirmations.push(kind); return mode !== 'cancel'; },
      progress: async (kind) => { progress.push(kind); },
      snapshot: async () => { reads++; if (mode === 'read-error' && reads === 3) throw new Error('mock');
        const s = { memos: reads === 1 ? [] : [structuredClone(memo)], tags: [], memoTags: [] };
        if (mode === 'changed' && reads === 4) s.memos[0].revision = 2;
        return s;
      },
      rpc: async (name, payload, rejection) => {
        calls.push({ name, payload, rejection });
        if (!rejection) return { memo: structuredClone(memo), tagIds: [] };
        if (mode === 'timeout') throw new DOMException('mock', 'TimeoutError');
        if (mode === 'success') return { status: 200 };
        return { status: mode === 'http' ? 500 : 400,
          error: { code: mode === 'code' ? 'PT409' : '22023', message: mode === 'message' ? 'other' : 'request id reused with different operation or content' } };
      },
    });
  } catch { failed = true; }
  return { failed, calls, reads, confirmations, progress };
}
test('3混用すべての厳密拒否と不変、各確認・上限回数', async () => {
  const r = await simulate(); assert.equal(r.failed, false); assert.equal(r.calls.length, 4); assert.equal(r.reads, 8);
  assert.deepEqual(r.confirmations, ['create', 'content', 'target', 'operation']);
  assert.equal(r.calls[1].payload.p_body !== base.p_body, true);
  assert.equal(r.calls[2].payload.p_id, 'b');
  assert.equal(r.calls[3].name, 'memo_change_state');
  assert.ok(r.calls.every((c) => c.payload.p_request_id === 'r'));
});
for (const mode of ['success', 'http', 'code', 'message', 'timeout', 'changed', 'read-error', 'cancel']) {
  test(mode + 'で即停止し次試行しない', async () => {
    const r = await simulate(mode); assert.equal(r.failed, true);
    assert.ok(r.calls.length <= 2); assert.ok(!r.progress.includes('content'));
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { runPinCase } from './pin-contract.mjs';
import { pinRpc } from './pin-read.mjs';

globalThis.fetch = () => { throw new Error('network forbidden'); };
async function simulate(mode = '') {
  const base = { p_id: 'dedicated', p_request_id: 'create-id', p_title: 'private title',
    p_body: 'private body', p_tag_ids: [], p_expected_revision: null };
  let state = { memos: [{ id: 'existing', body: 'private existing' }], tags: [{ id: 'tag' }], memoTags: [] };
  const calls = [], confirmations = [], records = [];
  let original, error, result;
  try {
    result = await runPinCase({ base, pinRequestId: 'pin-id', unpinRequestId: 'unpin-id', userId: 'user',
      confirm: async (action) => { confirmations.push(action); return mode !== `cancel-${action}`; },
      progress: async (action, detail) => {
        records.push({ action, ...detail });
        if (mode === `record-${action}`) throw new Error('mock');
      },
      rpc: async (name, payload) => {
        calls.push({ name, payload: structuredClone(payload) });
        if (mode === 'network-pin' && name === 'memo_change_state') throw new TypeError('private');
        if (mode === 'timeout-unpin' && payload.p_action === 'unpin') throw new DOMException('private', 'TimeoutError');
        if (name === 'memo_load_snapshot') {
          const output = structuredClone(state);
          if (mode === 'snapshot-pin' && String(output.memos[1]?.revision) === '2') output.memos[1].pinned_at = null;
          if (mode === 'other' && output.memos[1]?.revision === 2) output.memos[0].body = 'changed';
          if (mode === 'tag' && output.memos[1]?.revision === 2) output.tags.push({ id: 'unexpected' });
          if (mode === 'relation' && output.memos[1]?.revision === 2) output.memoTags.push({ memo_id: 'dedicated', tag_id: 'tag' });
          return output;
        }
        if (name === 'memo_save') {
          original = { id: base.p_id, user_id: 'user', title: base.p_title, body: base.p_body,
            revision: 1, pinned_at: null, deleted_at: null, last_request_id: base.p_request_id,
            created_at: '2026-10-15T00:00:00Z', updated_at: '2026-10-15T00:00:00Z' };
          state.memos.push(structuredClone(original));
          return { memo: structuredClone(original), tagIds: [] };
        }
        if (name === 'memo_resolve_request') {
          assert.deepEqual(payload, base);
          return mode === 'resolve' ? null : { status: 'saved', result: { memo: structuredClone(original), tagIds: [] } };
        }
        assert.equal(name, 'memo_change_state');
        const pin = payload.p_action === 'pin';
        assert.deepEqual(payload, { p_id: 'dedicated', p_expected_revision: pin ? 1 : 2,
          p_request_id: pin ? 'pin-id' : 'unpin-id', p_action: pin ? 'pin' : 'unpin' });
        const updated = mode === 'microseconds'
          ? (pin ? '2026-10-15T00:00:00.000001Z' : '2026-10-15T00:00:00.000002Z')
          : pin ? '2026-10-15T00:00:01Z' : '2026-10-15T00:00:02Z';
        const row = { ...state.memos[1], revision: pin ? 2 : 3, updated_at: updated,
          pinned_at: pin ? updated : null, last_request_id: payload.p_request_id };
        if (pin) {
          const fields = { revision: 1, state: null, request: 'wrong', memo: 'wrong', date: original.updated_at,
            body: 'changed', title: 'changed', created: updated, trash: updated, owner: 'other' };
          const keys = { revision: 'revision', state: 'pinned_at', request: 'last_request_id', memo: 'id', date: 'updated_at',
            body: 'body', title: 'title', created: 'created_at', trash: 'deleted_at', owner: 'user_id' };
          if (mode in fields) row[keys[mode]] = fields[mode];
          if (mode === 'pin-time') row.pinned_at = '2026-10-15T00:00:03Z';
        }
        if (!pin && mode === 'unpin-state') row.pinned_at = updated;
        if (!pin && mode === 'unpin-date') row.updated_at = state.memos[1].updated_at;
        state.memos[1] = structuredClone(row);
        return row;
      },
    });
  } catch (e) { error = e; }
  return { result, error, calls, confirmations, records };
}
test('作成→照合→pin→unpin、RPC8回・要求照合は作成のみ', async () => {
  const r = await simulate(); assert.ifError(r.error);
  assert.deepEqual(r.confirmations, ['create', 'pin', 'unpin']);
  assert.deepEqual(r.calls.map((v) => v.name), ['memo_load_snapshot', 'memo_save', 'memo_load_snapshot',
    'memo_resolve_request', 'memo_change_state', 'memo_load_snapshot', 'memo_change_state', 'memo_load_snapshot']);
  assert.equal(r.result.revision, 3); assert.equal(r.result.stateRequestResolution, 'not-verified-no-readonly-api');
  assert.ok(!JSON.stringify(r.records).includes('private'));
});
test('PostgreSQLのマイクロ秒差を切り捨てず検証', async () => {
  const r = await simulate('microseconds'); assert.ifError(r.error); assert.equal(r.result.revision, 3);
});
for (const mode of ['revision', 'state', 'request', 'memo', 'date', 'body', 'title', 'created', 'trash', 'owner',
  'pin-time', 'unpin-state', 'unpin-date', 'snapshot-pin', 'other', 'tag', 'relation', 'resolve', 'network-pin',
  'timeout-unpin', 'cancel-create', 'cancel-pin', 'cancel-unpin', 'record-create', 'record-pin']) {
  test(`${mode}で停止、再送なし`, async () => {
    const r = await simulate(mode); assert.ok(r.error); assert.ok(r.calls.length <= 8);
    assert.ok(r.calls.filter((c) => c.name === 'memo_save').length <= 1);
    for (const action of ['pin', 'unpin']) assert.ok(r.calls.filter((c) => c.payload.p_action === action).length <= 1);
    if (['resolve', 'record-create', 'cancel-pin'].includes(mode)) assert.equal(r.calls.filter((c) => c.name === 'memo_change_state').length, 0);
    if (mode === 'record-pin' || mode === 'network-pin') assert.ok(!r.calls.some((c) => c.payload.p_action === 'unpin'));
    if (mode === 'cancel-create') assert.ok(!r.calls.some((c) => c.name === 'memo_save'));
  });
}
for (const mode of ['ok', 'http409', 'http201', 'timeout', 'network', 'json']) {
  test(`RPC通信 ${mode}（ネットワークなし）`, async () => {
    let calls = 0;
    const rpc = pinRpc('https://invalid.example', {}, async (url, options) => {
      calls++; assert.ok(url.endsWith('/rpc/memo_change_state')); assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(options.body), { p_action: 'pin' });
      if (mode === 'timeout') throw new DOMException('private', 'TimeoutError');
      if (mode === 'network') throw new TypeError('private');
      return { status: mode === 'http409' ? 409 : mode === 'http201' ? 201 : 200,
        json: async () => { if (mode === 'json') throw new SyntaxError('private'); return { dummy: true }; } };
    });
    if (mode === 'ok') assert.deepEqual(await rpc('memo_change_state', { p_action: 'pin' }), { dummy: true });
    else await assert.rejects(rpc('memo_change_state', { p_action: 'pin' }));
    assert.equal(calls, 1);
    await assert.rejects(rpc('memo_delete_permanently', {})); assert.equal(calls, 1);
  });
}

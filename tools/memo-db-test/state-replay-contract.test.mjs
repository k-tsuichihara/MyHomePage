import test from 'node:test';
import assert from 'node:assert/strict';
import { runStateReplayCase, stateConflictResponse } from './state-replay-contract.mjs';
import './state-replay-read.mjs';
globalThis.fetch = () => { throw new Error('network forbidden'); };

async function simulate(mode = '') {
  const base = { p_id: 'dedicated', p_request_id: 'create-id', p_expected_revision: null,
    p_title: 'private title', p_body: 'private body', p_tag_ids: [] };
  const state = { memos: [{ id: 'existing', body: 'private existing' }], tags: [{ id: 'tag' }], memoTags: [] };
  const calls = [], confirmations = [], records = [];
  let saved, pinned, firstBody, result, error, stateCalls = 0, reads = 0;
  try {
    result = await runStateReplayCase({ base, pinRequestId: 'pin-id', conflictRequestId: 'conflict-id', userId: 'user',
      confirm: async (action) => { confirmations.push(action); return mode !== `cancel-${action}`; },
      progress: async (action, detail) => { records.push({ action, ...detail }); if (mode === `record-${action}`) throw new Error('mock'); },
      rpc: async (name, payload) => {
        calls.push({ name, payload: structuredClone(payload) });
        if (name === 'memo_load_snapshot') {
          reads++;
          if (mode === 'read-failure' && reads === 4) throw new Error('mock');
          const s = structuredClone(state);
          if (reads >= 4 && mode === 'other') s.memos[0].body = 'changed';
          if (reads >= 4 && mode === 'tag') s.tags.push({ id: 'unexpected' });
          if (reads >= 4 && mode === 'relation') s.memoTags.push({ memo_id: 'dedicated', tag_id: 'tag' });
          if (reads === 5 && mode === 'snapshot') s.memos[1].revision = 3;
          return s;
        }
        if (name === 'memo_save') {
          saved = { memo: { id: 'dedicated', user_id: 'user', title: base.p_title, body: base.p_body,
            revision: 1, pinned_at: null, deleted_at: null, last_request_id: 'create-id',
            created_at: '2026-10-16T00:00:00Z', updated_at: '2026-10-16T00:00:00Z' }, tagIds: [] };
          state.memos.push(structuredClone(saved.memo)); return structuredClone(saved);
        }
        if (name === 'memo_resolve_request') {
          assert.deepEqual(payload, base);
          return mode === 'resolve' ? null : { status: 'saved', result: structuredClone(saved) };
        }
        assert.equal(name, 'memo_change_state'); stateCalls++;
        assert.deepEqual(payload, { p_id: 'dedicated', p_expected_revision: 1, p_request_id: 'pin-id', p_action: 'pin' });
        if (stateCalls === 1) {
          firstBody = JSON.stringify(payload);
          pinned = { ...saved.memo, revision: 2, last_request_id: 'pin-id',
            updated_at: '2026-10-16T00:00:01Z', pinned_at: '2026-10-16T00:00:01Z' };
          state.memos[1] = structuredClone(pinned); return structuredClone(pinned);
        }
        assert.equal(JSON.stringify(payload), firstBody);
        if (mode === 'timeout') throw new DOMException('private', 'TimeoutError');
        if (mode === 'network') throw new TypeError('private');
        const replay = structuredClone(pinned);
        const changes = { request: ['last_request_id', 'wrong'], target: ['id', 'wrong'], double: ['revision', 3],
          date: ['updated_at', '2026-10-16T00:00:02Z'], body: ['body', 'changed'], state: ['pinned_at', null] };
        if (changes[mode]) replay[changes[mode][0]] = changes[mode][1];
        if (mode === 'silent-double') state.memos[1].revision = 3;
        return replay;
      },
      rejectConflict: async (payload) => {
        calls.push({ name: 'memo_change_state', payload });
        assert.deepEqual(payload, { p_id: 'dedicated', p_expected_revision: 1, p_request_id: 'conflict-id', p_action: 'unpin' });
        if (mode === 'conflict-timeout') throw new DOMException('private', 'TimeoutError');
        if (mode === 'conflict-change') state.memos[1].revision = 3;
        return { status: mode === 'http' ? 200 : 409, codeMatches: mode !== 'old40001', messageMatches: mode !== 'message' };
      },
    });
  } catch (e) { error = e; }
  return { result, error, calls, confirmations, records };
}
test('pin成功→新規IDの競合→完全同一再送、10 RPC・全データ不変', async () => {
  const r = await simulate(); assert.ifError(r.error); assert.equal(r.calls.length, 10);
  assert.equal(r.calls.filter((v) => v.name === 'memo_change_state').length, 3);
  assert.equal(r.calls.filter((v) => v.name === 'memo_load_snapshot').length, 5);
  assert.deepEqual(r.confirmations, ['create', 'pin', 'conflict', 'replay']);
  assert.equal(r.result.revision, 2); assert.equal(r.result.identicalStateReplayVerified, true);
  assert.ok(!JSON.stringify(r.records).includes('private'));
});
for (const mode of ['request', 'target', 'double', 'silent-double', 'date', 'body', 'state', 'snapshot',
  'other', 'tag', 'relation', 'resolve', 'timeout', 'network', 'conflict-timeout', 'conflict-change', 'http',
  'old40001', 'message', 'read-failure', 'cancel-create', 'cancel-pin', 'cancel-conflict', 'cancel-replay',
  'record-create', 'record-pin', 'record-conflict', 'record-replay']) {
  test(`${mode}で停止・自動再送なし`, async () => {
    const r = await simulate(mode); assert.ok(r.error); assert.ok(r.calls.length <= 10);
    assert.ok(r.calls.filter((v) => v.name === 'memo_save').length <= 1);
    assert.ok(r.calls.filter((v) => v.payload.p_request_id === 'pin-id').length <= 2);
    assert.ok(r.calls.filter((v) => v.payload.p_request_id === 'conflict-id').length <= 1);
    if (['conflict-timeout', 'conflict-change', 'http', 'old40001', 'record-conflict'].includes(mode)) {
      assert.equal(r.calls.filter((v) => v.payload.p_request_id === 'pin-id').length, 1);
    }
    if (mode === 'cancel-create') assert.equal(r.calls.length, 1);
  });
}
for (const mode of ['ok', 'http', 'old40001', 'message', 'network', 'timeout', 'json']) {
  test(`競合HTTP処理 ${mode}（実通信なし）`, async () => {
    let count = 0;
    const action = () => stateConflictResponse('https://invalid.example', {}, { p_action: 'unpin' }, async (_url, options) => {
      count++; assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
      if (mode === 'network') throw new TypeError('private');
      if (mode === 'timeout') throw new DOMException('private', 'TimeoutError');
      return { status: mode === 'http' ? 200 : 409, json: async () => {
        if (mode === 'json') throw new SyntaxError('private');
        return { code: mode === 'old40001' ? '40001' : 'PT409', message: mode === 'message' ? 'memo revision conflict' : 'revision conflict' };
      } };
    });
    if (['http', 'network', 'timeout', 'json'].includes(mode)) await assert.rejects(action());
    else {
      const r = await action(); assert.equal(r.codeMatches, mode !== 'old40001'); assert.equal(r.messageMatches, mode !== 'message');
    }
    assert.equal(count, 1);
  });
}

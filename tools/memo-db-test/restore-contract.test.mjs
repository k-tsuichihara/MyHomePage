import test from 'node:test';
import assert from 'node:assert/strict';
import { runRestoreCase } from './restore-contract.mjs';
import { pinRpc } from './pin-read.mjs';
import './restore-read.mjs';

globalThis.fetch = () => { throw new Error('network forbidden'); };
async function simulate(mode = '') {
  const base = { p_id: 'dedicated', p_request_id: 'create-id', p_title: 'private title',
    p_body: 'private body', p_tag_ids: [], p_expected_revision: null };
  const state = { memos: [{ id: 'existing', body: 'private existing', deleted_at: '2026-10-14T00:00:00Z' }],
    tags: [{ id: 'tag' }], memoTags: [{ memo_id: 'existing', tag_id: 'tag' }] };
  const calls = [], confirmations = [], records = [];
  let original, result, error, reads = 0;
  try {
    result = await runRestoreCase({ base, trashRequestId: 'trash-id', restoreRequestId: 'restore-id', userId: 'user',
      confirm: async (action) => { confirmations.push(action); return mode !== `cancel-${action}`; },
      progress: async (action, detail) => {
        records.push({ action, ...detail });
        if (mode === `record-${action}`) throw new Error('mock');
      },
      rpc: async (name, payload) => {
        calls.push({ name, payload: structuredClone(payload) });
        if (name === 'memo_load_snapshot') {
          reads++;
          if (mode === 'snapshot-failure' && reads === 4) throw new Error('mock');
          const s = structuredClone(state);
          if (reads === 4) {
            if (mode === 'snapshot') s.memos[1].revision = 2;
            if (mode === 'missing') s.memos.pop();
            if (mode === 'other') s.memos[0].body = 'changed';
            if (mode === 'tag') s.tags.push({ id: 'unexpected' });
            if (mode === 'relation') s.memoTags.push({ memo_id: 'dedicated', tag_id: 'tag' });
          }
          return s;
        }
        if (name === 'memo_save') {
          original = { id: 'dedicated', user_id: 'user', title: base.p_title, body: base.p_body,
            revision: 1, pinned_at: null, deleted_at: null, last_request_id: 'create-id',
            created_at: '2026-10-15T00:00:00Z', updated_at: '2026-10-15T00:00:00Z' };
          state.memos.push(structuredClone(original));
          return { memo: structuredClone(original), tagIds: [] };
        }
        if (name === 'memo_resolve_request') {
          assert.deepEqual(payload, base);
          return mode === 'resolve' ? null : { status: 'saved', result: { memo: structuredClone(original), tagIds: [] } };
        }
        assert.equal(name, 'memo_change_state');
        const trash = payload.p_action === 'trash';
        assert.deepEqual(payload, { p_id: 'dedicated', p_expected_revision: trash ? 1 : 2,
          p_request_id: trash ? 'trash-id' : 'restore-id', p_action: trash ? 'trash' : 'restore' });
        if (mode === `network-${payload.p_action}`) throw new TypeError('private');
        if (mode === `timeout-${payload.p_action}`) throw new DOMException('private', 'TimeoutError');
        const updated = mode === 'microseconds'
          ? `2026-10-15T00:00:00.00000${trash ? 1 : 2}Z` : `2026-10-15T00:00:0${trash ? 1 : 2}Z`;
        const previous = state.memos[1];
        const row = { ...previous, revision: trash ? 2 : 3, updated_at: updated,
          deleted_at: trash ? updated : null, last_request_id: payload.p_request_id };
        if (trash && mode === 'trash-revision') row.revision = 1;
        if (trash && mode === 'trash-deleted') row.deleted_at = null;
        if (!trash) {
          const changes = { revision: ['revision', 2], deleted: ['deleted_at', previous.deleted_at],
            updated: ['updated_at', previous.updated_at], request: ['last_request_id', 'wrong'], memo: ['id', 'wrong'],
            pinned: ['pinned_at', updated], body: ['body', 'changed'], title: ['title', 'changed'],
            created: ['created_at', updated], owner: ['user_id', 'other'] };
          if (changes[mode]) row[changes[mode][0]] = changes[mode][1];
        }
        state.memos[1] = structuredClone(row);
        return row;
      },
    });
  } catch (e) { error = e; }
  return { result, error, calls, confirmations, records };
}
test('作成→trash→restore→作成要求照合、8 RPC・既存ゴミ箱メモも維持', async () => {
  const r = await simulate(); assert.ifError(r.error);
  assert.deepEqual(r.confirmations, ['create', 'trash', 'restore']);
  assert.deepEqual(r.calls.map((v) => v.name), ['memo_load_snapshot', 'memo_save', 'memo_load_snapshot',
    'memo_change_state', 'memo_load_snapshot', 'memo_change_state', 'memo_load_snapshot', 'memo_resolve_request']);
  assert.deepEqual(r.records.map((v) => [v.action, v.revision, v.deleted]),
    [['create', 1, false], ['trash', 2, true], ['restore', 3, false]]);
  assert.equal(r.result.revision, 3); assert.equal(r.result.deleted, false);
  assert.equal(r.result.stateRequestResolution, 'not-verified-no-readonly-api');
  assert.ok(!JSON.stringify(r.records).includes('private'));
});
test('日時はマイクロ秒差を維持', async () => { assert.ifError((await simulate('microseconds')).error); });
for (const mode of ['revision', 'deleted', 'updated', 'request', 'memo', 'pinned', 'body', 'title', 'created',
  'owner', 'trash-revision', 'trash-deleted', 'snapshot', 'missing', 'other', 'tag', 'relation', 'resolve',
  'network-trash', 'network-restore', 'timeout-trash', 'timeout-restore', 'snapshot-failure',
  'cancel-create', 'cancel-trash', 'cancel-restore', 'record-create', 'record-trash', 'record-restore']) {
  test(`${mode}は停止・再送なし`, async () => {
    const r = await simulate(mode); assert.ok(r.error); assert.ok(r.calls.length <= 8);
    assert.ok(r.calls.filter((v) => v.name === 'memo_save').length <= 1);
    for (const action of ['trash', 'restore']) assert.ok(r.calls.filter((v) => v.payload.p_action === action).length <= 1);
    if (['record-create', 'cancel-trash'].includes(mode)) assert.ok(!r.calls.some((v) => v.name === 'memo_change_state'));
    if (mode === 'cancel-create') assert.equal(r.calls.length, 1);
    if (['record-trash', 'trash-revision', 'trash-deleted', 'network-trash', 'timeout-trash'].includes(mode)) {
      assert.ok(!r.calls.some((v) => v.payload.p_action === 'restore'));
    }
    if (['record-restore', 'network-restore', 'timeout-restore'].includes(mode)) {
      assert.ok(!r.calls.some((v) => v.name === 'memo_resolve_request'));
    }
  });
}
for (const mode of ['ok', 'http409', 'http201', 'timeout', 'network', 'json']) {
  test(`再利用通信処理 ${mode}（実ネットワークなし）`, async () => {
    let count = 0;
    const rpc = pinRpc('https://invalid.example', {}, async (url, options) => {
      count++; assert.ok(url.endsWith('/rpc/memo_change_state'));
      assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(options.body), { p_action: 'restore' });
      if (mode === 'timeout') throw new DOMException('private', 'TimeoutError');
      if (mode === 'network') throw new TypeError('private');
      return { status: mode === 'http409' ? 409 : mode === 'http201' ? 201 : 200,
        json: async () => { if (mode === 'json') throw new SyntaxError('private'); return { dummy: true }; } };
    });
    if (mode === 'ok') assert.deepEqual(await rpc('memo_change_state', { p_action: 'restore' }), { dummy: true });
    else await assert.rejects(rpc('memo_change_state', { p_action: 'restore' }));
    assert.equal(count, 1);
    await assert.rejects(rpc('memo_empty_trash', {})); assert.equal(count, 1);
  });
}

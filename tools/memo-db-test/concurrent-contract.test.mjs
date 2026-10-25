import test from 'node:test';
import assert from 'node:assert/strict';
import { runConcurrentCase, sendTimed, safeOutcome } from './concurrent-contract.mjs';

globalThis.fetch = () => { throw new Error('network forbidden'); };
async function simulate(mode = 'A') {
  const base = { p_id: 'dedicated', p_request_id: 'create', p_expected_revision: null,
    p_title: 'dummy', p_body: 'private initial', p_tag_ids: [] };
  let state = { memos: [{ id: 'existing', body: 'private existing' }], tags: [{ id: 'tag' }], memoTags: [] };
  let initial, saved, saves = 0, reads = 0, resolves = 0, sends = 0;
  const events = [], progress = [];
  const winner = mode === 'B' ? 'B' : 'A';
  let release;
  const gate = new Promise((r) => { release = r; });
  let result, error;
  try {
    result = await runConcurrentCase({ base, requestA: 'requestA', requestB: 'requestB', userId: 'user',
      confirm: async (kind) => { events.push(kind); return mode !== 'cancel'; },
      save: async (p) => {
        saves++; initial = { id: p.p_id, user_id: 'user', title: p.p_title, body: p.p_body,
          revision: 1, last_request_id: p.p_request_id, pinned_at: null, deleted_at: null,
          created_at: '2026-10-15T00:00:00Z', updated_at: '2026-10-15T00:00:00Z' };
        state.memos.push(initial); return { memo: structuredClone(initial), tagIds: [] };
      },
      snapshot: async () => { reads++; return structuredClone(state); },
      send: async (body, side) => {
        sends++; events.push(`start${side}`);
        if (sends === 2) release();
        await gate; // Fails by hanging if implementation starts B only after awaiting A.
        const p = JSON.parse(body);
        assert.equal(p.p_expected_revision, 1); assert.equal(p.p_id, base.p_id);
        assert.equal(p.p_request_id, side === 'A' ? 'requestA' : 'requestB');
        const timing = { startMs: side === 'A' ? 0 : mode === 'nonoverlap' ? 12 : 1,
          endMs: side === 'A' ? 10 : 11 };
        if (mode === 'nonoverlap' && side === 'B') timing.endMs = 20;
        if (mode === 'timeout' && side === 'A') return { kind: 'exception', phase: 'fetch', timing };
        if (mode === 'throw' && side === 'A') throw new Error('private exception');
        const success = mode === 'both-success' || (mode !== 'both-reject' && side === winner);
        if (success) {
          saved = { memo: { ...initial, body: p.p_body, revision: mode === 'revision' ? 3 : 2,
            last_request_id: p.p_request_id, updated_at: '2026-10-15T00:00:01Z' }, tagIds: [] };
          state.memos[1] = saved.memo;
          if (mode === 'changed') state.tags.push({ id: 'unexpected' });
          return { kind: 'success', status: 200, data: structuredClone(saved), timing };
        }
        return { kind: 'http', status: mode === 'http' ? 400 : 409,
          codeMatches: mode !== 'old40001', messageMatches: mode !== 'message', timing };
      },
      resolve: async (p) => {
        resolves++;
        if (mode === 'resolve') return { status: 'saved', result: {} };
        return p.p_request_id === saved.memo.last_request_id ? { status: 'saved', result: structuredClone(saved) }
          : mode === 'loser-recorded' ? { status: 'saved', result: saved } : null;
      },
      progress: async (kind, detail) => {
        progress.push({ kind, ...detail });
        if (mode === 'record-failure' && kind === 'created') throw new Error('record');
      },
    });
  } catch (e) { error = e; }
  return { result, error, saves, reads, resolves, sends, events, progress };
}
for (const winner of ['A', 'B']) test(`${winner}勝利・RPC8回・並行開始`, { timeout: 2000 }, async () => {
  const r = await simulate(winner); assert.ifError(r.error); assert.equal(r.result.winner, winner);
  assert.equal(r.saves + r.sends, 3); assert.equal(r.reads, 3); assert.equal(r.resolves, 2);
  assert.deepEqual(r.events, ['create', 'parallel', 'startA', 'startB']);
  assert.ok(!JSON.stringify(r.progress).includes('private'));
});
for (const mode of ['both-success', 'both-reject', 'http', 'old40001', 'message', 'nonoverlap',
  'timeout', 'throw', 'changed', 'revision', 'resolve', 'loser-recorded', 'record-failure', 'cancel']) {
  test(`${mode}はPASS不可・再送なし`, { timeout: 2000 }, async () => {
    const r = await simulate(mode); assert.ok(r.error); assert.ok(r.saves <= 1 && r.sends <= 2 && r.reads <= 3 && r.resolves <= 2);
    if (['timeout', 'throw'].includes(mode)) assert.equal(r.sends, 2);
    if (mode === 'nonoverlap') assert.equal(r.progress.at(-1).assessment, 'unconfirmed-redesign-required');
    if (mode === 'record-failure') assert.equal(r.sends, 0);
    if (mode === 'cancel') assert.equal(r.saves, 0);
  });
}
for (const mode of ['success', 'conflict', 'old40001', 'http', 'message', 'nonjson', 'timeout', 'reset', 'body']) {
  test(`通信処理 ${mode}（fetch模擬・ネットワークなし）`, async () => {
    let calls = 0, ticks = 0;
    const r = await sendTimed('https://invalid.example/', {}, 'private request', {
      clock: () => ticks++, fetchImpl: async (_url, opts) => {
        calls++; assert.equal(opts.redirect, 'error'); assert.ok(opts.signal instanceof AbortSignal);
        if (mode === 'timeout') throw new DOMException('private', 'TimeoutError');
        if (mode === 'reset') throw Object.assign(new TypeError('private'), { cause: { code: 'ECONNRESET' } });
        return { ok: mode === 'success', status: mode === 'success' ? 200 : mode === 'http' ? 500 : 409,
          text: async () => {
            if (mode === 'body') throw new TypeError('private');
            return mode === 'nonjson' ? 'private invalid JSON' : JSON.stringify(mode === 'success' ? { body: 'private' }
              : { code: mode === 'old40001' ? '40001' : 'PT409', message: mode === 'message' ? 'private' : 'memo revision conflict' });
          } };
      },
    });
    assert.equal(calls, 1); assert.equal(r.timing.durationMs, 1);
    assert.ok(!JSON.stringify(safeOutcome(r)).includes('private'));
    if (mode === 'conflict') assert.ok(r.status === 409 && r.codeMatches && r.messageMatches);
    if (mode === 'old40001') assert.equal(r.codeMatches, false);
    if (['timeout', 'reset', 'body', 'nonjson'].includes(mode)) assert.equal(r.kind, 'exception');
    if (mode === 'nonjson') assert.equal(r.phase, 'json');
    if (mode === 'body') assert.equal(r.phase, 'body');
    if (mode === 'timeout') assert.ok(r.diagnostics.join().includes('TimeoutError'));
    if (mode === 'reset') assert.ok(r.diagnostics.join().includes('ECONNRESET'));
  });
}

import { isDeepStrictEqual as equal } from 'node:util';
import { performance } from 'node:perf_hooks';
import { diagnoseFetchError } from './conflict-response.mjs';

function check(value) { if (!value) throw new Error('verification failed'); }
function canonical(s) {
  check(s && ['memos', 'tags', 'memoTags'].every((k) => Array.isArray(s[k])));
  return Object.fromEntries(['memos', 'tags', 'memoTags'].map((k) => [k,
    s[k].map((v) => JSON.stringify(v)).sort()]));
}
function validDate(v) { return typeof v === 'string' && Number.isFinite(Date.parse(v)); }
function verifySaved(result, payload, userId, revision, initial) {
  const m = result?.memo;
  check(m && m.id === payload.p_id && m.user_id === userId && m.title === payload.p_title
    && m.body === payload.p_body && String(m.revision) === String(revision)
    && m.last_request_id === payload.p_request_id && m.pinned_at === null && m.deleted_at === null
    && validDate(m.created_at) && validDate(m.updated_at)
    && Array.isArray(result.tagIds) && result.tagIds.length === 0);
  if (initial) check(m.created_at === initial.created_at && Date.parse(m.updated_at) > Date.parse(initial.updated_at));
  else check(m.created_at === m.updated_at);
}

// Body strings are frozen before either fetch. Only whitelisted diagnostics escape this function.
export async function sendTimed(url, headers, body, { fetchImpl = fetch, clock = () => performance.now() } = {}) {
  const timing = { startedAt: new Date().toISOString(), startMs: clock() };
  let phase = 'fetch'; let status;
  try {
    const response = await fetchImpl(url, { method: 'POST', headers, body,
      redirect: 'error', signal: AbortSignal.timeout(15000) });
    status = response.status;
    timing.headersAt = new Date().toISOString();
    phase = 'body';
    const text = await response.text();
    phase = 'json';
    const data = JSON.parse(text);
    if (response.ok) return { kind: 'success', status, data, timing };
    return { kind: 'http', status, codeMatches: data?.code === 'PT409',
      messageMatches: data?.message === 'memo revision conflict', timing };
  } catch (error) {
    const diagnostics = [];
    diagnoseFetchError(error, (line) => diagnostics.push(line));
    return { kind: 'exception', phase, status, diagnostics, timing };
  } finally {
    timing.completedAt = new Date().toISOString(); timing.endMs = clock();
    timing.durationMs = timing.endMs - timing.startMs;
  }
}

export function safeOutcome(r) {
  return { kind: r.kind, status: r.status, phase: r.phase, codeMatches: r.codeMatches,
    messageMatches: r.messageMatches, diagnostics: r.diagnostics, timing: r.timing };
}

export async function runConcurrentCase({ base, requestA, requestB, userId, snapshot, save, send,
  resolve, confirm, progress = async () => {} }) {
  check(base.p_expected_revision === null && base.p_tag_ids?.length === 0
    && new Set([base.p_request_id, requestA, requestB]).size === 3);
  const before = await snapshot(); canonical(before);
  check(!before.memos.some((m) => m.id === base.p_id));
  check(await confirm('create', base.p_id));
  const initial = await save(base); verifySaved(initial, base, userId, 1);
  const baseline = await snapshot(); canonical(baseline);
  check(equal(canonical(baseline), canonical({ ...before, memos: [...before.memos, initial.memo] })));
  await progress('created', { revision: 1 });
  const requests = [requestA, requestB].map((id, index) => ({ ...base, p_request_id: id,
    p_expected_revision: 1, p_body: `concurrent ${index === 0 ? 'A' : 'B'} ${id}` }));
  const bodies = requests.map((r) => JSON.stringify(r));
  check(await confirm('parallel', base.p_id));
  const settled = await Promise.allSettled(bodies.map((body, i) => send(body, i === 0 ? 'A' : 'B')));
  const outcomes = settled.map((s) => s.status === 'fulfilled' ? s.value : { kind: 'unexpected-rejection' });
  const overlap = outcomes.every((r) => r.timing && Number.isFinite(r.timing.startMs) && Number.isFinite(r.timing.endMs))
    ? Math.max(...outcomes.map((r) => r.timing.startMs)) < Math.min(...outcomes.map((r) => r.timing.endMs)) : null;
  await progress('responses', { outcomes: outcomes.map(safeOutcome), overlap,
    assessment: overlap === false ? 'unconfirmed-redesign-required' : overlap === null ? 'unknown' : 'overlap-observed' });
  const winners = outcomes.map((r, i) => r.kind === 'success' && r.status === 200 ? i : -1).filter((i) => i >= 0);
  check(winners.length === 1);
  const winner = winners[0], loser = 1 - winner, rejection = outcomes[loser];
  check(rejection.kind === 'http' && rejection.status === 409 && rejection.codeMatches && rejection.messageMatches);
  check(overlap === true);
  const saved = outcomes[winner].data;
  verifySaved(saved, requests[winner], userId, 2, initial.memo);
  check(equal(Object.keys(saved.memo).sort(), Object.keys(initial.memo).sort()));
  const expected = { ...initial.memo, title: requests[winner].p_title, body: requests[winner].p_body,
    revision: saved.memo.revision, updated_at: saved.memo.updated_at, last_request_id: requests[winner].p_request_id };
  check(equal(saved.memo, expected));
  const after = await snapshot();
  check(equal(canonical(after), canonical({ ...baseline,
    memos: baseline.memos.map((m) => m.id === base.p_id ? expected : m) })));
  const resolvedWinner = await resolve(requests[winner]);
  check(resolvedWinner?.status === 'saved' && equal(resolvedWinner.result, saved));
  check(await resolve(requests[loser]) === null);
  return { winner: winner === 0 ? 'A' : 'B', revision: 2, overlap: true };
}

import { isDeepStrictEqual as equal } from 'node:util';

function check(v) { if (!v) throw new Error('verification failed'); }
function micros(v) {
  check(typeof v === 'string' && Number.isFinite(Date.parse(v)));
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  check(m);
  return BigInt(Date.parse(`${m[1]}${m[3]}`)) * 1000n + BigInt((m[2] ?? '').padEnd(6, '0'));
}
function ordered(rows) { return [...rows].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); }
function same(actual, expected) {
  check(actual && ['memos', 'tags', 'memoTags'].every((key) => Array.isArray(actual[key])
    && equal(ordered(actual[key]), ordered(expected[key]))));
}

export async function runStateReplayCase({ base, pinRequestId, conflictRequestId, userId,
  rpc, rejectConflict, confirm, progress = async () => {}, setStage = () => {} }) {
  const ids = [base.p_request_id, pinRequestId, conflictRequestId];
  check(base.p_expected_revision === null && Array.isArray(base.p_tag_ids) && base.p_tag_ids.length === 0
    && ids.every((v) => typeof v === 'string' && v.length > 0) && new Set(ids).size === 3);
  const snapshot = () => { setStage('スナップショット取得'); return rpc('memo_load_snapshot', {}); };
  const before = await snapshot(); same(before, before);
  check(!before.memos.some((m) => m.id === base.p_id));
  check(await confirm('create', base.p_id)); setStage('作成');
  const saved = await rpc('memo_save', base), initial = saved?.memo;
  check(initial && initial.id === base.p_id && initial.user_id === userId && initial.title === base.p_title
    && initial.body === base.p_body && String(initial.revision) === '1' && initial.pinned_at === null
    && initial.deleted_at === null && initial.last_request_id === base.p_request_id
    && initial.created_at === initial.updated_at && Array.isArray(saved.tagIds) && saved.tagIds.length === 0);
  micros(initial.created_at);
  const expectedSnapshot = (memo) => ({ ...before, memos: [...before.memos, memo] });
  same(await snapshot(), expectedSnapshot(initial));
  await progress('create', { revision: 1 });
  // Freeze the entire serialized request. Replay does NOT use the new current revision.
  const pinBody = JSON.stringify({ p_id: base.p_id, p_expected_revision: 1, p_request_id: pinRequestId, p_action: 'pin' });
  check(await confirm('pin', base.p_id)); setStage('pin');
  const pinned = await rpc('memo_change_state', JSON.parse(pinBody));
  check(pinned && String(pinned.revision) === '2' && micros(pinned.updated_at) > micros(initial.updated_at)
    && pinned.pinned_at === pinned.updated_at);
  const expected = { ...initial, revision: pinned.revision, updated_at: pinned.updated_at,
    pinned_at: pinned.updated_at, last_request_id: pinRequestId };
  check(equal(pinned, expected));
  const baseline = await snapshot(); same(baseline, expectedSnapshot(expected));
  await progress('pin', { revision: 2 });
  check(await confirm('conflict', base.p_id)); setStage('状態変更競合');
  const rejection = await rejectConflict({ p_id: base.p_id, p_expected_revision: 1,
    p_request_id: conflictRequestId, p_action: 'unpin' });
  check(rejection.status === 409 && rejection.codeMatches === true && rejection.messageMatches === true);
  same(await snapshot(), baseline);
  await progress('conflict', { revision: 2, httpStatus: 409, code: 'PT409', messageMatched: true });
  check(await confirm('replay', base.p_id)); setStage('意図的な同一pin要求再送');
  const replayed = await rpc('memo_change_state', JSON.parse(pinBody));
  check(equal(replayed, pinned));
  same(await snapshot(), baseline);
  await progress('replay', { revision: 2, historicalResponseMatched: true });
  setStage('作成要求照合');
  const resolved = await rpc('memo_resolve_request', base);
  check(resolved?.status === 'saved' && equal(resolved.result, saved));
  return { revision: 2, pinned: true, creationRequestResolved: true, identicalStateReplayVerified: true,
    stateRequestResolution: 'not-verified-no-readonly-api', requestMixing: 'not-tested',
    redactedReplay: 'not-tested', historicalReplayAfterFurtherMutation: 'not-tested' };
}

export async function stateConflictResponse(url, headers, payload, fetchImpl = fetch) {
  const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(payload),
    redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (response.status !== 409) {
    try { await response.body?.cancel(); } catch {}
    throw new Error('unexpected HTTP');
  }
  const data = await response.json();
  return { status: response.status, codeMatches: data?.code === 'PT409', messageMatches: data?.message === 'revision conflict' };
}

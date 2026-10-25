import { isDeepStrictEqual as equal } from 'node:util';

function check(value) { if (!value) throw new Error('verification failed'); }
function date(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function micros(value) {
  check(date(value));
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  check(match);
  return BigInt(Date.parse(`${match[1]}${match[3]}`)) * 1000n
    + BigInt((match[2] ?? '').padEnd(6, '0'));
}
function ordered(rows) {
  return [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function sameSnapshot(actual, expected) {
  check(actual && ['memos', 'tags', 'memoTags'].every((key) => Array.isArray(actual[key])
    && equal(ordered(actual[key]), ordered(expected[key]))));
}

export async function runPinCase({ base, pinRequestId, unpinRequestId, userId,
  rpc, confirm, progress = async () => {}, setStage = () => {} }) {
  check(base.p_expected_revision === null && Array.isArray(base.p_tag_ids) && base.p_tag_ids.length === 0
    && [base.p_request_id, pinRequestId, unpinRequestId].every((v) => typeof v === 'string' && v.length > 0)
    && new Set([base.p_request_id, pinRequestId, unpinRequestId]).size === 3);
  const snapshot = async () => {
    setStage('スナップショット取得');
    return rpc('memo_load_snapshot', {});
  };
  const before = await snapshot(); sameSnapshot(before, before);
  check(!before.memos.some((m) => m.id === base.p_id));
  check(await confirm('create', base.p_id));
  setStage('新規作成');
  const saved = await rpc('memo_save', base);
  setStage('作成応答検証');
  const initial = saved?.memo;
  check(initial && initial.id === base.p_id && initial.user_id === userId
    && initial.title === base.p_title && initial.body === base.p_body
    && String(initial.revision) === '1' && initial.last_request_id === base.p_request_id
    && initial.pinned_at === null && initial.deleted_at === null
    && date(initial.created_at) && initial.created_at === initial.updated_at
    && Array.isArray(saved.tagIds) && saved.tagIds.length === 0);
  const expectedSnapshot = (memo) => ({ ...before, memos: [...before.memos, memo] });
  sameSnapshot(await snapshot(), expectedSnapshot(initial));
  setStage('作成要求照合');
  const resolved = await rpc('memo_resolve_request', base);
  check(resolved?.status === 'saved' && equal(resolved.result, saved));
  await progress('create', { revision: 1, pinned: false, creationRequestResolved: true });

  let previous = initial;
  for (const [action, requestId, revision] of [['pin', pinRequestId, 2], ['unpin', unpinRequestId, 3]]) {
    check(await confirm(action, base.p_id));
    setStage(`${action}要求`);
    const row = await rpc('memo_change_state', { p_id: base.p_id,
      p_expected_revision: revision - 1, p_request_id: requestId, p_action: action });
    setStage(`${action}応答検証`);
    check(row && String(row.revision) === String(revision)
      && date(row.updated_at) && micros(row.updated_at) > micros(previous.updated_at));
    if (action === 'pin') check(date(row.pinned_at) && row.pinned_at === row.updated_at);
    else check(row.pinned_at === null);
    // Entire row comparison also protects unknown/non-target columns from changes.
    const expected = { ...previous, revision: row.revision, updated_at: row.updated_at,
      last_request_id: requestId, pinned_at: action === 'pin' ? row.updated_at : null };
    check(equal(row, expected));
    sameSnapshot(await snapshot(), expectedSnapshot(expected));
    await progress(action, { revision, pinned: action === 'pin', requestResolution: 'not-verified-no-readonly-api' });
    previous = row;
  }
  return { revision: 3, pinned: false, creationRequestResolved: true,
    stateRequestResolution: 'not-verified-no-readonly-api' };
}

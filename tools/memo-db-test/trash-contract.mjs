import { isDeepStrictEqual as equal } from 'node:util';

function check(value) { if (!value) throw new Error('verification failed'); }
function micros(value) {
  check(typeof value === 'string' && Number.isFinite(Date.parse(value)));
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  check(m);
  return BigInt(Date.parse(`${m[1]}${m[3]}`)) * 1000n + BigInt((m[2] ?? '').padEnd(6, '0'));
}
function ordered(rows) { return [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); }
function sameSnapshot(actual, expected) {
  check(actual && ['memos', 'tags', 'memoTags'].every((key) => Array.isArray(actual[key])
    && equal(ordered(actual[key]), ordered(expected[key]))));
}

export async function runTrashCase({ base, trashRequestId, userId, rpc, confirm,
  progress = async () => {}, setStage = () => {} }) {
  check(base.p_expected_revision === null && Array.isArray(base.p_tag_ids) && base.p_tag_ids.length === 0
    && typeof trashRequestId === 'string' && trashRequestId.length > 0
    && typeof base.p_request_id === 'string' && base.p_request_id.length > 0
    && trashRequestId !== base.p_request_id);
  const snapshot = async () => { setStage('スナップショット取得'); return rpc('memo_load_snapshot', {}); };
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
    && initial.created_at === initial.updated_at && Array.isArray(saved.tagIds) && saved.tagIds.length === 0);
  micros(initial.created_at);
  const expectedSnapshot = (memo) => ({ ...before, memos: [...before.memos, memo] });
  sameSnapshot(await snapshot(), expectedSnapshot(initial));
  await progress('create', { revision: 1, deleted: false });
  check(await confirm('trash', base.p_id));
  setStage('ゴミ箱移動');
  const row = await rpc('memo_change_state', { p_id: base.p_id, p_expected_revision: 1,
    p_request_id: trashRequestId, p_action: 'trash' });
  setStage('ゴミ箱移動応答検証');
  check(row && String(row.revision) === '2' && micros(row.updated_at) > micros(initial.updated_at)
    && row.deleted_at === row.updated_at);
  const expected = { ...initial, revision: row.revision, updated_at: row.updated_at,
    deleted_at: row.updated_at, last_request_id: trashRequestId };
  check(equal(row, expected)); // pinned_at, all text, ownership and other columns are unchanged.
  sameSnapshot(await snapshot(), expectedSnapshot(expected));
  await progress('trash', { revision: 2, deleted: true, stateRequestResolution: 'not-verified-no-readonly-api' });
  setStage('作成要求照合');
  const resolved = await rpc('memo_resolve_request', base);
  check(resolved?.status === 'saved' && equal(resolved.result, saved));
  return { revision: 2, deleted: true, pinned: false, creationRequestResolved: true,
    stateRequestResolution: 'not-verified-no-readonly-api', taggedMemoTransition: 'not-tested-empty-tags' };
}

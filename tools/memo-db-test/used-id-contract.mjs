import { isDeepStrictEqual } from 'node:util';
function check(v) { if (!v) throw new Error('verification failed'); }
function shape(s) { check(s && Array.isArray(s.memos) && Array.isArray(s.tags) && Array.isArray(s.memoTags)); }
export async function runUsedIdCase({ base, secondRequestId, userId, snapshot, rpc, confirm, progress = async () => {}, setStage = () => {} }) {
  check(base.p_expected_revision === null && Array.isArray(base.p_tag_ids) && base.p_tag_ids.length === 0
    && typeof secondRequestId === 'string' && secondRequestId !== base.p_request_id);
  setStage('作成前確認');
  const before = await snapshot(); shape(before);
  check(!before.memos.some((m) => m.id === base.p_id));
  check(await confirm('create', base.p_id));
  setStage('初回作成');
  const saved = await rpc('memo_save', base);
  const m = saved?.memo;
  check(m && m.id === base.p_id && m.user_id === userId && m.title === base.p_title && m.body === base.p_body
    && String(m.revision) === '1' && m.last_request_id === base.p_request_id
    && m.pinned_at === null && m.deleted_at === null && typeof m.created_at === 'string'
    && Number.isFinite(Date.parse(m.created_at)) && m.created_at === m.updated_at
    && Array.isArray(saved.tagIds) && saved.tagIds.length === 0);
  const baseline = await snapshot(); shape(baseline);
  const matching = baseline.memos.filter((row) => row.id === base.p_id);
  const others = (s) => s.memos.filter((row) => row.id !== base.p_id).sort((a,b) => a.id.localeCompare(b.id));
  check(matching.length === 1 && isDeepStrictEqual(matching[0], m)
    && baseline.memos.length === before.memos.length + 1 && isDeepStrictEqual(others(baseline), others(before))
    && isDeepStrictEqual(baseline.tags, before.tags) && isDeepStrictEqual(baseline.memoTags, before.memoTags));
  await progress('create');
  const prior = await snapshot(); shape(prior); check(isDeepStrictEqual(prior, baseline));
  check(await confirm('reuse', base.p_id));
  setStage('使用済みIDの別要求作成');
  const response = await rpc('memo_save', { ...base, p_request_id: secondRequestId }, true);
  check(response.status === 409 && response.error?.code === 'PT409' && response.error?.message === 'previously used memo id');
  setStage('拒否後の全データ不変確認');
  const after = await snapshot(); shape(after); check(isDeepStrictEqual(after, prior));
  await progress('reuse');
}

import { isDeepStrictEqual } from 'node:util';
function check(value) { if (!value) throw new Error('verification failed'); }
function shape(s) { check(s && Array.isArray(s.memos) && Array.isArray(s.tags) && Array.isArray(s.memoTags)); }
export async function runMixCase({ base, alternateId, userId, snapshot, rpc, confirm, progress = async () => {}, setStage = () => {} }) {
  check(base.p_id !== alternateId && base.p_expected_revision === null && base.p_tag_ids.length === 0);
  setStage('初期スナップショット');
  const before = await snapshot(); shape(before);
  check(!before.memos.some((m) => m.id === base.p_id || m.id === alternateId));
  check(await confirm('create', base.p_id));
  setStage('専用メモ初回保存');
  const saved = await rpc('memo_save', base);
  const m = saved?.memo;
  check(m && m.id === base.p_id && m.user_id === userId && m.title === base.p_title && m.body === base.p_body
    && String(m.revision) === '1' && m.last_request_id === base.p_request_id
    && m.pinned_at === null && m.deleted_at === null && typeof m.created_at === 'string'
    && Number.isFinite(Date.parse(m.created_at)) && m.created_at === m.updated_at
    && Array.isArray(saved.tagIds) && saved.tagIds.length === 0);
  const baseline = await snapshot(); shape(baseline);
  check(isDeepStrictEqual(baseline, { ...before, memos: [...before.memos, m].sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)) }));
  await progress('create');
  const attempts = [
    ['content', 'memo_save', { ...base, p_body: base.p_body + '\nchanged' }, base.p_id],
    ['target', 'memo_save', { ...base, p_id: alternateId }, alternateId],
    ['operation', 'memo_change_state', { p_id: base.p_id, p_request_id: base.p_request_id, p_expected_revision: 1, p_action: 'pin' }, base.p_id],
  ];
  for (const [kind, name, payload, target] of attempts) {
    setStage(`${kind}: 前状態`);
    const prior = await snapshot(); shape(prior); check(isDeepStrictEqual(prior, baseline));
    check(await confirm(kind, target));
    setStage(`${kind}: 拒否応答`);
    const response = await rpc(name, payload, true);
    check(response.status === 400 && response.error?.code === '22023'
      && response.error?.message === 'request id reused with different operation or content');
    setStage(`${kind}: 不変確認`);
    const after = await snapshot(); shape(after); check(isDeepStrictEqual(after, prior));
    await progress(kind);
  }
}

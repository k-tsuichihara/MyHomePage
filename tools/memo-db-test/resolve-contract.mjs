const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function check(value) { if (!value) throw new Error('verification failed'); }
export function validateRunId(value) { check(typeof value === 'string' && UUID.test(value)); }

export function buildSubmitted(updateRunId, records, projectHost) {
  validateRunId(updateRunId);
  const { update: u, updateResult: r, creation: c, creationResult: cr } = records;
  check(u && r && c && cr);
  validateRunId(u.sourceRunId); validateRunId(u.memoId); validateRunId(u.requestId); validateRunId(c.requestId);
  check(u.version === 1 && u.test === 'update-read' && u.status === 'prepared'
    && u.runId === updateRunId && u.expectedRevision === 1 && u.projectHost === projectHost
    && typeof u.userId === 'string' && u.userId.length > 0);
  check(r.version === 1 && r.test === 'update-read' && r.status === 'passed'
    && r.runId === u.runId && r.sourceRunId === u.sourceRunId && r.memoId === u.memoId
    && r.requestId === u.requestId && r.revision === 2);
  check(c.version === 1 && c.test === 'create-read' && c.status === 'prepared'
    && c.runId === u.sourceRunId && c.memoId === u.memoId && c.userId === u.userId
    && c.projectHost === projectHost && c.requestId !== u.requestId);
  check(cr.version === 1 && cr.test === 'create-read' && cr.status === 'passed'
    && cr.runId === c.runId && cr.memoId === c.memoId && cr.revision === 1);
  // 更新テストv1の固定生成式。現在のDB内容から要求を推測しない。
  return { p_id: u.memoId, p_request_id: u.requestId,
    p_title: `DBTEST-${u.sourceRunId}`,
    p_body: `update-read test ${u.runId}\n正常更新・引用符 "・タブ\tを保持`,
    p_tag_ids: [], p_expected_revision: 1 };
}

export function verifyResolved(response, submitted, userId) {
  check(response?.status === 'saved');
  const memo = response?.result?.memo;
  const tags = response?.result?.tagIds;
  check(memo && memo.id === submitted.p_id && memo.user_id === userId
    && memo.title === submitted.p_title && memo.body === submitted.p_body
    && String(memo.revision) === '2' && memo.last_request_id === submitted.p_request_id
    && memo.pinned_at === null && memo.deleted_at === null
    && Array.isArray(tags) && tags.length === 0);
  check(typeof memo.created_at === 'string' && typeof memo.updated_at === 'string'
    && Number.isFinite(Date.parse(memo.created_at)) && Number.isFinite(Date.parse(memo.updated_at))
    && Date.parse(memo.updated_at) > Date.parse(memo.created_at));
}

export async function resolveOnce(origin, key, token, submitted, requestJson) {
  return requestJson(`${origin}/rest/v1/rpc/memo_resolve_request`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(submitted),
  });
}

import { randomUUID } from 'node:crypto';
import { validateRunId, resolveOnce } from './resolve-contract.mjs';

// 全JSON記録内のUUID文字列を保守的に予約する（requestId以外も含む）。
export function collectRecordedIds(records) {
  const ids = new Set();
  function visit(value) {
    if (typeof value === 'string') {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) ids.add(value.toLowerCase());
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  }
  records.forEach(visit);
  return ids;
}
export function freshId(ids, generate = randomUUID) {
  for (let i = 0; i < 16; i++) {
    const id = generate();
    validateRunId(id);
    if (!ids.has(id)) { ids.add(id); return id; }
  }
  throw new Error('cannot allocate unique id');
}
export function missingSubmitted(memoId, requestId) {
  validateRunId(memoId); validateRunId(requestId);
  if (memoId === requestId) throw new Error('duplicate id');
  return { p_id: memoId, p_request_id: requestId, p_title: 'DBTEST missing request',
    p_body: '', p_tag_ids: [], p_expected_revision: null };
}
export async function verifyMissingOnce(origin, key, token, submitted, requestJson) {
  // 共通requestJsonはHTTP非成功・タイムアウト・JSON解析失敗を例外にする。
  const response = await resolveOnce(origin, key, token, submitted, requestJson);
  if (response !== null) throw new Error('expected strict null');
}

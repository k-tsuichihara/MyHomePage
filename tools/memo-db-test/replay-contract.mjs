import { isDeepStrictEqual } from 'node:util';
function check(value) { if (!value) throw new Error('verification failed'); }
function snapshotShape(data) {
  check(data && Array.isArray(data.memos) && Array.isArray(data.tags) && Array.isArray(data.memoTags));
}
function initial(saved, submitted, userId) {
  const memo = saved?.memo;
  check(memo && memo.id === submitted.p_id && memo.user_id === userId
    && memo.title === submitted.p_title && memo.body === submitted.p_body
    && String(memo.revision) === '1' && memo.last_request_id === submitted.p_request_id
    && memo.pinned_at === null && memo.deleted_at === null
    && typeof memo.created_at === 'string' && Number.isFinite(Date.parse(memo.created_at))
    && memo.created_at === memo.updated_at && Array.isArray(saved.tagIds) && saved.tagIds.length === 0);
}
export async function runReplayCase({ submitted, userId, snapshot, save, setStage = () => {} }) {
  check(submitted.p_expected_revision === null && Array.isArray(submitted.p_tag_ids) && submitted.p_tag_ids.length === 0);
  // 1回だけ文字列化。1回目と再送で同一のHTTPボディを使用する。
  const body = JSON.stringify(submitted);
  const expected = JSON.parse(body);
  setStage('作成前読み込み');
  const before = await snapshot(); snapshotShape(before);
  check(!before.memos.some((memo) => memo.id === expected.p_id));
  setStage('初回保存（結果不明の可能性あり）');
  const first = await save(body); initial(first, expected, userId);
  setStage('初回保存後の照合');
  const middle = await snapshot(); snapshotShape(middle);
  const matches = middle.memos.filter((memo) => memo.id === expected.p_id);
  check(matches.length === 1 && isDeepStrictEqual(matches[0], first.memo));
  check(!middle.memoTags.some((relation) => relation.memo_id === expected.p_id));
  const others = (rows) => rows.filter((memo) => memo.id !== expected.p_id).sort((a, b) => a.id.localeCompare(b.id));
  check(middle.memos.length === before.memos.length + 1
    && isDeepStrictEqual(others(before.memos), others(middle.memos))
    && isDeepStrictEqual(before.tags, middle.tags) && isDeepStrictEqual(before.memoTags, middle.memoTags));
  setStage('同一要求の再送（結果不明の可能性あり）');
  const replay = await save(body);
  check(isDeepStrictEqual(replay, first));
  setStage('再送後の不変照合');
  const after = await snapshot(); snapshotShape(after);
  check(isDeepStrictEqual(after, middle));
}

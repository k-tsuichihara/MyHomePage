import { tagKey } from './input';
import { persistedMemo, persistedTag } from './legacy-validation';
import type { MemoData, Memo, Tag, MemoTagRelation } from './types';
import type { CloudSnapshot, DbMemoRow, DbTagRow, DbMemoTagRow } from './read-types';
import { array, guarded, instant, nullable, record, reject, revision, unique, uuid, uuidKey } from './read-primitives';

function collections(input: unknown): Record<string, unknown> {
  return record(input, ['memos', 'tags', 'memoTags']);
}
/**
 * 検証済みの各行を集合全体で照合する。重複や孤立関連は削除・補修せず全体拒否する。
 * UUIDは比較時だけ大小文字を同一視し、タグ名はSQLと同じASCII限定キーで比較する。
 * メモとタグは別のID名前空間として扱い、両者間の同一UUIDまでは禁止しない。
 */
function integrity(memoIds: string[], tagIds: string[], names: string[], links: [string, string][]): void {
  const memos = unique(memoIds.map(uuidKey)), tags = unique(tagIds.map(uuidKey));
  unique(names.map(tagKey));
  unique(links.map(([memo, tag]) => `${uuidKey(memo)}/${uuidKey(tag)}`));
  if (links.some(([memo, tag]) => !memos.has(uuidKey(memo)) || !tags.has(uuidKey(tag)))) reject('integrity');
}
/**
 * ローカル形式の全フィールドと集合間の整合性を検証し、全行・配列を再構築して返す。
 * 入力の後続変更から結果を独立させるため、検証だけして元オブジェクトを返さない。
 * 未知項目・不正値があればReadValidationErrorで全体を拒否し、入力は書き換えない。
 */
export function validateMemoData(input: unknown): MemoData {
  return guarded(() => {
    const data = collections(input);
    const memos: Memo[] = array(data.memos).map(raw => {
      const row = record(raw, ['id', 'title', 'body', 'createdAt', 'updatedAt', 'pinnedAt', 'deletedAt', 'revision', 'lastRequestId']);
      return { id: uuid(row.id), ...persistedMemo(row.title, row.body), createdAt: instant(row.createdAt),
        updatedAt: instant(row.updatedAt), pinnedAt: nullable(row.pinnedAt, instant), deletedAt: nullable(row.deletedAt, instant),
        revision: revision(row.revision) as number, lastRequestId: nullable(row.lastRequestId, uuid) };
    });
    const tags: Tag[] = array(data.tags).map(raw => {
      const row = record(raw, ['id', 'name', 'createdAt', 'revision']);
      return { id: uuid(row.id), name: persistedTag(row.name), createdAt: instant(row.createdAt), revision: revision(row.revision) as number };
    });
    const memoTags: MemoTagRelation[] = array(data.memoTags).map(raw => {
      const row = record(raw, ['memoId', 'tagId']);
      return { memoId: uuid(row.memoId), tagId: uuid(row.tagId) };
    });
    integrity(memos.map(row => row.id), tags.map(row => row.id), tags.map(row => row.name), memoTags.map(row => [row.memoId, row.tagId]));
    return { memos, tags, memoTags };
  });
}
/**
 * DB snapshotの全フィールド・所有者・参照整合性を検証し、独立したデータを返す。
 * @param input 未検証のRPC応答。nullを空データとして扱わない。
 * @param expectedUserId 呼出側が指定する期待ユーザーID。認証処理そのものは行わない。
 * @returns snake_case、日時・UUIDの表記、revisionの数値／文字列を保持したsnapshot。
 * @throws 不正値・所有者不一致などがあれば、実値を含まないReadValidationErrorで全体拒否。
 * DB列追加も未知項目として拒否するため、スキーマ拡張時には検証契約とテストの更新が必要。
 */
export function validateCloudSnapshot(input: unknown, expectedUserId: string): CloudSnapshot {
  return guarded(() => {
    const owner = uuidKey(uuid(expectedUserId));
    // 関連行を含め全行の所有者を照合する。RLSや認証の代替ではない。
    const owned = (raw: unknown): string => {
      const id = uuid(raw);
      return uuidKey(id) === owner ? id : reject('integrity');
    };
    const data = collections(input);
    const memos: DbMemoRow[] = array(data.memos).map(raw => {
      const row = record(raw, ['id', 'user_id', 'title', 'body', 'created_at', 'updated_at', 'pinned_at', 'deleted_at', 'revision', 'last_request_id']);
      return { id: uuid(row.id), user_id: owned(row.user_id), ...persistedMemo(row.title, row.body),
        created_at: instant(row.created_at), updated_at: instant(row.updated_at), pinned_at: nullable(row.pinned_at, instant),
        deleted_at: nullable(row.deleted_at, instant), revision: revision(row.revision, true), last_request_id: nullable(row.last_request_id, uuid) };
    });
    const tags: DbTagRow[] = array(data.tags).map(raw => {
      const row = record(raw, ['id', 'user_id', 'name', 'created_at', 'revision']);
      return { id: uuid(row.id), user_id: owned(row.user_id), name: persistedTag(row.name), created_at: instant(row.created_at), revision: revision(row.revision, true) };
    });
    const memoTags: DbMemoTagRow[] = array(data.memoTags).map(raw => {
      const row = record(raw, ['user_id', 'memo_id', 'tag_id']);
      return { user_id: owned(row.user_id), memo_id: uuid(row.memo_id), tag_id: uuid(row.tag_id) };
    });
    integrity(memos.map(row => row.id), tags.map(row => row.id), tags.map(row => row.name), memoTags.map(row => [row.memo_id, row.tag_id]));
    return { memos, tags, memoTags };
  });
}

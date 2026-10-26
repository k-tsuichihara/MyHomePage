import { instantOrderKey } from './instant-order';
import { array, guarded, record, reject, string, unique, uuid, uuidKey } from './read-primitives';
import { validateMemoData } from './snapshot-validation';
import type { Memo, Tag } from './types';

export type MemoSort = 'updated-desc' | 'updated-asc' | 'created-desc' | 'created-asc';
export interface MemoQuery { view: 'normal' | 'trash'; text: string; selectedTagIds: string[]; sort: MemoSort }
export interface MemoQueryResult {
  query: MemoQuery;
  effectiveSort: MemoSort | 'deleted-desc';
  items: Array<{ memo: Memo; tags: Tag[] }>;
  orderedIds: string[];
  resultCount: number;
  missingSelectedTagIds: string[];
}

function parseQuery(input: unknown): MemoQuery {
  if (input === undefined) input = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return reject('structure');
  const keys = Object.keys(input);
  if (keys.some(key => !['view', 'text', 'selectedTagIds', 'sort'].includes(key))) return reject('structure');
  const row = record(input, keys);
  const view = Object.hasOwn(row, 'view') ? row.view : 'normal';
  const sort = Object.hasOwn(row, 'sort') ? row.sort : 'updated-desc';
  if (view !== 'normal' && view !== 'trash') return reject('structure');
  if (!['updated-desc', 'updated-asc', 'created-desc', 'created-asc'].includes(sort as string)) return reject('structure');
  const text = Object.hasOwn(row, 'text') ? string(row.text).trim() : '';
  const selected = Object.hasOwn(row, 'selectedTagIds') ? array(row.selectedTagIds).map(uuid) : [];
  const seen = new Set<string>();
  const selectedTagIds = selected.filter(id => {
    const key = uuidKey(id);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  return { view, text, selectedTagIds, sort: sort as MemoSort };
}

/**
 * 検索は保存・タグ一意性とは別の比較規則。Unicode小文字化だけを比較値へ適用する。
 * 複数フィールドの連結やUnicode正規化による、意図しない一致を作らない。
 * @param input 読込成功後のMemoData。保存形式や失敗結果を空データへ変換しない。
 * @param options 省略可能な検索条件。不在タグの選択も返却して呼出側で案内できるようにする。
 * @returns 元入力から独立した一覧と、詳細画面へ渡せる並び順。
 * @throws 不正行・関連・検索条件があれば、実値を含まないReadValidationErrorで全体拒否する。
 */
export function queryMemos(input: unknown, options?: unknown): MemoQueryResult {
  return guarded(() => {
    const data = validateMemoData(input), query = parseQuery(options);
    const tagMap = new Map(data.tags.map(tag => [uuidKey(tag.id), tag]));
    const links = new Map<string, Tag[]>();
    for (const relation of data.memoTags) {
      const key = uuidKey(relation.memoId), tags = links.get(key) ?? [];
      tags.push(tagMap.get(uuidKey(relation.tagId))!); links.set(key, tags);
    }
    const selected = new Set(query.selectedTagIds.map(uuidKey));
    const needle = query.text.toLowerCase();
    const items = data.memos.filter(memo => (memo.deletedAt !== null) === (query.view === 'trash')).map(memo => ({ memo, tags: links.get(uuidKey(memo.id)) ?? [] }))
      .filter(({ memo, tags }) => (!selected.size || tags.some(tag => selected.has(uuidKey(tag.id))))
        && (!needle || [memo.title, memo.body, ...tags.map(tag => tag.name)].some(value => value.toLowerCase().includes(needle))));
    const instants = new Map<string, bigint>();
    const time = (value: string): bigint => {
      if (!instants.has(value)) instants.set(value, instantOrderKey(value));
      return instants.get(value)!;
    };
    const order = (a: bigint, b: bigint): number => a < b ? -1 : a > b ? 1 : 0;
    items.sort(({ memo: a }, { memo: b }) => {
      let compared: number;
      if (query.view === 'trash') compared = order(time(b.deletedAt!), time(a.deletedAt!));
      else if ((a.pinnedAt !== null) !== (b.pinnedAt !== null)) return a.pinnedAt !== null ? -1 : 1;
      else if (a.pinnedAt !== null && b.pinnedAt !== null) compared = order(time(b.pinnedAt), time(a.pinnedAt));
      else {
        const field = query.sort.startsWith('created-') ? 'createdAt' : 'updatedAt';
        compared = query.sort.endsWith('-asc') ? order(time(a[field]), time(b[field])) : order(time(b[field]), time(a[field]));
      }
      if (compared) return compared;
      const x = uuidKey(a.id), y = uuidKey(b.id);
      return x < y ? -1 : x > y ? 1 : 0;
    });
    return { query, effectiveSort: query.view === 'trash' ? 'deleted-desc' : query.sort, items,
      orderedIds: items.map(row => row.memo.id), resultCount: items.length,
      missingSelectedTagIds: query.selectedTagIds.filter(id => !tagMap.has(uuidKey(id))) };
  });
}

export type MemoNeighbors = { kind: 'found'; position: number; total: number; previousId: string | null; nextId: string | null }
  | { kind: 'not-in-result'; total: number };

/** 一覧の結果順をそのまま使う。結果外の現在IDを、先頭メモへ暗黙に置き換えない。 */
export function getMemoNeighbors(orderedIds: unknown, currentId: unknown): MemoNeighbors {
  return guarded(() => {
    const ids = array(orderedIds).map(uuid), key = uuidKey(uuid(currentId));
    unique(ids.map(uuidKey));
    const index = ids.findIndex(id => uuidKey(id) === key);
    if (index < 0) return { kind: 'not-in-result', total: ids.length };
    return { kind: 'found', position: index + 1, total: ids.length, previousId: ids[index - 1] ?? null, nextId: ids[index + 1] ?? null };
  });
}

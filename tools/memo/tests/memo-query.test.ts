import { describe, expect, it } from 'vitest';
import { getMemoNeighbors, queryMemos, type MemoSort } from '../src/memo-query';
import { countTagUsage } from '../src/tag-usage';
import { ReadValidationError } from '../src/read-primitives';
import type { Memo, MemoData } from '../src/types';

const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, '0')}`;
const early = '2026-10-25T00:00:00Z', late = '2026-10-26T00:00:00Z';
const memo = (n: number, changes: Partial<Memo> = {}): Memo => ({
  id: id(n), title: `メモ${n}`, body: '', createdAt: early, updatedAt: early,
  pinnedAt: null, deletedAt: null, revision: 1, lastRequestId: null, ...changes,
});
function data(): MemoData {
  return {
    memos: [memo(1, { title: 'Alpha', body: '本文 first' }), memo(2, { title: 'Beta', body: 'SECOND' }),
      memo(3, { title: 'ゴミ箱', deletedAt: late })],
    tags: [{ id: id(10), name: 'Äpfel', createdAt: early, revision: 1 },
      { id: id(11), name: '仕事', createdAt: early, revision: 1 }],
    memoTags: [{ memoId: id(1), tagId: id(10) }, { memoId: id(2), tagId: id(11) }, { memoId: id(3), tagId: id(10) }],
  };
}
function freeze(value: unknown): void {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
}

describe('一覧の検索・タグ絞り込み', () => {
  it('初期値は通常一覧・更新日降順であり、正常な空集合を受理する', () => {
    expect(queryMemos(data()).orderedIds).toEqual([id(1), id(2)]);
    expect(queryMemos(data()).query).toEqual({ view: 'normal', sort: 'updated-desc', text: '', selectedTagIds: [] });
    expect(queryMemos({ memos: [], tags: [], memoTags: [] }).resultCount).toBe(0);
  });
  it.each([[' alpha ', [1]], ['second', [2]], ['äPFEL', [1]], ['本文', [1]], [' \t\n', [1, 2]], ['alpha first', []]])
  ('タイトル・本文・関連タグを単一文字列で検索する %s', (text, expected) => {
    expect(queryMemos(data(), { text }).orderedIds).toEqual((expected as number[]).map(id));
  });
  it('内部空白を分割せず、フィールド間を連結しない', () => {
    const input = data(); input.memos[0]!.body = 'one  two';
    expect(queryMemos(input, { text: 'one two' }).resultCount).toBe(0);
    expect(queryMemos(input, { text: 'one  two' }).resultCount).toBe(1);
    expect(queryMemos(input, { text: 'Alphaone' }).resultCount).toBe(0);
  });
  it('Unicode正規化や全角半角変換・完全なcase foldingは行わない', () => {
    const input = data(); input.memos[0]!.title = 'é Ａ ß';
    expect(queryMemos(input, { text: 'e\u0301' }).resultCount).toBe(0);
    expect(queryMemos(input, { text: 'a' }).orderedIds).toEqual([id(2)]);
    expect(queryMemos(input, { text: 'ss' }).resultCount).toBe(0);
  });
  it('選択タグはOR、文字検索とはAND。UUIDは比較時のみ大小文字同値', () => {
    const options = { selectedTagIds: [id(10).toUpperCase(), id(11)], text: 'second' };
    expect(queryMemos(data(), options).orderedIds).toEqual([id(2)]);
    expect(queryMemos(data(), { selectedTagIds: [id(10)] }).orderedIds).toEqual([id(1)]);
  });
  it('不在タグを通知し、選択を黙って解除せず、同値の重複だけ除く', () => {
    const selectedTagIds = [id(99).toUpperCase(), id(10).toUpperCase(), id(10)];
    const result = queryMemos(data(), { selectedTagIds });
    expect(result.query.selectedTagIds).toEqual(selectedTagIds.slice(0, 2));
    expect(result.missingSelectedTagIds).toEqual([id(99).toUpperCase()]);
    expect(result.orderedIds).toEqual([id(1)]);
    expect(queryMemos(data(), { selectedTagIds: [id(99)] }).resultCount).toBe(0);
  });
  it('検索結果件数と通常メモ全体のタグ使用件数は独立する', () => {
    const input = data(); input.memoTags.push({ memoId: id(2), tagId: id(10) });
    expect(queryMemos(input, { text: 'alpha' }).resultCount).toBe(1);
    expect(countTagUsage(input)).toEqual([{ tagId: id(10), count: 2 }, { tagId: id(11), count: 1 }]);
  });
  it('ゴミ箱にも同じ検索・タグ条件を適用し、関連UUIDの大小文字を同一視する', () => {
    const input = data();
    input.memoTags[2] = { memoId: id(3).toUpperCase(), tagId: id(10).toUpperCase() };
    const result = queryMemos(input, { view: 'trash', text: 'äpfel', selectedTagIds: [id(10)] });
    expect(result.orderedIds).toEqual([id(3)]);
    expect(queryMemos(input, { view: 'trash', text: 'alpha' }).resultCount).toBe(0);
    expect(queryMemos(input, { view: 'trash', selectedTagIds: [id(11)] }).resultCount).toBe(0);
  });
});

describe('一覧の並び順と前後移動', () => {
  it.each([
    ['updated-desc', [2, 1]], ['updated-asc', [1, 2]],
    ['created-desc', [1, 2]], ['created-asc', [2, 1]],
  ] as const)('並び替え %s', (sort, expected) => {
    const input = data(); input.memos[0]!.createdAt = late; input.memos[1]!.updatedAt = late;
    expect(queryMemos(input, { sort }).orderedIds).toEqual(expected.map(id));
  });
  it.each(['updated-desc', 'updated-asc', 'created-desc', 'created-asc'] satisfies MemoSort[])
  ('ピンは%sより優先し、ピン日時降順・同値ID順を使う', sort => {
    const input = data(); input.memos = [memo(4, { pinnedAt: early }), memo(2, { pinnedAt: late }),
      memo(1, { id: id(1).toUpperCase(), pinnedAt: late }), memo(5, { updatedAt: late }), memo(6, { pinnedAt: early })];
    const expected = [id(1).toUpperCase(), id(2), id(4), id(6), id(5)];
    input.memoTags = [];
    expect(queryMemos(input, { sort }).orderedIds).toEqual(expected);
    input.memos.reverse(); expect(queryMemos(input, { sort }).orderedIds).toEqual(expected);
  });
  it('オフセット・6桁小数秒を比較し、日時文字列を保持する', () => {
    const input = data(); input.memoTags = [];
    input.memos = [memo(1, { updatedAt: '2026-10-26T09:00:00.123455+09:00' }),
      memo(2, { updatedAt: '2026-10-26T00:00:00.123456Z' }),
      memo(4, { updatedAt: '2026-10-25T23:00:00.123456-01:00' })];
    expect(queryMemos(input).orderedIds).toEqual([id(2), id(4), id(1)]);
    expect(queryMemos(input).items[2]!.memo.updatedAt).toBe(input.memos[0]!.updatedAt);
    input.memos.reverse(); expect(queryMemos(input).orderedIds).toEqual([id(2), id(4), id(1)]);
  });
  it('ゴミ箱はピン・通常ソートに依存せず削除日時降順・同値ID順', () => {
    const input = data(); input.memoTags = [];
    input.memos = [memo(3, { deletedAt: early, pinnedAt: late }), memo(2, { deletedAt: late }),
      memo(1, { deletedAt: '2026-10-26T09:00:00+09:00' }), memo(4)];
    const result = queryMemos(input, { view: 'trash', sort: 'created-asc' });
    expect(result.orderedIds).toEqual([id(1), id(2), id(3)]);
    expect(result.effectiveSort).toBe('deleted-desc'); expect(result.query.sort).toBe('created-asc');
  });
  it('検索・絞り込み済みの一覧順をそのまま詳細の前後移動へ渡す', () => {
    const ids = queryMemos(data()).orderedIds;
    expect(getMemoNeighbors(ids, id(1).toUpperCase())).toEqual({ kind: 'found', position: 1, total: 2, previousId: null, nextId: id(2) });
    expect(getMemoNeighbors(ids, id(2))).toEqual({ kind: 'found', position: 2, total: 2, previousId: id(1), nextId: null });
    expect(getMemoNeighbors([id(2)], id(2))).toEqual({ kind: 'found', position: 1, total: 1, previousId: null, nextId: null });
    expect(getMemoNeighbors(ids, id(3))).toEqual({ kind: 'not-in-result', total: 2 });
    expect(getMemoNeighbors([], id(1))).toEqual({ kind: 'not-in-result', total: 0 });
  });
});

describe('全体拒否・非破壊性', () => {
  it('凍結入力を変更せず、返却データは入力の後続変更から独立する', () => {
    const input = data(), before = structuredClone(input), options = { selectedTagIds: [id(10)], text: ' alpha ' };
    freeze(input); freeze(options);
    const result = queryMemos(input, options); expect(input).toEqual(before);
    const mutable = data(), mutableOptions = { selectedTagIds: [id(10)] };
    const independent = queryMemos(mutable, mutableOptions), saved = structuredClone(independent);
    mutable.memos[0]!.body = '変更'; mutable.tags[0]!.name = '変更'; mutable.memoTags.length = 0;
    mutableOptions.selectedTagIds.length = 0;
    expect(independent).toEqual(saved);
    result.items[0]!.memo.title = '返却値の変更'; expect(input).toEqual(before);
  });
  it.each([null, { ok: false }, { kind: 'pending' }, { version: 2, migration: { status: 'pending' } }])
  ('取得失敗やpendingを空一覧にしない', value => { expect(() => queryMemos(value)).toThrow(ReadValidationError); });
  it.each(['duplicate', 'orphan', 'unknown', 'revision', 'timestamp', 'tag', 'hidden-trash'])
  ('表示対象外も含め不正データ%sを全体拒否する', mode => {
    const input = data();
    if (mode === 'duplicate') input.memos.push({ ...input.memos[0]!, id: id(1).toUpperCase() });
    if (mode === 'orphan') input.memoTags[0]!.tagId = id(99);
    if (mode === 'unknown') Object.assign(input.tags[0]!, { extra: true });
    if (mode === 'revision') input.memos[0]!.revision = 0;
    if (mode === 'timestamp') input.memos[0]!.updatedAt = 'invalid';
    if (mode === 'tag') input.tags[0]!.name = '';
    if (mode === 'hidden-trash') input.memos[2]!.body = '\u0000';
    expect(() => queryMemos(input)).toThrow(ReadValidationError);
  });
  it.each([null, [], { view: 'all' }, { sort: 'id' }, { text: 1 }, { selectedTagIds: ['bad'] },
    { extra: true }, { text: undefined }, { selectedTagIds: Array(1) }])
  ('不正な検索条件を拒否する', options => { expect(() => queryMemos(data(), options)).toThrow(ReadValidationError); });
  it('条件のアクセサ・非列挙項目・例外に検索実値を漏らさない', () => {
    const accessor = Object.defineProperty({}, 'text', { enumerable: true, get() { throw new Error('private-search'); } });
    const hidden = Object.defineProperty({}, 'text', { value: 'private-search' });
    for (const options of [accessor, hidden]) {
      expect(() => queryMemos(data(), options)).toThrow(ReadValidationError);
      try { queryMemos(data(), options); } catch (error) { expect(String(error)).not.toContain('private-search'); }
    }
  });
  it.each([{ ids: [id(1), id(1).toUpperCase()] }, { ids: ['bad'] }, { ids: Array(1) }])('不正な前後移動一覧を拒否する', ({ ids }) => {
    expect(() => getMemoNeighbors(ids, id(1))).toThrow(ReadValidationError);
  });
  it('不正な現在IDを拒否する', () => { expect(() => getMemoNeighbors([], 'bad')).toThrow(ReadValidationError); });
});

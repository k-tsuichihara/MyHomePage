import { describe, expect, it } from 'vitest';
import { countTagUsage } from '../src/tag-usage';
import { state, TAG, TAG2, MEMO, OTHER, BEFORE } from './local-save-fixtures';

const data = () => { const { memos, tags, memoTags } = state(); return { memos, tags, memoTags }; };
describe('検証済みスナップショットからのタグ使用件数', () => {
  it('通常メモのみを数え、未使用タグとマスター順序・表記を保持する', () => {
    const input = data(); input.memos[1]!.deletedAt = BEFORE;
    expect(countTagUsage(input)).toEqual([{ tagId: TAG, count: 1 }, { tagId: TAG2, count: 0 }]);
    input.memos[1]!.deletedAt = null;
    expect(countTagUsage(input)).toEqual([{ tagId: TAG, count: 2 }, { tagId: TAG2, count: 0 }]);
  });
  it('複数タグ・UUIDの大小文字同値・全件ゴミ箱を扱う', () => {
    const input = data(); input.memoTags.push({ memoId: MEMO.toUpperCase(), tagId: TAG2.toUpperCase() });
    input.memoTags[1]!.memoId = OTHER.toUpperCase();
    expect(countTagUsage(input)).toEqual([{ tagId: TAG, count: 2 }, { tagId: TAG2, count: 1 }]);
    input.memos.forEach(row => { row.deletedAt = BEFORE; });
    expect(countTagUsage(input)).toEqual([{ tagId: TAG, count: 0 }, { tagId: TAG2, count: 0 }]);
  });
  it('空データ・未使用タグを保持し、凍結入力を変更しない', () => {
    expect(countTagUsage({ memos: [], tags: [], memoTags: [] })).toEqual([]);
    const input = data(), before = structuredClone(input);
    Object.freeze(input); Object.freeze(input.memos); Object.freeze(input.tags); Object.freeze(input.memoTags);
    input.memos.forEach(Object.freeze); input.tags.forEach(Object.freeze); input.memoTags.forEach(Object.freeze);
    countTagUsage(input); expect(input).toEqual(before);
  });
  it.each(['orphan', 'duplicate', 'unknown'])('不正な%s関連を黙って除外しない', mode => {
    const input = data();
    if (mode === 'orphan') input.memoTags[0]!.tagId = 'abcdef00-0000-4000-8000-000000000099';
    if (mode === 'duplicate') input.memoTags.push(input.memoTags[0]!);
    if (mode === 'unknown') Object.assign(input.tags[0]!, { extra: true });
    expect(() => countTagUsage(input)).toThrow();
  });
});

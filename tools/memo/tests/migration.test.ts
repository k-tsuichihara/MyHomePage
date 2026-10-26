import { describe, expect, it } from 'vitest';
import { completeMigration, createPendingMigration, validatePendingMigration } from '../src/migration';
import { ids, oldRows } from './migration-fixtures';

function pending() {
  let i = 0;
  const raw = JSON.stringify(oldRows());
  return { raw, value: createPendingMigration(raw, () => ids[i++]!) };
}
describe('非破壊の移行変換とpending照合', () => {
  it('文字列・順序・生JSONを保持し、UUIDと初期状態だけを付与する', () => {
    const { raw, value } = pending();
    expect(value).toEqual({ version: 2, migration: { status: 'pending', legacySnapshot: raw },
      memos: oldRows().map((row, i) => ({ id: ids[i], title: row.title, body: row.text, createdAt: row.createdAt,
        updatedAt: row.updatedAt, pinnedAt: null, deletedAt: null, revision: 1, lastRequestId: null })), tags: [], memoTags: [] });
    expect(validatePendingMigration(JSON.stringify(value), raw)).toEqual(value);
  });
  it('空配列も有効な旧データとして扱う', () => {
    expect(createPendingMigration('[]', () => { throw new Error('呼出禁止'); }).memos).toEqual([]);
  });
  it('後半の旧行が不正ならUUID生成前に全体拒否する', () => {
    let count = 0;
    expect(() => createPendingMigration(JSON.stringify([oldRows()[0], { ...oldRows()[1], title: '' }]), () => { count++; return ids[0]!; })).toThrow();
    expect(count).toBe(0);
  });
  it.each(['invalid', ids[0]!, ids[0]!.toUpperCase()])('不正または重複UUIDは再試行しない: %s', id => {
    let count = 0;
    expect(() => createPendingMigration(JSON.stringify(oldRows()), () => { count++; return id; })).toThrow();
    expect(count).toBe(id === 'invalid' ? 1 : 2);
  });
  it('旧IDがUUIDでも再利用しない（大小文字の別表記も同値）', () => {
    expect(() => createPendingMigration(JSON.stringify([{ ...oldRows()[0], id: ids[0]!.toUpperCase() }]), () => ids[0]!)).toThrow();
  });
  it('生成器の例外に含まれる情報を純粋関数からも漏らさない', () => {
    try {
      createPendingMigration(JSON.stringify(oldRows()), () => { throw new Error('PRIVATE-SYNTHETIC'); });
      throw new Error('拒否されること');
    } catch (error) {
      expect(String(error)).not.toContain('PRIVATE-SYNTHETIC');
      expect((error as Error).cause).toBeUndefined();
    }
  });
  it('complete変換で入力と子オブジェクトを変更・共有しない', () => {
    const { value } = pending(), before = structuredClone(value);
    const completed = completeMigration(value);
    expect(value).toEqual(before); expect(completed.migration.status).toBe('complete');
    completed.memos[0]!.title = '変更'; expect(value).toEqual(before);
  });
  it('元オブジェクトのキー順は照合に影響しない', () => {
    const { raw, value } = pending();
    const reordered = { memoTags: [], tags: [], memos: value.memos.map(row => Object.fromEntries(Object.entries(row).reverse())), migration: value.migration, version: 2 };
    expect(validatePendingMigration(JSON.stringify(reordered), raw)).toEqual(value);
  });
  it.each(['title', 'body', 'createdAt', 'updatedAt', 'pinnedAt', 'deletedAt', 'revision', 'lastRequestId'] as const)('pendingの%s不一致を拒否する', field => {
    const { raw, value } = pending();
    const changes = { title: '別タイトル', body: '別本文', createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z',
      pinnedAt: '2020-01-01T00:00:00Z', deletedAt: '2020-01-01T00:00:00Z', revision: 2, lastRequestId: ids[0] };
    Object.assign(value.memos[0]!, { [field]: changes[field] });
    expect(() => validatePendingMigration(JSON.stringify(value), raw)).toThrow();
  });
  it.each(['reorder', 'missing', 'extra', 'duplicate', 'tags', 'links', 'unknown', 'status', 'raw'] as const)('照合不能なpendingを拒否: %s', kind => {
    const { raw, value } = pending();
    if (kind === 'reorder') value.memos.reverse();
    if (kind === 'missing') value.memos.pop();
    if (kind === 'extra') value.memos.push({ ...value.memos[0]!, id: 'abcdef01-2345-4000-8000-000000000003' });
    if (kind === 'duplicate') value.memos[1]!.id = value.memos[0]!.id.toUpperCase();
    if (kind === 'tags') value.tags.push({ id: ids[0]!, name: 'タグ', createdAt: oldRows()[0]!.createdAt, revision: 1 });
    if (kind === 'links') value.memoTags.push({ memoId: ids[0]!, tagId: ids[1]! });
    if (kind === 'unknown') Object.assign(value.memos[0]!, { extra: true });
    if (kind === 'status') Object.assign(value.migration, { status: 'complete' });
    if (kind === 'raw') value.migration.legacySnapshot = ` ${raw}`;
    expect(() => validatePendingMigration(JSON.stringify(value), raw)).toThrow();
  });
});

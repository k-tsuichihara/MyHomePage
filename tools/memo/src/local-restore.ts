import { parseBackupBytes, BackupInputError } from './backup-json';
import { array, record, uuid, uuidKey, instant } from './read-primitives';
import { validateMemoData } from './snapshot-validation';
import { validateLocalV3 } from './local-format';
import type { MemoStorageV3 } from './local-format';
import type { Memo, Tag, MemoTagRelation } from './types';
import { tagKey } from './input';
import { immutable } from './editor-state';
import type { ReadyLocalData } from './local-data-store';
export type RestoreV3 = Extract<ReadyLocalData, { version: 3 }>;

export const MAX_RESTORE_BYTES = 16_777_216;
export interface RestoreRow { index: number; memo: Memo | null; reason: string | null; tagIds: string[]; warnings: string[] }
export interface RestoreBackup { rows: RestoreRow[]; tags: Tag[]; warnings: string[] }
const fail = (code: string): never => { throw new BackupInputError(code); };

/** 保存形式の全体検証を緩めず、外部ファイルの行診断を別モデルへ分離する。 */
export function diagnoseBackup(bytes: Uint8Array): RestoreBackup {
  try {
    const envelope = record(parseBackupBytes(bytes), ['format', 'backupVersion', 'sourceStorageVersion', 'exportedAt', 'data']);
    if (envelope.format !== 'myhomepage.memo.local-backup' || envelope.backupVersion !== 1 || envelope.sourceStorageVersion !== 3) fail('format');
    instant(envelope.exportedAt);
    const data = record(envelope.data, ['memos', 'tags', 'memoTags', 'deletedMemoIds']);
    const memos = array(data.memos), rawTags = array(data.tags), links = array(data.memoTags), deleted = array(data.deletedMemoIds);
    if (memos.length > 10000 || rawTags.length > 5000 || links.length > 100000 || deleted.length > 100000) fail('count');
    const deletedKeys = new Set(deleted.map(id => uuidKey(uuid(id))));
    if (deletedKeys.size !== deleted.length) fail('history');
    const tagCounts = new Map<string, number>();
    // 不正フィールドを持つ定義も、同じ有効IDを持つなら重複定義の一つに数える。
    for (const raw of rawTags) {
      try { const id = uuidKey(uuid((raw as { id?: unknown } | null)?.id)); tagCounts.set(id, (tagCounts.get(id) ?? 0) + 1); } catch { /* 行診断で報告 */ }
    }
    const warnings: string[] = [], tags: Tag[] = [];
    rawTags.forEach((raw, index) => {
      try {
        const checked = validateMemoData({ memos: [], tags: [raw], memoTags: [] }).tags[0]!;
        if (tagCounts.get(uuidKey(checked.id)) !== 1) throw new Error();
        tags.push(checked);
      } catch { warnings.push(`tag:${index}:invalid-or-duplicate`); }
    });
    const rows: RestoreRow[] = memos.map((raw, index) => {
      try {
        const memo = validateMemoData({ memos: [raw], tags: [], memoTags: [] }).memos[0]!;
        if (deletedKeys.has(uuidKey(memo.id))) throw new Error();
        return { index, memo, reason: null, tagIds: [], warnings: [] };
      } catch { return { index, memo: null, reason: 'invalid-memo', tagIds: [], warnings: [] }; }
    });
    const memoKeys = new Set(rows.flatMap(row => row.memo ? [uuidKey(row.memo.id)] : []));
    const tagMap = new Map(tags.map(tag => [uuidKey(tag.id), tag.id]));
    const related = new Map<string, Set<string>>();
    const affected = new Set<string>();
    links.forEach((raw, index) => {
      // 関連の形・型が壊れていれば全体停止、文字列UUIDの不正や不存在は警告して非採用。
      const link = record(raw, ['memoId', 'tagId']);
      if (typeof link.memoId !== 'string' || typeof link.tagId !== 'string') fail('relation-structure');
      let memo: string, tag: string;
      try { memo = uuidKey(uuid(link.memoId)); tag = uuidKey(uuid(link.tagId)); }
      catch {
        warnings.push(`relation:${index}:invalid-reference`);
        try { if (memoKeys.has(uuidKey(uuid(link.memoId)))) affected.add(uuidKey(uuid(link.memoId))); } catch { /* メモを識別できなければ全体警告だけ */ }
        return;
      }
      if (!memoKeys.has(memo) || !tagMap.has(tag)) { warnings.push(`relation:${index}:missing-reference`); if (memoKeys.has(memo)) affected.add(memo); return; }
      const set = related.get(memo) ?? new Set<string>();
      if (set.has(tag)) warnings.push(`relation:${index}:duplicate`);
      set.add(tag); related.set(memo, set);
    });
    const memoCounts = new Map<string, number>();
    for (const row of rows) if (row.memo) { const key = uuidKey(row.memo.id); memoCounts.set(key, (memoCounts.get(key) ?? 0) + 1); }
    for (const row of rows) if (row.memo) {
      row.tagIds = [...(related.get(uuidKey(row.memo.id)) ?? [])].map(id => tagMap.get(id)!);
      if (memoCounts.get(uuidKey(row.memo.id))! > 1) row.warnings.push('duplicate-source-id');
      if (affected.has(uuidKey(row.memo.id))) row.warnings.push('excluded-tag-reference');
    }
    return immutable({ rows, tags, warnings });
  } catch (error) {
    if (error instanceof BackupInputError) throw error;
    return fail('structure');
  }
}

/** 比較は変換前の元IDに基づく情報提供だけで、選択を勝手に変更しない。 */
export function compareRestoreRow(row: RestoreRow, backup: RestoreBackup, current: MemoStorageV3): string[] | null {
  if (!row.memo) return ['invalid'];
  const memo = row.memo, existing = current.memos.find(item => uuidKey(item.id) === uuidKey(memo.id));
  if (!existing) return null;
  const fields: (keyof Memo)[] = ['title', 'body', 'createdAt', 'updatedAt', 'pinnedAt', 'deletedAt', 'revision', 'lastRequestId'];
  const differences = fields.filter(field => field === 'lastRequestId'
    ? (existing[field]?.toLowerCase() ?? null) !== (memo[field]?.toLowerCase() ?? null) : existing[field] !== memo[field]);
  const signature = (ids: string[], tags: Tag[]) => ids.map(id => {
    const tag = tags.find(t => uuidKey(t.id) === uuidKey(id)); return `${uuidKey(id)}:${JSON.stringify(tag?.name)}`;
  }).sort().join('|');
  if (signature(row.tagIds, backup.tags) !== signature(current.memoTags.filter(link => uuidKey(link.memoId) === uuidKey(memo.id)).map(link => link.tagId), current.tags)) differences.push('id');
  return differences.map(field => field === 'id' ? 'tags' : field);
}

/** 既存の全行・履歴・metadataを保持し、追加候補全体を生成する純粋処理。 */
export function planRestore(current: RestoreV3, backup: RestoreBackup, selected: readonly number[], nowValue: string, createId: () => string): RestoreV3 {
  if (!selected.length || new Set(selected).size !== selected.length) fail('selection');
  const now = instant(nowValue), memoIds = new Set([...current.memos.map(m => uuidKey(m.id)), ...current.deletedMemoIds.map(uuidKey)]);
  const tagIds = new Set(current.tags.map(tag => uuidKey(tag.id)));
  const nextId = (used: Set<string>) => { const id = uuid(createId()); if (used.has(uuidKey(id))) fail('id-collision'); used.add(uuidKey(id)); return id; };
  const tags = [...current.tags], targetByName = new Map(current.tags.map(tag => [tagKey(tag.name), tag.id]));
  const remap = new Map<string, string>();
  const ordered = [...backup.tags].sort((a, b) => uuidKey(a.id) < uuidKey(b.id) ? -1 : uuidKey(a.id) > uuidKey(b.id) ? 1 : 0);
  for (const tag of ordered) {
    const name = tagKey(tag.name);
    let id = targetByName.get(name);
    if (!id) { id = nextId(tagIds); tags.push({ id, name: tag.name, createdAt: now, revision: 1 }); targetByName.set(name, id); }
    remap.set(uuidKey(tag.id), id);
  }
  const memos = [...current.memos], memoTags: MemoTagRelation[] = [...current.memoTags];
  for (const index of selected) {
    if (!Number.isInteger(index)) fail('selection');
    const row = backup.rows[index]; if (!row?.memo) fail('selection');
    const source = row!.memo!, id = nextId(memoIds);
    memos.push({ ...source, id, createdAt: now, updatedAt: now, revision: 1, lastRequestId: null,
      pinnedAt: source.pinnedAt === null ? null : now });
    const ids = new Set(row!.tagIds.map(tag => remap.get(uuidKey(tag))!));
    for (const tagId of ids) memoTags.push({ memoId: id, tagId });
  }
  const checked = validateLocalV3({ ...current, memos, tags, memoTags });
  if (checked.kind === 'validated-pending') fail('pending');
  const candidate = checked.value as RestoreV3;
  if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > MAX_RESTORE_BYTES) fail('candidate-size');
  return immutable(candidate);
}

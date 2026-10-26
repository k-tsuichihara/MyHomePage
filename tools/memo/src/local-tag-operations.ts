import { normalizeTagName, tagKey } from './input';
import { LocalDataError } from './local-data-store';
import type { ReadyLocalData } from './local-data-store';
import { instant, nullable, record, revision, uuid, uuidKey } from './read-primitives';

export function parseTagSave(input: unknown) {
  const row = record(input, ['id', 'name', 'expectedRevision', 'requestId']);
  return { id: uuid(row.id), name: normalizeTagName(row.name as string), expectedRevision: nullable(row.expectedRevision, raw => revision(raw) as number) };
}
export function parseTagDelete(input: unknown) {
  const row = record(input, ['id', 'expectedRevision', 'requestId']);
  return { id: uuid(row.id), expectedRevision: revision(row.expectedRevision) as number };
}

/** タグ名の一意性は表示値を変えずASCIIキーで照合し、メモのrevisionには触れない。 */
export function saveLocalTag(current: ReadyLocalData, request: ReturnType<typeof parseTagSave>, clock: () => string): ReadyLocalData {
  const index = current.tags.findIndex(row => uuidKey(row.id) === uuidKey(request.id));
  const existing = current.tags[index];
  if (request.expectedRevision === null) {
    if (existing) throw new LocalDataError('id-exists');
  } else {
    if (!existing) throw new LocalDataError('not-found');
    if (existing.revision !== request.expectedRevision) throw new LocalDataError('conflict');
    if (existing.revision === Number.MAX_SAFE_INTEGER) throw new LocalDataError('revision-limit');
  }
  if (current.tags.some((row, i) => i !== index && tagKey(row.name) === tagKey(request.name))) throw new LocalDataError('duplicate-tag');
  const tag = existing ? { ...existing, name: request.name, revision: existing.revision + 1 }
    : { id: request.id, name: request.name, createdAt: instant(clock()), revision: 1 };
  const tags = [...current.tags];
  if (existing) tags[index] = tag; else tags.push(tag);
  return { ...current, tags };
}

/**
 * 全体の参照整合性は書込基盤で読込時に検査済み。さらに全関連メモの加算可能性を先に確認する。
 * 1件でも上限なら何も書かない。SQLと異なりlastRequestIdは承認済みA案に従って保持する。
 */
export function deleteLocalTag(current: ReadyLocalData, request: ReturnType<typeof parseTagDelete>, clock: () => string): ReadyLocalData {
  const key = uuidKey(request.id);
  const tag = current.tags.find(row => uuidKey(row.id) === key);
  if (!tag) throw new LocalDataError('not-found');
  if (tag.revision !== request.expectedRevision) throw new LocalDataError('conflict');
  const affected = new Set(current.memoTags.filter(row => uuidKey(row.tagId) === key).map(row => uuidKey(row.memoId)));
  const related = current.memos.filter(row => affected.has(uuidKey(row.id)));
  if (related.length !== affected.size) throw new LocalDataError('invalid-data');
  if (related.some(row => row.revision === Number.MAX_SAFE_INTEGER)) throw new LocalDataError('revision-limit');
  const now = related.length ? instant(clock()) : null;
  return { ...current, tags: current.tags.filter(row => uuidKey(row.id) !== key),
    memoTags: current.memoTags.filter(row => uuidKey(row.tagId) !== key),
    memos: current.memos.map(row => affected.has(uuidKey(row.id)) ? { ...row, revision: row.revision + 1, updatedAt: now! } : row) };
}

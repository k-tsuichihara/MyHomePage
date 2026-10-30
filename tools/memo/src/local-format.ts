import { validateLocalV2 } from './local-validation';
import type { LocalV2ValidationResult, MemoStorageV2 } from './read-types';
import { array, guarded, parseJson, record, reject, unique, uuid, uuidKey } from './read-primitives';

type V3<T> = T extends MemoStorageV2 ? Omit<T, 'version'> & { version: 3; deletedMemoIds: string[] } : never;
export type MemoStorageV3 = V3<MemoStorageV2>;
type ResultV3<T> = T extends { value: MemoStorageV2 } ? Omit<T, 'value'> & { value: V3<T['value']> } : never;
export type LocalV3ValidationResult = ResultV3<LocalV2ValidationResult>;
export type LocalFormatResult = LocalV2ValidationResult | LocalV3ValidationResult;

/** v2原本の厳格性は変えず、v3の六項目と履歴を検証して独立した値を再構築する。 */
export function validateLocalV3(input: unknown): LocalV3ValidationResult {
  return guarded(() => {
    const row = record(input, ['version', 'migration', 'memos', 'tags', 'memoTags', 'deletedMemoIds']);
    if (row.version !== 3) return reject('structure');
    const checked = validateLocalV2({ version: 2, migration: row.migration, memos: row.memos, tags: row.tags, memoTags: row.memoTags });
    const deletedMemoIds = array(row.deletedMemoIds).map(uuid);
    const deleted = unique(deletedMemoIds.map(uuidKey));
    if (checked.value.memos.some(memo => deleted.has(uuidKey(memo.id)))) return reject('integrity');
    // kindとmigration状態の対応は既存検証器から保持する。v3 pendingも通常利用は不可。
    return { ...checked, value: { ...checked.value, version: 3, deletedMemoIds } } as LocalV3ValidationResult;
  });
}

/** 未知版をv2へフォールバックしない。未知・破損の双方で書込を止める。 */
export function validateLocalFormat(input: unknown): LocalFormatResult {
  return guarded(() => {
    if (!input || typeof input !== 'object') return reject('structure');
    const version = Object.getOwnPropertyDescriptor(input, 'version');
    if (!version || !('value' in version)) return reject('structure');
    if (version.value === 2) return validateLocalV2(input);
    if (version.value === 3) return validateLocalV3(input);
    return reject('structure');
  });
}
export function parseLocalFormatJson(raw: string): LocalFormatResult { return validateLocalFormat(parseJson(raw)); }

/** 診断専用の分類。未知版や不正値を空データに変換せず、実値を返さない。 */
export function identifyLocalJson(raw: string): 'v2' | 'v3' | 'unknown-version' | 'invalid' {
  try {
    const value = parseJson(raw);
    if (value && typeof value === 'object' && typeof (value as { version?: unknown }).version === 'number'
      && ![2, 3].includes((value as { version: number }).version)) return 'unknown-version';
    return parseLocalFormatJson(raw).value.version === 2 ? 'v2' : 'v3';
  } catch { return 'invalid'; }
}

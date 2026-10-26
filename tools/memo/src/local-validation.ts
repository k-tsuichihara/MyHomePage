import { parseLegacyJson } from './legacy-validation';
import type { LocalV2ValidationResult } from './read-types';
import { guarded, parseJson, record, reject, string } from './read-primitives';
import { validateMemoData } from './snapshot-validation';

/**
 * v2の構造・参照整合性と、存在するlegacySnapshotの旧形式全件を検証する。
 * 成功値は入力と独立して再構築するが、実キーとの照合・移行・書込は行わない。
 * pendingの検証成功は通常利用の許可ではないため、戻り値のkindで必ず区別する。
 * 不正データは補正せず、実値を含まないReadValidationErrorで全体を拒否する。
 */
export function validateLocalV2(input: unknown): LocalV2ValidationResult {
  return guarded(() => {
    const root = record(input, ['version', 'migration', 'memos', 'tags', 'memoTags']);
    if (root.version !== 2) return reject('structure');
    // getterを呼ばずに状態を確認し、状態ごとに許可するフィールドを厳密に限定する。
    if (root.migration === null || typeof root.migration !== 'object') return reject('structure');
    const status = Object.getOwnPropertyDescriptor(root.migration, 'status');
    if (!status || !('value' in status)) return reject('structure');
    const migration = record(root.migration, status.value === 'not-required' ? ['status'] : ['status', 'legacySnapshot']);
    const data = validateMemoData({ memos: root.memos, tags: root.tags, memoTags: root.memoTags });
    if (migration.status === 'not-required') {
      return { kind: 'validated-not-required', value: { version: 2, migration: { status: 'not-required' }, ...data } };
    }
    if (migration.status !== 'pending' && migration.status !== 'complete') return reject('structure');
    const legacySnapshot = string(migration.legacySnapshot);
    // complete後の通常編集を妨げないよう、現データと旧配列の恒久的一致は要求しない。
    const legacyItems = parseLegacyJson(legacySnapshot);
    if (migration.status === 'pending') {
      return { kind: 'validated-pending', value: { version: 2, migration: { status: 'pending', legacySnapshot }, ...data }, legacyItems };
    }
    return { kind: 'validated-complete', value: { version: 2, migration: { status: 'complete', legacySnapshot }, ...data }, legacyItems };
  });
}
/** JSON解析とv2検証の入口。キー読込や破損データの自動初期化は行わない。 */
export function parseLocalV2Json(raw: string): LocalV2ValidationResult { return validateLocalV2(parseJson(raw)); }

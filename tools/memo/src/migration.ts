import { parseLegacyJson } from './legacy-validation';
import { parseLocalV2Json, validateLocalV2 } from './local-validation';
import { guarded, ReadValidationError, uuid, uuidKey, unique } from './read-primitives';
import type { MemoStorageV2 } from './read-types';

export type PendingMigration = Extract<MemoStorageV2, { migration: { status: 'pending' } }>;
export type CompleteMigration = Extract<MemoStorageV2, { migration: { status: 'complete' } }>;

/** 全件検証後にだけUUIDを生成する。衝突時に暗黙の再生成・部分移行はしない。 */
export function createPendingMigration(legacySnapshot: string, createId: () => string): PendingMigration {
  return guarded(() => {
    const old = parseLegacyJson(legacySnapshot);
    const oldIds = new Set(old.map(row => uuidKey(row.id)));
    const memos = old.map(row => {
      const id = uuid(createId());
      if (oldIds.has(uuidKey(id))) throw new ReadValidationError('integrity');
      return { id, title: row.title, body: row.text, createdAt: row.createdAt, updatedAt: row.updatedAt,
        pinnedAt: null, deletedAt: null, revision: 1, lastRequestId: null };
    });
    unique(memos.map(row => uuidKey(row.id)));
    const result = validateLocalV2({ version: 2, migration: { status: 'pending', legacySnapshot }, memos, tags: [], memoTags: [] });
    if (result.kind !== 'validated-pending') throw new ReadValidationError('structure');
    return result.value;
  });
}

/**
 * 書込済みpendingを旧生文字列から導いた期待値と全項目・順序まで照合する。
 * 既存UUIDはそのまま検査に使い、復旧時の再発行やデータ補修は行わない。
 */
export function validatePendingMigration(pendingSnapshot: string, legacySnapshot: string): PendingMigration {
  return guarded(() => {
    const result = parseLocalV2Json(pendingSnapshot);
    if (result.kind !== 'validated-pending' || result.value.migration.legacySnapshot !== legacySnapshot) {
      throw new ReadValidationError('integrity');
    }
    let index = 0;
    const expected = createPendingMigration(legacySnapshot, () => {
      const row = result.value.memos[index++];
      if (!row) throw new ReadValidationError('integrity');
      return row.id;
    });
    // 両者は検証器が同じ順序で再構築したオブジェクト。元オブジェクトのキー順には依存しない。
    if (JSON.stringify(expected) !== JSON.stringify(result.value)) throw new ReadValidationError('integrity');
    return result.value;
  });
}

/** 検証済みpendingを再構築して返す。元オブジェクトやその子を変更しない。 */
export function completeMigration(pending: PendingMigration): CompleteMigration {
  return guarded(() => {
    const checked = validatePendingMigration(JSON.stringify(pending), pending.migration.legacySnapshot);
    return { ...checked, migration: { status: 'complete', legacySnapshot: checked.migration.legacySnapshot } };
  });
}

import { createEditor, editDraft } from './editor-state';
import type { Memo } from './types';

/** 永続IDではない編集用仮ID。controllerが最初の明示保存時に置き換える。 */
export const DUPLICATE_DRAFT_ID = '00000000-0000-0000-0000-000000000000';

/** 保存済み通常メモだけをコピーし、空の基準値との差として未保存確認を有効にする。
 * localは従来の仮ID、cloudは既存新規editor入口が生成したIDを使う。元メタデータは渡さない。
 */
export function createDuplicateEditor(sessionId: string, source: { memo: Memo; tagIds: string[] },
  destination: { id: string; source: 'local' | 'cloud' } = { id: DUPLICATE_DRAFT_ID, source: 'local' }) {
  // 既存編集の検証を再利用するが、元メモのrevision・ピン・保存状態は引き継がない。
  const checked = createEditor(source.memo.id, sessionId, source);
  return editDraft(createEditor(destination.id, sessionId, undefined, destination.source), checked.draft);
}

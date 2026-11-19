import { createEditor, editDraft } from './editor-state';
import type { Memo } from './types';
import type { Draft, EditorState } from './editor-state';
import { normalizeMemoInput } from './input';

/** 永続IDではない編集用仮ID。controllerが最初の明示保存時に置き換える。 */
export const DUPLICATE_DRAFT_ID = '00000000-0000-0000-0000-000000000000';

/** 保存済み通常メモだけをコピーし、空の基準値との差として未保存確認を有効にする。
 * localは従来の仮ID、cloudは既存新規editor入口が生成したIDを使う。元メタデータは渡さない。
 */
export function createDuplicateEditor(sessionId: string, source: { memo: Memo; tagIds: string[] } | EditorState,
  destination: { id: string; source: 'local' | 'cloud' } = { id: DUPLICATE_DRAFT_ID, source: 'local' }) {
  // 既存編集の検証を再利用するが、元メモのrevision・ピン・保存状態は引き継がない。
  let value: Draft;
  if ('memo' in source) value = createEditor(source.memo.id, sessionId, source).draft;
  else {
    // cloud編集では保存確認済みbaselineを正本にする。未保存draftや旧メタデータをコピーしない。
    if (source.expectedRevision === null) throw new Error('Unsaved duplicate source');
    value = { ...normalizeMemoInput(source.baseline.title, source.baseline.body), tagIds: source.baseline.tagIds };
  }
  return editDraft(createEditor(destination.id, sessionId, undefined, destination.source), value);
}

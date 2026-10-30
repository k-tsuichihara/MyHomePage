import type { Draft, EditorState } from './editor-state';
import type { LocalFailureReason } from './local-data-store';
import type { ListContext } from './navigation-state';
import type { MemoData, Memo } from './types';
import type { countTagUsage } from './tag-usage';
import type { DeleteTarget } from './local-delete-operations';

export type Mutation = { kind: 'state'; id: string; action: 'pin' | 'unpin' | 'trash' | 'restore'; expectedRevision: number }
  | { kind: 'save-tag'; id: string; name: string; expectedRevision: number | null }
  | { kind: 'delete-tag'; id: string; expectedRevision: number }
  | { kind: 'permanent-delete'; id: string; expectedRevision: number }
  | { kind: 'empty-trash'; targets: DeleteTarget[] };
export type Destination = { kind: 'list' } | { kind: 'detail'; id: string } | { kind: 'edit'; id: string } | { kind: 'new' }
  | { kind: 'duplicate'; id: string };
export type ControllerCommand = Destination | { kind: 'load' } | { kind: 'query'; options: unknown; scrollTop: number }
  | { kind: 'draft'; value: Draft } | { kind: 'save' } | { kind: 'mutate'; operation: Mutation }
  | { kind: 'confirm'; token: number; accepted: boolean } | { kind: 'adjacent'; direction: 'previous' | 'next' };
export type WriteCommand = Extract<ControllerCommand, { kind: 'save' | 'mutate' }>;
export interface ControllerAttempt { readonly operationId: string; readonly requestId: string; readonly command: WriteCommand; readonly input: unknown }
export type ControllerWrite = { kind: 'idle' } | { kind: 'writing'; attempt: ControllerAttempt }
  | { kind: 'succeeded'; attempt: ControllerAttempt; deletedCount?: number }
  | { kind: 'rejected'; attempt: ControllerAttempt; reason: LocalFailureReason }
  | { kind: 'unknown'; attempt: ControllerAttempt };
export interface ControllerConfirmation {
  readonly token: number; readonly generation: number;
  readonly reason: 'operation' | 'unsaved' | 'rejected' | 'unknown';
  readonly command: Destination | WriteCommand;
}
export interface LocalAppState {
  readonly generation: number;
  readonly route: { kind: 'list' } | { kind: 'detail' | 'edit'; id: string };
  readonly data: MemoData | null;
  readonly storageVersion: 2 | 3 | null;
  readonly list: ListContext | null;
  readonly detailList: ListContext | null;
  readonly usage: Readonly<ReturnType<typeof countTagUsage>>;
  readonly read: { kind: 'idle' | 'loading' | 'ready' } | { kind: 'failed'; reason: string };
  readonly write: ControllerWrite;
  readonly editor: EditorState | null;
  readonly editorAnchor: { memo: Memo; tagIds: string[] } | null;
  readonly editorIssue: 'changed' | 'missing' | 'trashed' | 'missing-tag' | 'id-exists' | null;
  readonly confirmation: ControllerConfirmation | null;
  readonly unresolved: readonly ControllerAttempt[];
  readonly retainedEditors: readonly EditorState[];
}
export type CommandResult = { kind: 'done' | 'ignored' | 'cancelled' }
  | { kind: 'confirmation-required'; token: number }
  | { kind: 'blocked'; reason: string };

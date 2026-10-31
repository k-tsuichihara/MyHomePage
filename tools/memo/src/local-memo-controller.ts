import { beginSave, confirmResave, createEditor, editDraft, immutable, isDirty, settleSave } from './editor-state';
import { listNeighbors, prepareLocalList, requestNavigation } from './navigation-state';
import { queryMemos } from './memo-query';
import { countTagUsage } from './tag-usage';
import { validateLocalFormat } from './local-format';
import { parseStateRequest } from './local-state-operations';
import { parseTagDelete, parseTagSave } from './local-tag-operations';
import { uuid, uuidKey } from './read-primitives';
import type { createLocalMemoStore } from './local-memo-store';
import type { LocalLoadResult } from './local-data-store';
import type { CommandResult, ControllerCommand, ControllerAttempt, Destination, LocalAppState, Mutation, WriteCommand } from './local-app-state';
import type { MemoData } from './types';
import { createDuplicateEditor } from './memo-duplicate';
import { parseDeleteTargets, parsePermanentDelete, sameTargets } from './local-delete-operations';

export interface LocalControllerDependencies {
  store: Pick<ReturnType<typeof createLocalMemoStore>, 'load' | 'save' | 'changeState' | 'saveTag' | 'deleteTag' | 'deletePermanently' | 'emptyTrash'>;
  createId: () => string;
}
const done: CommandResult = { kind: 'done' };
const blocked = (reason: string): CommandResult => ({ kind: 'blocked', reason });
const key = uuidKey;
const tagSet = (ids: readonly string[]) => ids.map(key).sort().join('/');

/**
 * 一つの注入済みストアをアプリ寿命中使う。保存先・DOM・認証を自分で取得しない。
 * 状態更新は最初のawaitより前に確定させ、二重書込と古い読込応答を制御する。
 */
export function createLocalMemoController(deps: LocalControllerDependencies) {
  const store = deps.store;
  let app: LocalAppState = immutable({ generation: 0, route: { kind: 'list' }, data: null, storageVersion: null, list: null,
    detailList: null, usage: [], read: { kind: 'idle' }, write: { kind: 'idle' }, editor: null,
    editorAnchor: null, editorIssue: null, confirmation: null, unresolved: [], retainedEditors: [] });
  let readEpoch = 0, serial = 0;
  // 仮IDを保存先のIDと照合しない。最初の明示保存後は通常の新規編集と同じ契約に戻す。
  let duplicateSession: string | null = null;
  const patch = (value: Partial<LocalAppState>) => { app = immutable({ ...app, ...value, generation: app.generation + 1 }); };
  const busy = () => app.write.kind === 'writing';
  const ready = () => app.read.kind === 'ready' && app.data !== null;
  const findMemo = (id: string) => app.data?.memos.find(row => key(row.id) === key(id));
  const findTag = (id: string) => app.data?.tags.find(row => key(row.id) === key(id));
  const related = (data: MemoData, id: string) => data.memoTags.filter(row => key(row.memoId) === key(id)).map(row => row.tagId);

  /** 再取得で編集基準やドラフトを更新しない。現在値との差を利用者向けの状態として残す。 */
  function issue(data: MemoData, editor = app.editor): LocalAppState['editorIssue'] {
    if (!editor) return null;
    const missingTag = editor.draft.tagIds.some(id => !data.tags.some(tag => key(tag.id) === key(id)));
    if (editor.sessionId === duplicateSession) return missingTag ? 'missing-tag' : null;
    const memo = data.memos.find(row => key(row.id) === key(editor.id));
    if (editor.expectedRevision === null) return memo ? 'id-exists' : missingTag ? 'missing-tag' : null;
    if (!memo) return 'missing';
    if (memo.deletedAt !== null) return 'trashed';
    if (missingTag) return 'missing-tag';
    const anchor = app.editorAnchor;
    if (!anchor || JSON.stringify(memo) !== JSON.stringify(anchor.memo)
      || tagSet(related(data, memo.id)) !== tagSet(anchor.tagIds)) return 'changed';
    return null;
  }

  async function load(): Promise<CommandResult> {
    const epoch = ++readEpoch;
    patch({ read: { kind: 'loading' } });
    let result: LocalLoadResult;
    try { result = await store.load(); }
    catch { result = { kind: 'unavailable', reason: 'storage-failure' }; }
    if (epoch !== readEpoch) return { kind: 'ignored' };
    const prepared = prepareLocalList(result, app.list?.result.query, app.list?.scrollTop ?? 0);
    if (prepared.kind === 'blocked') {
      patch({ read: { kind: 'failed', reason: result.kind === 'unavailable' ? result.reason : prepared.reason } });
      return blocked('load-failed');
    }
    const value = result.kind === 'loaded' ? validateLocalFormat(result.value).value : null;
    const data: MemoData = value ? { memos: value.memos, tags: value.tags, memoTags: value.memoTags } : { memos: [], tags: [], memoTags: [] };
    patch({ data, storageVersion: value?.version ?? null, list: prepared.context, usage: countTagUsage(data), read: { kind: 'ready' }, editorIssue: issue(data) });
    return done;
  }

  function confirmation(command: Destination | WriteCommand, reason: 'operation' | 'unsaved' | 'rejected' | 'unknown'): CommandResult {
    const token = ++serial;
    // コマンドは各入口で独立した値へ再構築済み。世代更新も確認表示の一部とする。
    patch({ confirmation: { token, generation: app.generation + 1, command, reason } });
    return { kind: 'confirmation-required', token };
  }

  function navigate(destination: Destination, accepted: boolean): CommandResult {
    if (!ready()) return blocked('not-ready');
    if (!accepted) {
      if (app.unresolved.length || app.write.kind === 'unknown') return confirmation(destination, 'unknown');
      if (app.write.kind === 'rejected') return confirmation(destination, 'rejected');
      if (app.editor) {
        const decision = requestNavigation(app.editor, destination.kind === 'list' || destination.kind === 'new'
          ? { kind: 'list' } : { kind: 'detail', id: destination.id });
        if (decision.kind === 'confirmation-required') return confirmation(destination, decision.reason);
        if (decision.kind === 'blocked') return blocked(decision.reason);
      }
    }
    const id = destination.kind === 'new' ? uuid(deps.createId()) : destination.kind === 'list' ? null : uuid(destination.id);
    const memo = id ? findMemo(id) : undefined;
    if (destination.kind !== 'new' && destination.kind !== 'list' && !memo) return blocked('not-found');
    if (destination.kind === 'edit' && memo!.deletedAt !== null) return blocked('trashed');
    if (destination.kind === 'duplicate' && memo!.deletedAt !== null) return blocked('trashed');
    if (destination.kind === 'new' && memo) return blocked('id-exists');
    const retained = app.editor && (isDirty(app.editor) || app.editor.unresolved.length || app.editor.save.kind === 'rejected')
      ? [...app.retainedEditors, app.editor] : app.retainedEditors;
    const editing = destination.kind === 'edit' || destination.kind === 'new' || destination.kind === 'duplicate';
    const initial = memo ? { memo, tagIds: related(app.data!, memo.id) } : undefined;
    const sessionId = `session-${++serial}`;
    const editor = destination.kind === 'duplicate' ? createDuplicateEditor(sessionId, initial!)
      : editing ? createEditor(id!, sessionId, initial) : null;
    duplicateSession = destination.kind === 'duplicate' ? sessionId : null;
    patch({ route: id ? { kind: editing ? 'edit' : 'detail', id: editor?.id ?? id } : { kind: 'list' },
      detailList: destination.kind === 'list' ? null : app.route.kind === 'list' ? app.list : app.detailList,
      editor,
      editorAnchor: editing && destination.kind !== 'duplicate' && initial ? initial : null, editorIssue: null, confirmation: null, retainedEditors: retained });
    return done;
  }

  /** 対象revisionを確認表示時に固定する。外部の生入力をそのまま後で実行しない。 */
  function mutation(input: Mutation): Mutation {
    const request = { ...input, requestId: '00000000-0000-0000-0000-000000000000' };
    // 既存パーサは操作のkindを入力項目に含めないため、対象フィールドだけを渡す。
    if (input.kind === 'state') {
      const checked = parseStateRequest({ id: input.id, action: input.action, expectedRevision: input.expectedRevision, requestId: request.requestId });
      return { kind: 'state', ...checked };
    }
    if (input.kind === 'save-tag') {
      const checked = parseTagSave({ id: input.id, name: input.name, expectedRevision: input.expectedRevision, requestId: request.requestId });
      return { kind: 'save-tag', ...checked };
    }
    if (input.kind === 'permanent-delete') {
      const checked = parsePermanentDelete({ id: input.id, expectedRevision: input.expectedRevision, requestId: request.requestId });
      return { kind: 'permanent-delete', id: checked.targets[0]!.id, expectedRevision: checked.targets[0]!.revision };
    }
    if (input.kind === 'empty-trash') return { kind: 'empty-trash', targets: parseDeleteTargets(input.targets) };
    if (input.kind !== 'delete-tag') throw new Error('Invalid operation');
    return { kind: 'delete-tag', ...parseTagDelete({ id: input.id, expectedRevision: input.expectedRevision, requestId: request.requestId }) };
  }
  function matches(operation: Mutation): boolean {
    if (operation.kind === 'empty-trash') return sameTargets(operation.targets, app.data!.memos.filter(row => row.deletedAt !== null));
    if (operation.kind === 'permanent-delete') {
      const row = findMemo(operation.id); return row?.deletedAt != null && row.revision === operation.expectedRevision;
    }
    const row = operation.kind === 'state' ? findMemo(operation.id) : findTag(operation.id);
    return operation.expectedRevision === null ? row === undefined : row?.revision === operation.expectedRevision;
  }

  async function write(command: WriteCommand, accepted: boolean): Promise<CommandResult> {
    if (!ready()) return blocked('not-ready');
    if (command.kind === 'mutate' && app.route.kind === 'edit') return blocked('editor-active');
    if (!accepted && (app.unresolved.length || app.editor?.unresolved.length)) return confirmation(command, 'unknown');
    if (command.kind === 'mutate') {
      const op = command.operation;
      if ((op.kind === 'permanent-delete' || op.kind === 'empty-trash') && app.storageVersion !== 3) return blocked('v3-required');
      if (!matches(op)) return blocked('target-changed');
      if (!accepted && (op.kind === 'permanent-delete' || op.kind === 'empty-trash' || op.kind === 'delete-tag' || (op.kind === 'state' && (op.action === 'trash' || op.action === 'restore')))) {
        return confirmation(command, 'operation');
      }
    } else if (!app.editor || app.editorIssue) return blocked(app.editorIssue ?? 'no-editor');

    const operationId = `operation-${++serial}`, requestId = uuid(deps.createId());
    let input: unknown, saving: ReturnType<typeof beginSave> | null = null;
    if (command.kind === 'save') {
      const editor = app.editor!.sessionId === duplicateSession
        ? immutable({ ...app.editor!, id: uuid(deps.createId()) }) : app.editor!;
      saving = beginSave(editor, { operationId, requestId }, accepted ? confirmResave(editor) : undefined);
      if (saving.kind !== 'submit') return blocked(saving.reason);
      duplicateSession = null;
      input = saving.attempt.request;
    } else {
      const { kind: _kind, ...fields } = command.operation;
      input = { ...fields, requestId };
    }
    const attempt: ControllerAttempt = immutable({ operationId, requestId, command, input });
    // 書込前に開始したloadは、書込完了後に戻っても反映させない。
    ++readEpoch;
    // 初回複製の採番はeditorだけでなくrouteにも同時に反映する。
    // 応答前の追加入力・失敗後の再読込も、送信済み要求と同じIDを参照する。
    patch({ write: { kind: 'writing', attempt }, confirmation: null,
      editor: saving?.kind === 'submit' ? saving.state : app.editor,
      route: saving?.kind === 'submit' && app.route.kind === 'edit'
        ? { kind: 'edit', id: saving.state.id } : app.route, read: { kind: 'ready' } });
    let result: Awaited<ReturnType<typeof store.save>> | Awaited<ReturnType<typeof store.changeState>> | Awaited<ReturnType<typeof store.emptyTrash>>;
    try {
      if (command.kind === 'save') result = await store.save(input);
      else if (command.operation.kind === 'state') result = await store.changeState(input);
      else if (command.operation.kind === 'save-tag') result = await store.saveTag(input);
      else if (command.operation.kind === 'permanent-delete') result = await store.deletePermanently(input);
      else if (command.operation.kind === 'empty-trash') result = await store.emptyTrash(input);
      else result = await store.deleteTag(input);
    } catch { result = { kind: 'unknown', reason: 'storage-failure', writeOutcome: 'unverified' }; }

    // 型付きポートでも、欠落した応答を未実行と断定してロック状態を放置しない。
    if (!result || typeof result !== 'object') result = { kind: 'unknown', reason: 'storage-failure', writeOutcome: 'unverified' };

    if (app.write.kind !== 'writing' || app.write.attempt !== attempt) return { kind: 'ignored' };
    let success = result.kind === 'saved' || result.kind === 'written' || result.kind === 'deleted' || result.kind === 'not-needed';
    if (saving?.kind === 'submit' && app.editor) {
      let editor = settleSave(app.editor, saving.attempt.context, result);
      success = editor.save.kind === 'saved';
      // PR #10の保存試行の成功と、最新ドラフトの画面状態を分ける。
      if (success && isDirty(editor)) editor = immutable({ ...editor, screen: 'edit' });
      const anchor = success && result.kind === 'saved' ? structuredClone(result.value) : app.editorAnchor;
      patch({ editor, editorAnchor: anchor, route: { kind: success && !isDirty(editor) ? 'detail' : 'edit', id: editor.id } });
    }
    if (success) {
      const deletedCount = result.kind === 'deleted' || result.kind === 'not-needed' ? result.count : undefined;
      const deletion = deletedCount !== undefined;
      patch({ write: deletedCount !== undefined ? { kind: 'succeeded', attempt, deletedCount } : { kind: 'succeeded', attempt } });
      if (deletion && command.kind === 'mutate' && app.route.kind === 'detail') {
        const id = app.route.id, op = command.operation;
        if ((op.kind === 'permanent-delete' && key(op.id) === key(id)) || (op.kind === 'empty-trash' && op.targets.some(row => key(row.id) === key(id)))) {
          patch({ route: { kind: 'list' }, editor: null, editorAnchor: null, editorIssue: null, detailList: null });
        }
      }
      await load(); // 後続loadの失敗でも、この確定成功は変更しない。
    } else if (result.kind === 'rejected') {
      patch({ write: { kind: 'rejected', attempt, reason: result.reason } });
    } else {
      patch({ write: { kind: 'unknown', attempt }, unresolved: [...app.unresolved, attempt], read: { kind: 'failed', reason: 'write-unknown' } });
    }
    return done;
  }

  async function execute(command: ControllerCommand, accepted = false): Promise<CommandResult> {
    if (command.kind === 'draft') {
      if (!app.editor) return blocked('no-editor');
      const editor = editDraft(app.editor, command.value);
      patch({ editor, route: { kind: 'edit', id: editor.id }, editorIssue: app.data ? issue(app.data, editor) : app.editorIssue }); return done;
    }
    if (busy()) return blocked('writing');
    if (command.kind === 'load') return load();
    if (command.kind === 'confirm') {
      const ticket = app.confirmation;
      if (!ticket || ticket.token !== command.token || ticket.generation !== app.generation) return blocked('stale-confirmation');
      patch({ confirmation: null });
      return command.accepted ? execute(ticket.command, true) : { kind: 'cancelled' };
    }
    if (command.kind === 'save' || command.kind === 'mutate') return write(command, accepted);
    if (command.kind === 'query') {
      if (!ready() || !Number.isFinite(command.scrollTop) || command.scrollTop < 0) return blocked('not-ready');
      patch({ list: { result: queryMemos(app.data, command.options), scrollTop: command.scrollTop } }); return done;
    }
    if (command.kind === 'adjacent') {
      if (!app.detailList || app.route.kind === 'list') return blocked('no-detail');
      const neighbors = listNeighbors(app.detailList, app.route.id);
      const id = neighbors.kind === 'found' ? (command.direction === 'previous' ? neighbors.previousId : neighbors.nextId) : null;
      return id ? navigate({ kind: 'detail', id }, false) : blocked('not-in-result');
    }
    return navigate(command, accepted);
  }
  return {
    getState: (): LocalAppState => app,
    /** 型付きアプリコマンド用の入口。外部のJSON等をキャストして渡さない。元例外は公開しない。 */
    async dispatch(command: ControllerCommand): Promise<CommandResult> {
      try {
        const copy = structuredClone(command);
        const owned = copy.kind === 'mutate' ? { kind: 'mutate' as const, operation: mutation(copy.operation) } : copy;
        return await execute(owned);
      } catch { return blocked('invalid-input'); }
    },
  };
}

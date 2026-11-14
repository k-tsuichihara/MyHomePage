import { beginSave, createEditor, editDraft, isDirty, settleCloudSave, settleCloudResolution, markCloudSaveUnknown, recoverCloudSave } from './editor-state';
import type { EditorState, SaveAttempt, BeginSaveResult } from './editor-state';
import { requestNavigation, confirmNavigation } from './navigation-state';
import type { LeaveConfirmation } from './navigation-state';
import type { createCloudController, PendingCloudSave, CloudSaveControlResult, CloudResolveControlResult } from './cloud-controller';
import type { createMemoAuthSession, AuthContext } from './auth-session';
import type { Memo, Tag } from './types';
import { uuidKey } from './read-primitives';

/** 単件cloud編集の製品接続。保存/照合の判定はC04、編集/離脱は既存純粋関数へ委譲する。 */
export function mountProductCloudEditor(doc: Document, parent: HTMLElement, deps: {
  writer: Pick<ReturnType<typeof createCloudController>, 'save' | 'resolve'>;
  auth: Pick<ReturnType<typeof createMemoAuthSession>, 'getContext' | 'isCurrent'>;
  selected(): boolean; viewKey(): object; createId(): string; changed(): void;
}) {
  const root = doc.createElement('section'); root.setAttribute('aria-label', 'クラウド単件編集'); root.id = 'product-cloud-editor'; root.hidden = true;
  const title = doc.createElement('input'); title.setAttribute('aria-label', 'クラウドのタイトル');
  const body = doc.createElement('textarea'); body.setAttribute('aria-label', 'クラウドの本文');
  const status = doc.createElement('p'); status.setAttribute('role', 'status');
  const tagField = doc.createElement('fieldset'), tagNotice = doc.createElement('p');
  const button = (label: string, action: () => void) => {
    const node = doc.createElement('button'); node.type = 'button'; node.textContent = label; node.onclick = action; return node;
  };
  let editor: EditorState | null = null, owner: string | null = null, working = false, disposed = false;
  // C04の生存handle、または元要求の検証済み終端結果を保持する。画面の鮮度とは分ける。
  type Completion = Extract<CloudSaveControlResult, { kind: 'completed' }> | Extract<CloudResolveControlResult, { kind: 'diagnosed' }>;
  let pending: { handle?: PendingCloudSave; attempt: SaveAttempt; completion?: Completion } | null = null;
  let closeTicket: LeaveConfirmation | null = null, notice = '';
  let candidates: readonly Tag[] | null = null, candidateContext: AuthContext | null = null, candidateView: object | null = null;
  let tagInputs: { tag: Tag; node: HTMLInputElement; name: HTMLElement }[] = [];
  const auth = () => {
    try {
      const value = deps.auth.getContext();
      return value && deps.selected() && deps.auth.isCurrent(value) && uuidKey(value.userId) === owner ? value : null;
    } catch { return null; }
  };
  // editor自身のdirty更新とsnapshot切替を混同せず、既存の選択ticket/contextに候補を結び付ける。
  const candidatesCurrent = () => !!editor && !!auth() && !!candidateContext
    && deps.auth.isCurrent(candidateContext) && deps.viewKey() === candidateView;
  const save = button('クラウドへ保存', () => { void submit(); });
  const resolve = button('クラウドの保存結果を照合', () => { void diagnose(); });
  const close = button('クラウド編集を閉じる', () => {
    if (!editor || working) return;
    if (pending) { notice = '保存結果の照合が必要です。自動再送や編集の破棄は行いません。'; render(); return; }
    const decision = requestNavigation(editor, { kind: 'list' });
    if (decision.kind === 'confirmation-required') closeTicket = decision.ticket;
    else if (decision.kind === 'allowed') editor = null;
    changed();
  });
  const confirmation = doc.createElement('div'); confirmation.setAttribute('role', 'group'); confirmation.setAttribute('aria-label', 'クラウド編集を閉じる確認');
  confirmation.append(button('変更を破棄して編集を閉じる', () => {
    if (editor && closeTicket && !working && confirmNavigation(editor, closeTicket, true).kind === 'allowed') editor = null;
    closeTicket = null; changed();
  }), button('クラウド編集を続ける', () => { closeTicket = null; render(); }));
  root.append(title, body, tagField, tagNotice, save, resolve, close, confirmation, status); parent.append(root);
  function render() {
    if (disposed) return;
    root.hidden = !editor || !deps.selected();
    const available = editor && auth();
    title.value = available ? editor!.draft.title : ''; body.value = available ? editor!.draft.body : '';
    title.disabled = body.disabled = !available;
    const tagsCurrent = candidates !== null && candidatesCurrent();
    tagField.hidden = !tagsCurrent;
    tagInputs.forEach(({ tag, node, name }) => {
      name.textContent = tagsCurrent ? tag.name : '';
      node.checked = !!tagsCurrent && !!editor?.draft.tagIds.some(id => uuidKey(id) === uuidKey(tag.id));
      node.disabled = !tagsCurrent || !!closeTicket;
    });
    tagNotice.textContent = !available ? '' : candidates === null ? 'タグ候補は未取得です。現在のタグ割当は変更しません。'
      : !tagsCurrent ? 'タグ候補が古くなりました。タグ選択の変更には明示再読取後の編集が必要です。既存の割当は自動変更しません。'
      : candidates.length ? '' : 'このsnapshotにはタグがありません。';
    save.disabled = !available || working || !!editor?.unresolved.length || !!closeTicket;
    resolve.disabled = !available || working || !pending || !!closeTicket;
    close.disabled = working;
    confirmation.hidden = !closeTicket;
    status.textContent = !available ? '停止：同じユーザーで再認証してください。クラウドの編集はタブ内で保持しています。'
      : working ? 'クラウド処理中です。離脱・二重送信はできません。'
      : notice || (editor!.save.kind === 'unknown' ? '保存できたか不明です。明示照合が必要です。自動再送しません。'
        : editor!.save.kind === 'rejected' ? editor!.save.reason === 'conflict' ? '競合：保存は拒否されました。編集内容は保持しています。'
          : '保存は拒否・停止されました。編集内容は保持しています。'
        : editor!.save.kind === 'saved' ? `保存要求の成功を確認しました。現在内容は明示再読取で確認してください。${isDirty(editor!) ? '追加の未保存変更があります。' : ''}`
          : editor!.expectedRevision === null ? 'クラウドの新規メモを編集中です。'
            : 'クラウドの既存メモを編集しています。');
  }
  function changed() { render(); deps.changed(); }
  const onInput = () => {
    if (!editor || !auth()) return;
    editor = editDraft(editor, { ...editor.draft, title: title.value, body: body.value }); notice = ''; changed();
  };
  title.oninput = body.oninput = onInput;
  async function submit() {
    if (!editor || working || pending || closeTicket) return;
    const context = auth(); if (!context) { render(); return; }
    let begun: BeginSaveResult;
    try { begun = beginSave(editor, { operationId: deps.createId(), requestId: deps.createId() }); }
    catch { notice = '保存要求を作れません。保存は開始していません。'; render(); return; }
    if (begun.kind !== 'submit') { notice = '保存を開始できません。入力と編集状態を確認してください。'; render(); return; }
    editor = begun.state; const attempt = begun.attempt, view = deps.viewKey();
    working = true; notice = ''; changed();
    try {
      const request = attempt.request;
      const result = await deps.writer.save(context, { memoId: request.id, title: request.title, body: request.body,
        tagIds: request.tagIds, expectedRevision: request.expectedRevision, requestId: request.requestId });
      if (disposed || !editor) return;
      if ('pending' in result) pending = { handle: result.pending, attempt };
      const applicable = deps.selected() && deps.viewKey() === view && deps.auth.isCurrent(context);
      if (!applicable && result.kind === 'completed' && result.result.kind !== 'failed' && result.result.kind !== 'unknown') {
        pending = { attempt, completion: result };
        notice = '元要求の確認済み結果を保持しています。保存結果の照合操作で回収できます。追加通信はありません。';
      }
      editor = settleCloudSave(editor, attempt.context, result, applicable);
      if (applicable && result.kind === 'completed' && result.result.kind === 'ok' && result.result.value.kind === 'previously-applied-deleted') {
        notice = '保存要求は適用済みですが、メモは削除済みです。復元や自動再送は行いません。';
      }
    } catch { if (!disposed && editor) editor = markCloudSaveUnknown(editor, attempt.context); }
    finally { working = false; if (!disposed) changed(); }
  }
  async function diagnose() {
    if (!editor || working || !pending || closeTicket) return;
    const context = auth(); if (!context) { render(); return; }
    const original = pending, view = deps.viewKey(); working = true; notice = ''; changed();
    try {
      if (original.completion) {
        editor = original.completion.kind === 'completed' ? recoverCloudSave(editor, original.attempt, original.completion)
          : settleCloudResolution(editor, original.attempt, original.completion);
        if (!editor.unresolved.includes(original.attempt)) pending = null;
        if (original.completion.result.kind === 'ok' && original.completion.result.value.kind === 'previously-applied-deleted') {
          notice = '保存要求は適用済みですが、メモは削除済みです。復元や自動再送は行いません。';
        }
        return;
      }
      if (!original.handle) return;
      const result = await deps.writer.resolve(context, original.handle);
      if (!disposed && result.kind === 'diagnosed' && !result.pendingActive) {
        // C04がhandleを閉じた結果は、現在画面へ反映できない場合も捨てない。
        pending = { attempt: original.attempt, completion: result };
        notice = '元要求の確認済み結果を保持しています。保存結果の照合操作で回収できます。追加通信はありません。';
      }
      if (disposed || !editor || !deps.selected() || deps.viewKey() !== view || !deps.auth.isCurrent(context)) return;
      notice = '';
      editor = settleCloudResolution(editor, original.attempt, result);
      if (result.kind === 'diagnosed' && !result.pendingActive) pending = null;
      if (result.kind === 'diagnosed' && result.result.kind === 'ok' && result.result.value.kind === 'no-record') {
        notice = '照合に該当記録がありません。未実行の証明ではありません。結果不明を保持し、自動再送しません。';
      }
      if (result.kind === 'diagnosed' && result.result.kind === 'ok' && result.result.value.kind === 'previously-applied-deleted') {
        notice = '保存要求は適用済みですが、メモは削除済みです。復元や自動再送は行いません。';
      }
    } catch { if (!disposed) notice = '照合結果は不明です。編集内容を保持し、自動再送しません。'; }
    finally { working = false; if (!disposed) changed(); }
  }
  function open(initial?: { memo: Memo; tagIds: string[] }, valid: () => boolean = () => true, tags: readonly Tag[] | null = null) {
    if (disposed || editor || working || !valid() || !deps.selected()) return false;
    try {
      const context = deps.auth.getContext(); if (!context || !deps.auth.isCurrent(context)) return false;
      editor = createEditor(initial?.memo.id ?? deps.createId(), deps.createId(), initial, 'cloud');
      candidates = tags === null ? null : Object.freeze([...tags]); candidateContext = context; candidateView = deps.viewKey();
      tagInputs = []; tagField.replaceChildren();
      const legend = doc.createElement('legend'); legend.textContent = 'クラウドのタグ'; tagField.append(legend);
      const sessionId = editor.sessionId;
      candidates?.forEach(tag => {
        const label = doc.createElement('label'), node = doc.createElement('input'), name = doc.createElement('span');
        node.type = 'checkbox'; // 内部IDをvalue/属性へ入れず、この編集だけのclosureで保持する。
        node.onchange = () => {
          if (!editor || editor.sessionId !== sessionId || !root.contains(node) || !candidatesCurrent() || closeTicket) { render(); return; }
          const ids = editor.draft.tagIds.filter(id => uuidKey(id) !== uuidKey(tag.id));
          if (node.checked) ids.push(tag.id);
          editor = editDraft(editor, { ...editor.draft, tagIds: ids }); notice = ''; changed();
        };
        label.append(node, name); tagField.append(label); tagInputs.push({ tag, node, name });
      });
      owner = uuidKey(context.userId); notice = ''; changed(); return true;
    } catch { return false; }
  }
  return Object.freeze({
    start: (memo: Memo, tagIds: string[], valid: () => boolean, tags: readonly Tag[] = []) => open({ memo, tagIds }, valid, tags),
    startNew: (choices: { tags: readonly Tag[]; valid: () => boolean } | null = null) => open(undefined, choices?.valid, choices?.tags ?? null),
    getState: () => editor,
    isBusy: () => working,
    refresh: render,
    dispose() { disposed = true; editor = null; pending = null; owner = null; closeTicket = null; notice = '';
      tagInputs.forEach(({ node }) => { node.onchange = null; }); tagInputs = []; candidates = null; candidateContext = null; candidateView = null;
      tagField.replaceChildren(); tagNotice.textContent = '';
      title.oninput = body.oninput = null; title.value = body.value = ''; root.remove(); },
  });
}

import { beginSave, createEditor, editDraft, isDirty, settleCloudSave, settleCloudResolution, markCloudSaveUnknown, recoverCloudSave } from './editor-state';
import type { EditorState, SaveAttempt, BeginSaveResult } from './editor-state';
import { requestNavigation, confirmNavigation, editorNeighbors } from './navigation-state';
import type { LeaveConfirmation, ListContext, NavigationTarget } from './navigation-state';
import type { createCloudController, PendingCloudSave, CloudSaveControlResult, CloudResolveControlResult } from './cloud-controller';
import type { createMemoAuthSession, AuthContext } from './auth-session';
import type { Memo, Tag } from './types';
import { uuidKey } from './read-primitives';
import { createDuplicateEditor } from './memo-duplicate';
import { createVoiceControls, decoratePcVoiceButton } from './ui/voice-input';
import { setPcButtonLabel } from './ui/product-dialog';
import { normalizeMemoInput } from './input';

/** 単件cloud編集の製品接続。保存/照合の判定はC04、編集/離脱は既存純粋関数へ委譲する。 */
export function mountProductCloudEditor(doc: Document, parent: HTMLElement, deps: {
  writer: Pick<ReturnType<typeof createCloudController>, 'save' | 'resolve'>;
  loader?: ReturnType<typeof createCloudController>['load'];
  returnToList?: (context: ListContext | null, commit: () => boolean) => Promise<boolean>;
  auth: Pick<ReturnType<typeof createMemoAuthSession>, 'getContext' | 'isCurrent'>;
  selected(): boolean; viewKey(): object; createId(): string; changed(): void; now?: (() => Date) | undefined;
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
  let navigation: ListContext | null = null;
  let candidates: readonly Tag[] | null = null, candidateContext: AuthContext | null = null, candidateView: object | null = null;
  let tagInputs: { tag: Tag; node: HTMLInputElement; name: HTMLElement }[] = [];
  const auth = () => {
    try {
      const value = deps.auth.getContext();
      return value && deps.selected() && deps.auth.isCurrent(value) && uuidKey(value.userId) === owner ? value : null;
    } catch { return null; }
  };
  let voiceContext: AuthContext | null = null, voiceView: object | null = null;
  let voiceChoices: { tags: readonly Tag[]; valid: () => boolean; context?: ListContext } | null = null;
  const voiceCurrent = () => {
    try { return !!voiceContext && deps.auth.isCurrent(voiceContext) && deps.selected() && deps.viewKey() === voiceView; }
    catch { return false; }
  };
  const voice = createVoiceControls(doc, {
    getState: () => ({ read: { kind: voiceCurrent() ? 'ready' : 'idle' }, write: { kind: working ? 'writing' : 'idle' },
      confirmation: closeTicket, route: editor ? { kind: 'edit', id: editor.id } : { kind: 'list' }, editor }),
    async dispatch(command) {
      if (!voiceCurrent()) return { kind: 'blocked' };
      if (command.kind === 'new') return { kind: open(undefined, voiceChoices?.valid, voiceChoices?.tags ?? null, false, voiceChoices?.context) ? 'done' : 'blocked' };
      if (command.kind !== 'draft' || !editor || !auth() || working || closeTicket) return { kind: 'blocked' };
      editor = editDraft(editor, command.value); changed(); return { kind: 'done' };
    },
  }, { append: async (session, text, current) => {
    if (!current() || !voiceCurrent() || !editor || editor.sessionId !== session || !auth() || working || closeTicket) return false;
    const next = editor.draft.body + text;
    try { normalizeMemoInput(editor.draft.title, next); } catch { return false; }
    editor = editDraft(editor, { ...editor.draft, body: next }); notice = ''; changed(); return true;
  } }, deps.now);
  voice.section.setAttribute('aria-label', 'クラウド音声入力');
  const startVoice = async () => {
    if (disposed || working || closeTicket || !deps.selected() || (editor && !auth())) return;
    try {
      const context = deps.auth.getContext(); if (!context || !deps.auth.isCurrent(context)) return;
      voiceContext = context; voiceView = deps.viewKey(); await voice.start();
    } catch { /* Authの元例外を音声UIへ公開しない。 */ }
  };
  const voiceStart = button('クラウド本文へ音声追記', startVoice);
  // editor自身のdirty更新とsnapshot切替を混同せず、既存の選択ticket/contextに候補を結び付ける。
  const candidatesCurrent = () => !!editor && !!auth() && !!candidateContext
    && deps.auth.isCurrent(candidateContext) && deps.viewKey() === candidateView;
  const save = button('クラウドへ保存', () => { void submit(); });
  save.className = 'primary';
  const saved = doc.createElement('span'); saved.className = 'editor-saved'; saved.setAttribute('role', 'status');
  const resolve = button('クラウドの保存結果を照合', () => { void diagnose(); });
  const canDuplicate = () => !!editor && editor.expectedRevision !== null && candidatesCurrent() && !working && !pending && !closeTicket
    && !editor.unresolved.length && !(editor.save.kind === 'rejected' && editor.save.reason === 'not-found');
  async function leave(destination: NavigationTarget) {
    if (!editor || working) return;
    if (pending) { notice = '保存結果の照合が必要です。自動再送や編集の破棄は行いません。'; render(); return; }
    const decision = requestNavigation(editor, destination);
    if (decision.kind === 'confirmation-required') closeTicket = decision.ticket;
    else if (decision.kind === 'allowed') await finishLeave(destination);
    changed();
  }
  async function finishLeave(destination: NavigationTarget) {
    if (destination.kind === 'duplicate') {
      if (!editor || !canDuplicate() || uuidKey(destination.id) !== uuidKey(editor.id)) return;
      const before = editor, context = auth()!, view = deps.viewKey(), tags = candidates, list = navigation;
      editor = null;
      if (!open(before, () => deps.auth.isCurrent(context) && deps.selected() && deps.viewKey() === view, tags, true, list ?? undefined)) editor = before;
      return;
    }
    if (destination.kind === 'list') {
      const context = auth(); if (!editor || !context || !deps.returnToList) return;
      const before = editor, view = deps.viewKey(), list = navigation;
      working = true; changed();
      try {
        // 一覧取得が確定するまでeditor/一覧条件を保持する。確定時だけ既存hostから解放する。
        const returned = await deps.returnToList(list, () => {
          if (disposed || editor !== before || !deps.selected() || deps.viewKey() !== view || !deps.auth.isCurrent(context)) return false;
          editor = null; navigation = null; changed(); return true;
        });
        if (!returned && editor === before) notice = '一覧を確認できません。編集中の内容を保持しています。自動再試行しません。';
      } catch { if (!disposed && editor === before) notice = '一覧を確認できません。編集中の内容を保持し、自動再試行しません。'; }
      finally { working = false; if (!disposed) changed(); }
      return;
    }
    if (destination.kind !== 'edit' || !editor || !navigation || !deps.loader || !candidatesCurrent()) return;
    const context = auth(); if (!context) return;
    const before = editor, view = deps.viewKey(), list = navigation;
    working = true; changed();
    try {
      // 利用者の移動操作に対する明示読取。過去snapshotの本文/revisionを再利用しない。
      const result = await deps.loader(context);
      if (disposed || editor !== before || !deps.selected() || deps.viewKey() !== view || !deps.auth.isCurrent(context)) return;
      if (result.kind !== 'completed' || result.result.kind !== 'ok') {
        notice = '移動先を確認できません。編集中の内容は保持しています。自動再試行しません。'; return;
      }
      const value = result.result.value, memo = value.memos.find(row => uuidKey(row.id) === uuidKey(destination.id));
      if (!memo || memo.deletedAt !== null) { notice = '移動先の通常メモを確認できません。入力は保持しています。'; return; }
      const tagIds = value.memoTags.filter(row => uuidKey(row.memoId) === uuidKey(memo.id)).map(row => row.tagId);
      editor = null; working = false;
      if (!open({ memo, tagIds }, () => deps.auth.isCurrent(context) && deps.viewKey() === view, value.tags, false, list)) editor = before;
    } catch {
      if (!disposed && editor === before && deps.selected() && deps.viewKey() === view && deps.auth.isCurrent(context))
        notice = '移動先を確認できません。編集中の内容を保持し、自動再試行しません。';
    } finally { working = false; if (!disposed) changed(); }
  }
  const adjacent = (direction: 'previous' | 'next') => {
    if (!editor || working || closeTicket || !navigation || !auth() || !candidatesCurrent()) return;
    const neighbors = editorNeighbors(navigation, editor.id, editor.expectedRevision === null);
    const id = neighbors.kind === 'found' ? direction === 'previous' ? neighbors.previousId : neighbors.nextId : null;
    if (id) void leave({ kind: 'edit', id });
  };
  const previous = button('前のメモ', () => adjacent('previous')), next = button('次のメモ', () => adjacent('next'));
  const copy = button('複製', () => { if (canDuplicate() && editor) void leave({ kind: 'duplicate', id: editor.id }); });
  const close = button('クラウド編集を閉じる', () => { void leave({ kind: 'list' }); });
  const confirmation = doc.createElement('div'); confirmation.setAttribute('role', 'group'); confirmation.setAttribute('aria-label', 'クラウド編集を閉じる確認');
  const proceed = button('変更を破棄して編集を閉じる', () => {
    const ticket = closeTicket;
    if (editor && ticket && !working && confirmNavigation(editor, ticket, true).kind === 'allowed') {
      closeTicket = null; void finishLeave(ticket.target).then(changed); return;
    }
    closeTicket = null; changed();
  });
  confirmation.append(proceed, button('クラウド編集を続ける', () => { closeTicket = null; render(); }));
  root.append(previous, copy, next, title, body, tagField, tagNotice, voiceStart, save, resolve, close, confirmation, status); save.before(saved); parent.append(root, voice.section);
  if (doc.documentElement.dataset.productLayout === 'review2') {
    const nav = doc.createElement('nav'); nav.className = 'detail-actions'; nav.setAttribute('aria-label', 'クラウド編集の前後移動');
    setPcButtonLabel(doc, previous, '〈 前のメモ'); setPcButtonLabel(doc, next, '次のメモ 〉'); nav.append(previous, copy, next); root.prepend(nav);
    const titleLabel = doc.createElement('label'); titleLabel.textContent = 'タイトル（最大100文字）';
    title.before(titleLabel); titleLabel.append(title);
    titleLabel.className = 'pc-title-field';
    const bodyLabel = doc.createElement('label'); bodyLabel.textContent = '本文（最大10,000文字）';
    body.before(bodyLabel); bodyLabel.append(body);
    const heading = doc.createElement('h2'); heading.textContent = 'メモの作成・編集'; root.prepend(heading);
    const search = doc.createElement('input'); search.type = 'search'; search.setAttribute('aria-label', 'クラウドの選択タグを検索'); search.placeholder = 'タグを検索…';
    search.oninput = () => tagField.querySelectorAll('label').forEach(label => { label.hidden = !(label.textContent ?? '').toLocaleLowerCase().includes(search.value.toLocaleLowerCase()); });
    const note = doc.createElement('p'); note.className = 'editor-tag-hint'; note.textContent = '編集中は既存タグを選択できます。タグの作成・変更・削除は保存して一覧へ戻ってから行ってください。';
    bodyLabel.before(search, note, tagField, tagNotice);
    const bodyHeading = doc.createElement('div'); bodyHeading.className = 'section-heading';
    const bodyText = doc.createElement('span'); bodyText.textContent = '本文（最大10,000文字）';
    voiceStart.textContent = '音声入力';
    setPcButtonLabel(doc, voiceStart, '音声で本文へ追記'); decoratePcVoiceButton(doc, voiceStart);
    setPcButtonLabel(doc, close, '< 一覧へ');
    bodyLabel.firstChild?.remove(); bodyHeading.append(bodyText, voiceStart);
    const stop = voice.section.querySelector('button');
    const footer = doc.createElement('div'); footer.className = 'cloud-editor-footer editor-footer';
    if (stop) footer.append(stop);
    save.textContent = '保存する'; footer.append(saved, save); root.append(footer);
    bodyLabel.before(bodyHeading);
    bodyHeading.classList.add('pc-cloud-body-heading'); bodyLabel.classList.add('pc-cloud-body-field');
    root.append(voice.section);
    // 非対応時は新規editorが作られない。通知だけはcloud一覧からも見える位置に置く。
    parent.append(voice.status);
  }
  function render() {
    if (disposed) return;
    root.hidden = !editor || !deps.selected();
    voice.section.hidden = !deps.selected();
    voice.status.hidden = !deps.selected();
    const available = editor && auth();
    previous.disabled = next.disabled = !available || working || !!closeTicket;
    copy.hidden = editor?.expectedRevision == null; copy.disabled = !canDuplicate();
    proceed.textContent = closeTicket?.target.kind === 'duplicate' ? '変更を破棄して複製'
      : closeTicket?.target.kind === 'edit' ? '変更を破棄して移動' : '変更を破棄して編集を閉じる';
    const savedHere = !!available && !working && !notice && editor!.save.kind === 'saved' && !isDirty(editor!);
    saved.textContent = savedHere ? '保存しました' : ''; saved.hidden = !savedHere;
    if (voiceContext && (!editor || !voiceCurrent())) { voice.stop(); voiceContext = null; }
    voiceStart.disabled = !available || working || !!closeTicket;
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
  function open(initial?: { memo: Memo; tagIds: string[] } | EditorState, valid: () => boolean = () => true, tags: readonly Tag[] | null = null, duplicate = false, listContext?: ListContext) {
    if (disposed || editor || working || !valid() || !deps.selected()) return false;
    try {
      const context = deps.auth.getContext(); if (!context || !deps.auth.isCurrent(context)) return false;
      editor = duplicate && initial
        ? createDuplicateEditor(deps.createId(), initial, { id: deps.createId(), source: 'cloud' })
        : createEditor(initial && 'memo' in initial ? initial.memo.id : deps.createId(), deps.createId(), initial && 'memo' in initial ? initial : undefined, 'cloud');
      navigation = listContext ?? null;
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
    start: (memo: Memo, tagIds: string[], valid: () => boolean, tags: readonly Tag[] = [], context?: ListContext) => open({ memo, tagIds }, valid, tags, false, context),
    startNew: (choices: { tags: readonly Tag[]; valid: () => boolean; context?: ListContext } | null = null) => open(undefined, choices?.valid, choices?.tags ?? null, false, choices?.context),
    async startNewVoice(choices: { tags: readonly Tag[]; valid: () => boolean; context?: ListContext } | null = null) {
      if (disposed || editor || working || !deps.selected() || (choices && !choices.valid())) return false;
      voiceChoices = choices;
      try { await startVoice(); return !!editor; } finally { voiceChoices = null; }
    },
    duplicate: (memo: Memo, tagIds: string[], valid: () => boolean, tags: readonly Tag[], context?: ListContext) => open({ memo, tagIds }, valid, tags, true, context),
    getState: () => editor,
    isBusy: () => working,
    refresh: render,
    dispose() { disposed = true; voice.dispose(); voice.status.remove(); voiceContext = null; voiceChoices = null; editor = null; navigation = null; pending = null; owner = null; closeTicket = null; notice = '';
      tagInputs.forEach(({ node }) => { node.onchange = null; }); tagInputs = []; candidates = null; candidateContext = null; candidateView = null;
      tagField.replaceChildren(); tagNotice.textContent = '';
      title.oninput = body.oninput = null; title.value = body.value = ''; root.remove(); },
  });
}

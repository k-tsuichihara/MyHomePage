import type { createMemoAuthSession, MemoAuthState } from './auth-session';
import type { LocalAppState } from './local-app-state';
import { appDepartureReason, requestNavigation, confirmNavigation } from './navigation-state';
import type { LeaveConfirmation } from './navigation-state';
import type { createStorageTargetController, StorageTarget, StorageTargetDecision, StorageLeaveDecision } from './storage-target-controller';
import type { createCloudController, CloudUncertainOperationResult, CloudStateResult, CloudDeleteResult, CloudEmptyTrashResult, CloudSaveTagResult, CloudDeleteTagResult } from './cloud-controller';
import type { CloudTarget } from './cloud-rpc-types';
import type { AuthContext } from './auth-session';
import type { Memo, Tag } from './types';
import { normalizeTagName } from './input';
import { isDirty } from './editor-state';
import { uuidKey } from './read-primitives';
import { mountProductSnapshot } from './ui/product-snapshot-view';
import { mountProductCloudEditor } from './product-cloud-editor';
import type { EditorState } from './editor-state';

/** 所有する既存sessionだけを注入する。SDK/Storage/transportをこのUIで生成しない。 */
export type ProductSessionPort = Pick<ReturnType<typeof createMemoAuthSession>,
  'getState' | 'subscribe' | 'restore' | 'login' | 'logout'>
  & Partial<Pick<ReturnType<typeof createMemoAuthSession>, 'getContext' | 'isCurrent'>>
  & { dispose(): void | Promise<void> };

/** 生成済みC04/C05を所有する接続。注入済みのメモ操作だけを使用し、transportは受け取らない。 */
export interface ProductCloudHost {
  readonly target: ReturnType<typeof createStorageTargetController>;
  readonly controller: Pick<ReturnType<typeof createCloudController>, 'load' | 'dispose'>
    & Partial<Pick<ReturnType<typeof createCloudController>, 'save' | 'resolve' | 'changeState' | 'deletePermanently' | 'emptyTrash' | 'saveTag' | 'deleteTag'>>;
}

const phases: Record<MemoAuthState['phase'], string> = {
  'signed-out': '未ログイン', checking: '認証を確認中', authenticated: 'ログイン済み',
  blocked: '認証を確認できません', disposed: '認証を終了しました',
};

/** 既存sessionと、任意のC04/C05を接続する。SDK・通信・同期は生成しない。 */
export function mountProductSession(doc: Document, session: ProductSessionPort,
  local: { getState(): LocalAppState; isBusy(): boolean; createId?(): string; setCloudSelected?(selected: boolean): void },
  injectedCloud?: ProductCloudHost) {
  // 同じsessionの現在contextを取得できない場合は従来local-onlyに留める。
  const cloud = session.getContext && session.isCurrent ? injectedCloud : undefined;
  const root = doc.createElement('section'); root.id = 'product-session';
  root.setAttribute('aria-label', '認証');
  const state = doc.createElement('p'); state.id = 'product-session-state'; state.setAttribute('role', 'status');
  const source = doc.createElement('p'); source.textContent = '保存先：ローカル（クラウド未接続）';
  const form = doc.createElement('form');
  const field = (text: string, type: string) => {
    const label = doc.createElement('label'); label.textContent = text;
    const input = doc.createElement('input'); input.type = type; input.autocomplete = 'off';
    label.append(input); form.append(label); return input;
  };
  const email = field('ログイン用メールアドレス', 'email');
  const password = field('ログイン用パスワード', 'password');
  const button = (text: string) => {
    const node = doc.createElement('button'); node.type = 'button'; node.textContent = text; return node;
  };
  const login = button('ログイン'), restore = button('セッションを復元'), logout = button('ログアウト');
  const chooseLocal = button('ローカルを選択'), chooseCloud = button('クラウドを選択');
  const newCloud = button('クラウドに新規メモ');
  const cloudStatus = doc.createElement('p'); cloudStatus.id = 'product-cloud-state'; cloudStatus.setAttribute('role', 'status');
  if (cloud) root.append(chooseLocal, chooseCloud, cloudStatus);
  const stateStatus = doc.createElement('p'); stateStatus.id = 'product-cloud-trash-state'; stateStatus.setAttribute('role', 'status');
  if (cloud?.controller.changeState || cloud?.controller.deletePermanently || cloud?.controller.emptyTrash || cloud?.controller.saveTag || cloud?.controller.deleteTag) root.append(stateStatus);
  const feedback = doc.createElement('p'); feedback.setAttribute('role', 'status');
  const confirmation = doc.createElement('div'); confirmation.hidden = true;
  confirmation.setAttribute('role', 'group'); confirmation.setAttribute('aria-label', 'ログアウトの離脱確認');
  const warning = doc.createElement('p'); warning.textContent = '未保存・保存拒否・結果不明の編集があります。ログアウトを続けますか？';
  const proceed = button('確認してログアウト'), cancel = button('ログアウトをキャンセル');
  confirmation.append(warning, proceed, cancel);
  form.append(login, restore, logout); root.append(state, source, form, confirmation, feedback);
  let cloudEditor: ReturnType<typeof mountProductCloudEditor> | undefined;
  const snapshotView = cloud ? mountProductSnapshot(doc, root,
    cloud.controller.save && cloud.controller.resolve && local.createId ? (memo, tags, valid) =>
      !isBusy() && !stateUncertain() && !busy && !pending && (cloudEditor?.start(memo, tags, valid) ?? false) : undefined,
    cloud.controller.changeState && local.createId ? startStateChange : undefined,
    cloud.controller.deletePermanently && local.createId ? (memo, valid) => startStateChange(memo, 'delete-permanently', valid) : undefined,
    cloud.controller.emptyTrash && local.createId ? startEmptyTrash : undefined,
    cloud.controller.saveTag && local.createId ? { canStart: () => !closed && !unavailable && !busy && !pending && !isBusy()
      && !loading && !stateUncertain() && !cloudEditor?.getState() && !!cloudContext(), save: startSaveTag } : undefined,
    cloud.controller.deleteTag ? startDeleteTag : undefined) : undefined;
  const anchor = doc.getElementById('product-status');
  if (anchor) anchor.after(root); else doc.body.prepend(root);
  let closed = false, busy = false, generation = -1, unavailable = false;
  // 不明操作はC04の返却結果ごと保持する。UI独自の再送・照合状態には変換しない。
  type StateChangeRecord = { readonly request: Readonly<{ context: AuthContext; id: string; expectedRevision: number; requestId: string; action: 'pin' | 'unpin' | 'trash' | 'restore' | 'delete-permanently' }>
    | Readonly<{ context: AuthContext; targets: readonly Readonly<CloudTarget>[]; requestId: string; action: 'empty-trash' }>
    | Readonly<{ context: AuthContext; id: string; name: string; expectedRevision: number | null; action: 'save-tag' }>
    | Readonly<{ context: AuthContext; id: string; name: string; expectedRevision: number; action: 'delete-tag' }>;
    result: CloudUncertainOperationResult<CloudStateResult | CloudDeleteResult | CloudEmptyTrashResult | CloudSaveTagResult | CloudDeleteTagResult> | null };
  let stateRecord: StateChangeRecord | null = null, stateRunning = false;
  const stateUncertain = () => !!stateRecord && (!stateRecord.result || stateRecord.result.kind === 'unresolved'
    || stateRecord.result.kind === 'stale-response' || (stateRecord.result.kind === 'completed'
      && (stateRecord.result.result.kind === 'unknown' || stateRecord.result.result.kind === 'failed')));
  type TargetConfirmation = Extract<StorageTargetDecision, { kind: 'confirmation-required' }>;
  let pending: { app: LocalAppState; generation: number; tickets: LeaveConfirmation[];
    editor: EditorState | null;
    mutation: StateChangeRecord | null;
    intent: 'logout' | StorageTarget; target?: TargetConfirmation } | undefined;
  let observedApp: LocalAppState | undefined, cloudOwner: string | null = null;
  let observedEditor: EditorState | null | undefined, selectionTicket = {};
  const isBusy = () => local.isBusy() || !!cloudEditor?.isBusy() || stateRunning;
  let loading = false;
  const context = () => {
    const value = session.getContext?.();
    return value && session.isCurrent?.(value) ? value : null;
  };
  const targetAuth = () => { const value = context(); return value ? { authenticated: true, generation: value.generation } : null; };
  const cloudContext = () => {
    const value = context(), selected = cloud?.target.current();
    return value && selected?.target === 'cloud' && selected.generation === value.generation
      && uuidKey(value.userId) === cloudOwner ? value : null;
  };
  const syncSource = () => {
    if (!cloud) return;
    const app = local.getState();
    const editor = cloudEditor?.getState() ?? null;
    if (app !== observedApp || editor !== observedEditor) {
      observedApp = app;
      observedEditor = editor;
      cloud.target.setDirty([...app.retainedEditors, ...(app.editor ? [app.editor] : []), ...(editor ? [editor] : [])].some(isDirty));
    }
    const value = context();
    const current = cloud.target.current();
    if (current.target === 'cloud' && value && uuidKey(value.userId) === cloudOwner && value.generation !== current.generation) {
      cloud.target.acceptAuthenticatedGeneration({ authenticated: true, generation: value.generation });
      cloudStatus.textContent = '認証が更新されました。再読取には保存先を選び直してください。';
    }
    const selected = cloud.target.current().target === 'cloud';
    local.setCloudSelected?.(selected);
    source.textContent = selected ? cloudEditor
      ? `保存先：クラウド（メモの単件作成・編集・保存${cloud.controller.changeState ? '・ピン留め/解除・ゴミ箱移動・復元' : ''}${cloud.controller.deletePermanently ? '・完全削除' : ''}${cloud.controller.emptyTrash ? '・ゴミ箱一括削除' : ''}${cloud.controller.saveTag ? '・タグ作成/改名' : ''}${cloud.controller.deleteTag ? '・タグ削除' : ''}）`
      : cloud.controller.changeState || cloud.controller.deletePermanently || cloud.controller.emptyTrash || cloud.controller.saveTag || cloud.controller.deleteTag ? '保存先：クラウド（閲覧・注入済み操作）' : '保存先：クラウド（読取のみ・書込未接続）' : '保存先：ローカル';
    if (selected && (!value || uuidKey(value.userId) !== cloudOwner)) {
      cloudStatus.textContent = '停止：同じユーザーで再認証してください。クラウド選択とドラフトは保持しています。';
    }
    snapshotView?.refresh();
    cloudEditor?.refresh();
  };

  const refresh = () => {
    if (closed) return;
    try {
      if (unavailable) throw new Error();
      // SDK通知は再描画のきっかけだけ。payloadの古い状態や任意文字列を表示しない。
      const current = session.getState();
      if (!Number.isSafeInteger(current.generation) || current.generation < generation) return;
      generation = current.generation;
      syncSource();
      chooseLocal.disabled = chooseCloud.disabled = busy || !!pending || isBusy();
      newCloud.disabled = !cloudEditor || !!cloudEditor.getState() || stateUncertain() || busy || !!pending || isBusy() || loading
        || !cloudContext();
      state.textContent = Object.hasOwn(phases, current.phase) ? phases[current.phase] : phases.blocked;
      if (current.phase === 'blocked') state.textContent += '。同じユーザーで再認証してください。';
      if (current.phase === 'disposed') { unavailable = true; login.disabled = restore.disabled = logout.disabled = true; return; }
      login.disabled = restore.disabled = busy || !!pending || current.phase === 'checking';
      logout.disabled = busy || !!pending || isBusy() || current.phase === 'checking' || current.phase === 'signed-out';
    } catch {
      unavailable = true;
      snapshotView?.clear();
      cloudEditor?.refresh();
      state.textContent = phases.blocked;
      login.disabled = restore.disabled = logout.disabled = true;
      newCloud.disabled = true;
    }
  };
  const clearConfirmation = () => { pending = undefined; confirmation.hidden = true; };
  const run = async (operation: 'login' | 'restore' | 'logout') => {
    if (closed || unavailable || busy || pending) return;
    busy = true; feedback.textContent = '';
    // 呼出し以降、このUIは入力値を継続保持しない。JSメモリ完全消去は保証しない。
    let address = email.value, secret = password.value;
    email.value = password.value = '';
    refresh();
    try {
      if (unavailable) return;
      const call = operation === 'login' ? session.login(address, secret)
        : operation === 'logout' ? session.logout() : session.restore();
      address = secret = '';
      await call;
    } catch { if (!closed) feedback.textContent = '認証操作を完了できませんでした。'; }
    finally { address = secret = ''; busy = false; refresh(); }
  };
  const departure = (intent: 'logout' | StorageTarget) => {
    if (isBusy()) return null;
    const app = local.getState();
    const editor = cloudEditor?.getState() ?? null;
    const editors = [...app.retainedEditors, ...(app.editor ? [app.editor] : []), ...(editor ? [editor] : [])];
    const decisions = editors.map(editor => requestNavigation(editor, { kind: intent === 'logout' ? 'logout' : 'switch-source' }));
    if (decisions.some(decision => decision.kind === 'blocked')) return null;
    return { app, editor, mutation: stateRecord, generation, intent, tickets: decisions.flatMap(decision =>
      decision.kind === 'confirmation-required' ? [decision.ticket] : []) };
  };
  const leaveDecision = (decision: NonNullable<ReturnType<typeof departure>>): StorageLeaveDecision => {
    if (stateUncertain()) return { kind: 'confirmation-required', reason: 'unknown' };
    const reason = appDepartureReason(decision.app);
    return reason || decision.tickets.length ? { kind: 'confirmation-required', reason: reason ?? 'unsaved' } : { kind: 'allowed' };
  };
  const readCloud = async () => {
    if (!cloud || closed || loading || cloud.target.current().target !== 'cloud') return;
    const auth = cloudContext();
    if (!auth) { refresh(); return; }
    const selection = cloud.target.current();
    snapshotView?.clear();
    selectionTicket = {};
    loading = true; cloudStatus.textContent = 'クラウド読取中です。書込は行いません。';
    refresh();
    try {
      const result = await cloud.controller.load(auth);
      if (closed || cloud.target.current() !== selection || !session.isCurrent?.(auth)) {
        if (!closed && cloud.target.current().target === 'cloud' && session.isCurrent?.(auth)) {
          cloudStatus.textContent = '停止：切替前のクラウド応答を反映しません。';
        }
        return;
      }
      cloudStatus.textContent = result.kind === 'completed'
        ? result.result.kind === 'ok' ? `クラウド読取成功：メモ${result.result.value.memos.length}件・タグ${result.result.value.tags.length}件。${cloudEditor ? '既存メモの単件編集ができます。' : cloud.controller.changeState ? '単件ピン留め/解除・ゴミ箱移動・復元ができます。' : cloud.controller.deletePermanently ? 'ゴミ箱内メモの単件完全削除ができます。' : cloud.controller.emptyTrash ? 'ゴミ箱の一括完全削除ができます。' : cloud.controller.saveTag ? 'タグの単件作成・改名ができます。' : cloud.controller.deleteTag ? 'タグの単件削除ができます。' : '書込未接続です。'}`
          : result.result.kind === 'unknown' || result.result.kind === 'failed' ? 'UNKNOWN：読取結果を確認できません。自動再試行しません。'
          : '停止：クラウド読取は許可されませんでした。'
        : result.kind === 'stale-response' ? '停止：古いクラウド応答を反映しません。'
          : '停止：クラウド読取を完了できませんでした。';
      if (result.kind === 'completed' && result.result.kind === 'ok') {
        snapshotView?.show(result.result.value, () => !closed && cloud.target.current() === selection && !!session.isCurrent?.(auth));
      }
    } catch { if (!closed && cloud.target.current() === selection) cloudStatus.textContent = 'UNKNOWN：読取結果を確認できません。自動再試行しません。'; }
    finally { loading = false; if (closed) cloud.controller.dispose(); else refresh(); }
  };
  const applyTarget = (result: StorageTargetDecision, intent: 'logout' | StorageTarget,
    from: ReturnType<ProductCloudHost['target']['current']>) => {
    if (!cloud) return;
    if (result.kind === 'rejected') { feedback.textContent = '保存先を変更できません。現在の認証・編集状態を確認してください。'; refresh(); return; }
    if (result.kind !== 'changed') return;
    if (result.state === from && intent !== 'logout') { refresh(); return; }
    snapshotView?.clear();
    selectionTicket = {};
    if (result.state.target === 'cloud' && from.target !== 'cloud') {
      const auth = context(); cloudOwner = auth ? uuidKey(auth.userId) : null;
    }
    if (result.state.target === 'local') { cloudOwner = null; cloudStatus.textContent = ''; }
    observedApp = undefined;
    refresh();
    if (intent === 'logout') void run('logout');
    else if (result.state.target === 'cloud' && from.target !== 'cloud') void readCloud();
  };
  const requestDeparture = (intent: 'logout' | StorageTarget) => {
    if (closed || busy || pending) return;
    if (intent === 'cloud' && loading) { feedback.textContent = '前の読取処理の終了を待ってください。'; return; }
    refresh();
    if (unavailable) return;
    const decision = departure(intent);
    if (!decision) { feedback.textContent = '保存処理中は離脱できません。'; return; }
    if (cloud) {
      const from = cloud.target.current();
      const result = intent === 'logout' ? cloud.target.logout(leaveDecision(decision))
        : cloud.target.request(intent, targetAuth(), leaveDecision(decision));
      if (result.kind === 'confirmation-required') {
        pending = { ...decision, target: result }; confirmation.hidden = false;
      } else applyTarget(result, intent, from);
    } else if (intent === 'logout') {
      if (appDepartureReason(decision.app) || decision.tickets.length) { pending = decision; confirmation.hidden = false; }
      else void run('logout');
    }
    warning.textContent = intent === 'logout' ? '未保存・保存拒否・結果不明の編集があります。ログアウトを続けますか？'
      : '未保存・保存拒否・結果不明の編集があります。保存先の変更を続けますか？';
    proceed.textContent = intent === 'logout' ? '確認してログアウト' : '確認して保存先を変更';
    cancel.textContent = intent === 'logout' ? 'ログアウトをキャンセル' : '保存先変更をキャンセル';
    confirmation.setAttribute('aria-label', intent === 'logout' ? 'ログアウトの離脱確認' : '保存先変更の離脱確認');
    refresh();
  };
  const onLogout = () => {
    if (closed || busy || pending) return;
    refresh();
    if (unavailable) return;
    requestDeparture('logout');
  };
  const onProceed = () => {
    if (closed || busy || !pending) return;
    refresh();
    const ticket = pending;
    const current = local.getState();
    const valid = !isBusy() && current === ticket.app && generation === ticket.generation
      && (cloudEditor?.getState() ?? null) === ticket.editor
      && stateRecord === ticket.mutation
      && ticket.tickets.every(value => confirmNavigation(value.state, value, true).kind === 'allowed');
    clearConfirmation();
    if (!valid) { feedback.textContent = '確認後に状態が変わりました。操作をやり直してください。'; refresh(); return; }
    if (cloud && ticket.target) {
      const from = cloud.target.current();
      applyTarget(cloud.target.confirm(ticket.target, true, targetAuth(), { kind: 'allowed' }), ticket.intent, from);
    }
    else void run('logout');
  };
  const onCancel = () => { if (closed) return;
    if (cloud && pending?.target) cloud.target.confirm(pending.target, false, targetAuth(), { kind: 'allowed' });
    clearConfirmation(); feedback.textContent = '離脱をキャンセルしました。'; refresh(); };
  const onLocal = () => requestDeparture('local'), onCloud = () => requestDeparture('cloud');
  const onNewCloud = () => {
    if (closed || unavailable || busy || pending || isBusy() || loading || stateUncertain() || !cloudContext()) return;
    if (cloudEditor?.startNew()) {
      snapshotView?.clear();
      cloudStatus.textContent = '新規メモを編集中です。保存成功前に一覧へ追加しません。';
    }
  };
  chooseLocal.addEventListener('click', onLocal); chooseCloud.addEventListener('click', onCloud);
  const onLogin = () => { void run('login'); };
  const onRestore = () => { void run('restore'); };
  const onSubmit = (event: Event) => { event.preventDefault(); onLogin(); };
  login.addEventListener('click', onLogin); restore.addEventListener('click', onRestore);
  logout.addEventListener('click', onLogout); proceed.addEventListener('click', onProceed); cancel.addEventListener('click', onCancel);
  form.addEventListener('submit', onSubmit);
  if (cloud?.controller.save && cloud.controller.resolve && session.getContext && session.isCurrent && local.createId) {
    cloudEditor = mountProductCloudEditor(doc, root, { writer: { save: cloud.controller.save, resolve: cloud.controller.resolve },
      auth: { getContext: session.getContext, isCurrent: session.isCurrent }, createId: local.createId,
      selected: () => !closed && !unavailable && cloud.target.current().target === 'cloud', viewKey: () => selectionTicket, changed: refresh });
    newCloud.addEventListener('click', onNewCloud); root.append(newCloud);
  }
  let unsubscribe = () => {};
  try { unsubscribe = session.subscribe(refresh); } catch { unavailable = true; feedback.textContent = '認証状態を購読できませんでした。'; }
  refresh(); void run('restore');
  function startStateChange(memo: Memo, action: 'pin' | 'unpin' | 'trash' | 'restore' | 'delete-permanently', valid: () => boolean): boolean {
    if (!cloud || !(action === 'delete-permanently' ? cloud.controller.deletePermanently : cloud.controller.changeState)
      || !local.createId || closed || unavailable || busy || pending || isBusy() || loading
      || stateUncertain() || cloudEditor?.getState()
      || (action === 'restore' || action === 'delete-permanently' ? memo.deletedAt === null : memo.deletedAt !== null)
      || (action === 'pin' && memo.pinnedAt !== null) || (action === 'unpin' && memo.pinnedAt === null) || !valid()) return false;
    const auth = cloudContext(); if (!auth) return false;
    const label = action === 'trash' ? 'ゴミ箱への移動' : action === 'restore' ? '復元'
      : action === 'pin' ? 'ピン留め' : action === 'unpin' ? 'ピン留め解除' : '完全削除';
    let request: StateChangeRecord['request'];
    try { request = Object.freeze({ context: auth, id: memo.id, expectedRevision: memo.revision, requestId: local.createId(), action }); }
    catch { stateStatus.textContent = `停止：要求を作れません。${label}は開始していません。`; return false; }
    return runStateRequest(request, valid, label);
  }
  function startEmptyTrash(targets: readonly CloudTarget[], valid: () => boolean): boolean {
    if (!cloud?.controller.emptyTrash || !local.createId || closed || unavailable || busy || pending || isBusy() || loading
      || stateUncertain() || cloudEditor?.getState() || !valid()) return false;
    if (!targets.length) { stateStatus.textContent = 'ゴミ箱は空です。'; return false; }
    const auth = cloudContext(); if (!auth) return false;
    let request: StateChangeRecord['request'];
    try { request = Object.freeze({ context: auth, action: 'empty-trash' as const, requestId: local.createId(),
      targets: Object.freeze(targets.map(row => Object.freeze({ id: row.id, revision: row.revision }))) }); }
    catch { stateStatus.textContent = '停止：一括完全削除の要求を作れません。開始していません。'; return false; }
    return runStateRequest(request, valid, '一括完全削除');
  }
  function startSaveTag(tag: Tag | null, rawName: string, valid: () => boolean): boolean {
    if (!cloud?.controller.saveTag || !local.createId || closed || unavailable || busy || pending || isBusy() || loading
      || stateUncertain() || cloudEditor?.getState() || !valid()) return false;
    const auth = cloudContext(); if (!auth) return false;
    let name: string;
    try { name = normalizeTagName(rawName); }
    catch { stateStatus.textContent = 'タグ名を確認してください。空白のみ・30文字超過・使用できない文字は保存できません。'; return false; }
    let request: StateChangeRecord['request'];
    try { request = Object.freeze({ context: auth, action: 'save-tag' as const, id: tag?.id ?? local.createId(), name,
      expectedRevision: tag?.revision ?? null }); }
    catch { stateStatus.textContent = '停止：タグ要求を作れません。保存は開始していません。'; return false; }
    return runStateRequest(request, valid, tag ? 'タグ改名' : 'タグ作成');
  }
  function startDeleteTag(tag: Tag, valid: () => boolean): boolean {
    if (!cloud?.controller.deleteTag || closed || unavailable || busy || pending || isBusy() || loading
      || stateUncertain() || cloudEditor?.getState() || !valid()) return false;
    const auth = cloudContext(); if (!auth) return false;
    const request = Object.freeze({ context: auth, action: 'delete-tag' as const, id: tag.id, name: tag.name, expectedRevision: tag.revision });
    return runStateRequest(request, valid, 'タグ削除');
  }
  // 認証/結果判定はC04に委譲し、既存の単件操作と同じbusy・不明保持・離脱境界を使う。
  function runStateRequest(request: StateChangeRecord['request'], valid: () => boolean, label: string): boolean {
    const record: StateChangeRecord = { request, result: null }; stateRecord = record; stateRunning = true;
    // 要求開始後の旧snapshotを現在値として扱わず、行だけの楽観更新もしない。
    snapshotView?.clear(); stateStatus.textContent = `${label}の処理中です。離脱・二重送信はできません。`; refresh();
    void (async () => {
      try {
        // 完全削除のrequestIdは既存C04の内部識別用。RPC引数への変換は既存adapterだけが担う。
        const result = request.action === 'delete-tag'
          ? await cloud!.controller.deleteTag!(request.context, request.id, request.expectedRevision)
          : request.action === 'save-tag'
          ? await cloud!.controller.saveTag!(request.context, request.id, request.name, request.expectedRevision)
          : request.action === 'empty-trash'
          ? await cloud!.controller.emptyTrash!(request.context, request.targets, request.requestId)
          : request.action === 'delete-permanently'
            ? await cloud!.controller.deletePermanently!(request.context, request.id, { expectedRevision: request.expectedRevision, requestId: request.requestId })
            : await cloud!.controller.changeState!(request.context, request.id, request.action, { expectedRevision: request.expectedRevision, requestId: request.requestId });
        record.result = result;
        if (closed || stateRecord !== record) return;
        if (!valid() || !cloudContext() || !session.isCurrent?.(request.context)) {
          stateStatus.textContent = '停止：古い状態変更の応答を現在画面へ反映しません。元要求は保持し、自動再送しません。'; return;
        }
        stateStatus.textContent = result.kind === 'completed'
          ? result.result.kind === 'ok' ? request.action === 'delete-permanently' || request.action === 'empty-trash' || request.action === 'save-tag' || request.action === 'delete-tag'
            || (typeof result.result.value === 'object' && result.result.value && 'kind' in result.result.value && result.result.value.kind === 'changed')
            ? `${label}要求の成功を確認しました。${request.action === 'empty-trash' ? `削除件数${result.result.value}件。` : ''}現在snapshotの確認には明示再読取が必要です。`
            : '状態変更要求は適用済みですが、メモは削除済みです。現在状態は明示再読取が必要です。'
          : result.result.kind === 'rejected' ? result.result.reason === 'conflict'
            ? `競合：${label}は拒否されました。自動再送せず、明示再読取が必要です。`
            : `拒否：${label}は許可されませんでした。自動再送しません。`
          : result.result.kind === 'not-attempted' ? '停止：状態変更は送信されていません。'
          : `UNKNOWN：${label}できたか不明です。元要求を保持して停止します。自動再送・独自照合はしません。`
          : result.kind === 'unresolved' || result.kind === 'stale-response'
            ? `UNKNOWN：${label}できたか不明です。元要求を保持して停止します。自動再送・独自照合はしません。`
            : `停止：${label}を開始・完了できませんでした。`;
      } catch { if (!closed) stateStatus.textContent = 'UNKNOWN：状態変更の結果を確認できません。元要求を保持して停止し、自動再送しません。'; }
      finally { stateRunning = false; if (!closed) refresh(); }
    })();
    return true;
  }
  return Object.freeze({ refresh, dispose() {
    if (closed) return 'applied' as const;
    if (cloudEditor?.isBusy() || stateRunning) return 'busy' as const;
    if (stateUncertain()) return 'pending' as const;
    if (cloudEditor?.getState()?.unresolved.length) return 'pending' as const;
    if (cloud && !loading) { const result = cloud.controller.dispose(); if (result !== 'applied') return result; }
    closed = true; clearConfirmation(); email.value = password.value = '';
    snapshotView?.dispose();
    cloudEditor?.dispose();
    chooseLocal.removeEventListener('click', onLocal); chooseCloud.removeEventListener('click', onCloud);
    newCloud.removeEventListener('click', onNewCloud);
    try { unsubscribe(); } catch { /* 外部例外を表示しない。 */ }
    login.removeEventListener('click', onLogin); restore.removeEventListener('click', onRestore);
    logout.removeEventListener('click', onLogout); proceed.removeEventListener('click', onProceed); cancel.removeEventListener('click', onCancel);
    form.removeEventListener('submit', onSubmit); root.remove();
    try { void Promise.resolve(session.dispose()).catch(() => {}); } catch { /* 終了例外も秘密値を表示しない。 */ }
    return 'applied' as const;
  } });
}

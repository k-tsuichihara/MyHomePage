import type { createMemoAuthSession, MemoAuthState } from './auth-session';
import type { LocalAppState } from './local-app-state';
import { appDepartureReason, requestNavigation, confirmNavigation } from './navigation-state';
import type { LeaveConfirmation } from './navigation-state';
import type { createStorageTargetController, StorageTarget, StorageTargetDecision, StorageLeaveDecision } from './storage-target-controller';
import type { createCloudController } from './cloud-controller';
import { isDirty } from './editor-state';
import { uuidKey } from './read-primitives';
import { mountProductSnapshot } from './ui/product-snapshot-view';

/** 所有する既存sessionだけを注入する。SDK/Storage/transportをこのUIで生成しない。 */
export type ProductSessionPort = Pick<ReturnType<typeof createMemoAuthSession>,
  'getState' | 'subscribe' | 'restore' | 'login' | 'logout'>
  & Partial<Pick<ReturnType<typeof createMemoAuthSession>, 'getContext' | 'isCurrent'>>
  & { dispose(): void | Promise<void> };

/** 生成済みC04/C05だけを所有する読取接続。write能力やtransportはUIへ渡さない。 */
export interface ProductCloudHost {
  readonly target: ReturnType<typeof createStorageTargetController>;
  readonly controller: Pick<ReturnType<typeof createCloudController>, 'load' | 'dispose'>;
}

const phases: Record<MemoAuthState['phase'], string> = {
  'signed-out': '未ログイン', checking: '認証を確認中', authenticated: 'ログイン済み',
  blocked: '認証を確認できません', disposed: '認証を終了しました',
};

/** 既存sessionと、任意のC04/C05を接続する。SDK・通信・同期は生成しない。 */
export function mountProductSession(doc: Document, session: ProductSessionPort,
  local: { getState(): LocalAppState; isBusy(): boolean; setCloudSelected?(selected: boolean): void },
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
  const cloudStatus = doc.createElement('p'); cloudStatus.id = 'product-cloud-state'; cloudStatus.setAttribute('role', 'status');
  if (cloud) root.append(chooseLocal, chooseCloud, cloudStatus);
  const feedback = doc.createElement('p'); feedback.setAttribute('role', 'status');
  const confirmation = doc.createElement('div'); confirmation.hidden = true;
  confirmation.setAttribute('role', 'group'); confirmation.setAttribute('aria-label', 'ログアウトの離脱確認');
  const warning = doc.createElement('p'); warning.textContent = '未保存・保存拒否・結果不明の編集があります。ログアウトを続けますか？';
  const proceed = button('確認してログアウト'), cancel = button('ログアウトをキャンセル');
  confirmation.append(warning, proceed, cancel);
  form.append(login, restore, logout); root.append(state, source, form, confirmation, feedback);
  const snapshotView = cloud ? mountProductSnapshot(doc, root) : undefined;
  const anchor = doc.getElementById('product-status');
  if (anchor) anchor.after(root); else doc.body.prepend(root);
  let closed = false, busy = false, generation = -1, unavailable = false;
  type TargetConfirmation = Extract<StorageTargetDecision, { kind: 'confirmation-required' }>;
  let pending: { app: LocalAppState; generation: number; tickets: LeaveConfirmation[];
    intent: 'logout' | StorageTarget; target?: TargetConfirmation } | undefined;
  let observedApp: LocalAppState | undefined, cloudOwner: string | null = null;
  let loading = false;
  const context = () => {
    const value = session.getContext?.();
    return value && session.isCurrent?.(value) ? value : null;
  };
  const targetAuth = () => { const value = context(); return value ? { authenticated: true, generation: value.generation } : null; };
  const syncSource = () => {
    if (!cloud) return;
    const app = local.getState();
    if (app !== observedApp) {
      observedApp = app;
      cloud.target.setDirty([...app.retainedEditors, ...(app.editor ? [app.editor] : [])].some(isDirty));
    }
    const value = context();
    const current = cloud.target.current();
    if (current.target === 'cloud' && value && uuidKey(value.userId) === cloudOwner && value.generation !== current.generation) {
      cloud.target.acceptAuthenticatedGeneration({ authenticated: true, generation: value.generation });
      cloudStatus.textContent = '認証が更新されました。再読取には保存先を選び直してください。';
    }
    const selected = cloud.target.current().target === 'cloud';
    local.setCloudSelected?.(selected);
    source.textContent = selected ? '保存先：クラウド（読取のみ・書込未接続）' : '保存先：ローカル';
    if (selected && (!value || uuidKey(value.userId) !== cloudOwner)) {
      cloudStatus.textContent = '停止：同じユーザーで再認証してください。クラウド選択とドラフトは保持しています。';
    }
    snapshotView?.refresh();
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
      chooseLocal.disabled = chooseCloud.disabled = busy || !!pending || local.isBusy();
      state.textContent = Object.hasOwn(phases, current.phase) ? phases[current.phase] : phases.blocked;
      if (current.phase === 'blocked') state.textContent += '。同じユーザーで再認証してください。';
      if (current.phase === 'disposed') { unavailable = true; login.disabled = restore.disabled = logout.disabled = true; return; }
      login.disabled = restore.disabled = busy || !!pending || current.phase === 'checking';
      logout.disabled = busy || !!pending || local.isBusy() || current.phase === 'checking' || current.phase === 'signed-out';
    } catch {
      unavailable = true;
      snapshotView?.clear();
      state.textContent = phases.blocked;
      login.disabled = restore.disabled = logout.disabled = true;
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
    if (local.isBusy()) return null;
    const app = local.getState();
    const editors = [...app.retainedEditors, ...(app.editor ? [app.editor] : [])];
    const decisions = editors.map(editor => requestNavigation(editor, { kind: intent === 'logout' ? 'logout' : 'switch-source' }));
    if (decisions.some(decision => decision.kind === 'blocked')) return null;
    return { app, generation, intent, tickets: decisions.flatMap(decision =>
      decision.kind === 'confirmation-required' ? [decision.ticket] : []) };
  };
  const leaveDecision = (decision: NonNullable<ReturnType<typeof departure>>): StorageLeaveDecision => {
    const reason = appDepartureReason(decision.app);
    return reason || decision.tickets.length ? { kind: 'confirmation-required', reason: reason ?? 'unsaved' } : { kind: 'allowed' };
  };
  const readCloud = async () => {
    if (!cloud || closed || loading || cloud.target.current().target !== 'cloud') return;
    const auth = context();
    if (!auth || uuidKey(auth.userId) !== cloudOwner) { refresh(); return; }
    const selection = cloud.target.current();
    snapshotView?.clear();
    loading = true; cloudStatus.textContent = 'クラウド読取中です。書込は行いません。';
    try {
      const result = await cloud.controller.load(auth);
      if (closed || cloud.target.current() !== selection || !session.isCurrent?.(auth)) {
        if (!closed && cloud.target.current().target === 'cloud' && session.isCurrent?.(auth)) {
          cloudStatus.textContent = '停止：切替前のクラウド応答を反映しません。';
        }
        return;
      }
      cloudStatus.textContent = result.kind === 'completed'
        ? result.result.kind === 'ok' ? `クラウド読取成功：メモ${result.result.value.memos.length}件・タグ${result.result.value.tags.length}件。書込未接続です。`
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
    const valid = !local.isBusy() && current === ticket.app && generation === ticket.generation
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
  chooseLocal.addEventListener('click', onLocal); chooseCloud.addEventListener('click', onCloud);
  const onLogin = () => { void run('login'); };
  const onRestore = () => { void run('restore'); };
  const onSubmit = (event: Event) => { event.preventDefault(); onLogin(); };
  login.addEventListener('click', onLogin); restore.addEventListener('click', onRestore);
  logout.addEventListener('click', onLogout); proceed.addEventListener('click', onProceed); cancel.addEventListener('click', onCancel);
  form.addEventListener('submit', onSubmit);
  let unsubscribe = () => {};
  try { unsubscribe = session.subscribe(refresh); } catch { unavailable = true; feedback.textContent = '認証状態を購読できませんでした。'; }
  refresh(); void run('restore');
  return Object.freeze({ refresh, dispose() {
    if (closed) return;
    closed = true; clearConfirmation(); email.value = password.value = '';
    snapshotView?.dispose();
    chooseLocal.removeEventListener('click', onLocal); chooseCloud.removeEventListener('click', onCloud);
    if (cloud && !loading) cloud.controller.dispose();
    try { unsubscribe(); } catch { /* 外部例外を表示しない。 */ }
    login.removeEventListener('click', onLogin); restore.removeEventListener('click', onRestore);
    logout.removeEventListener('click', onLogout); proceed.removeEventListener('click', onProceed); cancel.removeEventListener('click', onCancel);
    form.removeEventListener('submit', onSubmit); root.remove();
    try { void Promise.resolve(session.dispose()).catch(() => {}); } catch { /* 終了例外も秘密値を表示しない。 */ }
  } });
}

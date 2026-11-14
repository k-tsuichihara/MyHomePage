import type { createMemoAuthSession, MemoAuthState } from './auth-session';
import type { LocalAppState } from './local-app-state';
import { requestNavigation, confirmNavigation } from './navigation-state';
import type { LeaveConfirmation } from './navigation-state';

/** 所有する既存sessionだけを注入する。SDK/Storage/transportをこのUIで生成しない。 */
export type ProductSessionPort = Pick<ReturnType<typeof createMemoAuthSession>,
  'getState' | 'subscribe' | 'restore' | 'login' | 'logout'> & { dispose(): void | Promise<void> };

const phases: Record<MemoAuthState['phase'], string> = {
  'signed-out': '未ログイン', checking: '認証を確認中', authenticated: 'ログイン済み',
  blocked: '認証を確認できません', disposed: '認証を終了しました',
};

/** Authは表示/操作のみ。保存先やメモ操作先を変更しない。 */
export function mountProductSession(doc: Document, session: ProductSessionPort,
  local: { getState(): LocalAppState; isBusy(): boolean }) {
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
  const feedback = doc.createElement('p'); feedback.setAttribute('role', 'status');
  const confirmation = doc.createElement('div'); confirmation.hidden = true;
  confirmation.setAttribute('role', 'group'); confirmation.setAttribute('aria-label', 'ログアウトの離脱確認');
  const warning = doc.createElement('p'); warning.textContent = '未保存・保存拒否・結果不明の編集があります。ログアウトを続けますか？';
  const proceed = button('確認してログアウト'), cancel = button('ログアウトをキャンセル');
  confirmation.append(warning, proceed, cancel);
  form.append(login, restore, logout); root.append(state, source, form, confirmation, feedback);
  const anchor = doc.getElementById('product-status');
  if (anchor) anchor.after(root); else doc.body.prepend(root);
  let closed = false, busy = false, generation = -1, unavailable = false;
  let pending: { app: LocalAppState; generation: number; tickets: LeaveConfirmation[] } | undefined;

  const refresh = () => {
    if (closed) return;
    try {
      if (unavailable) throw new Error();
      // SDK通知は再描画のきっかけだけ。payloadの古い状態や任意文字列を表示しない。
      const current = session.getState();
      if (!Number.isSafeInteger(current.generation) || current.generation < generation) return;
      generation = current.generation;
      state.textContent = Object.hasOwn(phases, current.phase) ? phases[current.phase] : phases.blocked;
      if (current.phase === 'blocked') state.textContent += '。同じユーザーで再認証してください。';
      if (current.phase === 'disposed') { unavailable = true; login.disabled = restore.disabled = logout.disabled = true; return; }
      login.disabled = restore.disabled = busy || !!pending || current.phase === 'checking';
      logout.disabled = busy || !!pending || local.isBusy() || current.phase === 'checking' || current.phase === 'signed-out';
    } catch {
      unavailable = true;
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
  const departure = () => {
    if (local.isBusy()) return null;
    const app = local.getState();
    const editors = [...app.retainedEditors, ...(app.editor ? [app.editor] : [])];
    const decisions = editors.map(editor => requestNavigation(editor, { kind: 'logout' }));
    if (decisions.some(decision => decision.kind === 'blocked')) return null;
    return { app, generation, tickets: decisions.flatMap(decision =>
      decision.kind === 'confirmation-required' ? [decision.ticket] : []) };
  };
  const onLogout = () => {
    if (closed || busy || pending) return;
    refresh();
    if (unavailable) return;
    const decision = departure();
    if (!decision) { feedback.textContent = '保存処理中はログアウトできません。'; return; }
    if (decision.tickets.length) { pending = decision; confirmation.hidden = false; refresh(); }
    else void run('logout');
  };
  const onProceed = () => {
    if (closed || busy || !pending) return;
    refresh();
    const ticket = pending;
    const current = local.getState();
    const valid = !local.isBusy() && current === ticket.app && generation === ticket.generation
      && ticket.tickets.every(value => confirmNavigation(value.state, value, true).kind === 'allowed');
    clearConfirmation();
    if (!valid) { feedback.textContent = '確認後に状態が変わりました。ログアウトをやり直してください。'; refresh(); return; }
    void run('logout');
  };
  const onCancel = () => { if (closed) return; clearConfirmation(); feedback.textContent = 'ログアウトをキャンセルしました。'; refresh(); };
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
    try { unsubscribe(); } catch { /* 外部例外を表示しない。 */ }
    login.removeEventListener('click', onLogin); restore.removeEventListener('click', onRestore);
    logout.removeEventListener('click', onLogout); proceed.removeEventListener('click', onProceed); cancel.removeEventListener('click', onCancel);
    form.removeEventListener('submit', onSubmit); root.remove();
    try { void Promise.resolve(session.dispose()).catch(() => {}); } catch { /* 終了例外も秘密値を表示しない。 */ }
  } });
}

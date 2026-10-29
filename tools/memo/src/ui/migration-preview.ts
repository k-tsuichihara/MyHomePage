import type { createLocalMigrationController } from '../local-migration-controller';

/** 移行判断を再実装せず、承認トークンと安全な表示状態だけをDOMへ接続する。 */
export function mountMigrationPreview(doc: Document, controller: ReturnType<typeof createLocalMigrationController>, enter: () => Promise<boolean>) {
  const element = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  let entered = false, entering = false, entryFailed = false, displayedToken: number | null = null;
  const render = () => {
    const state = controller.getState();
    const waiting = entering || state.kind === 'inspecting' || state.kind === 'running';
    element<HTMLButtonElement>('migration-inspect').disabled = waiting || entered;
    element('migration-confirmation').hidden = state.kind !== 'confirmation';
    displayedToken = state.kind === 'confirmation' ? state.token : null;
    element('migration-status').textContent = entryFailed ? '通常画面の初回読込に失敗しました。通常利用を停止しています。再診断してください。自動再試行は行いません。' : state.kind === 'confirmation'
      ? state.operation === 'migrate' ? '移行可能です。旧データは保持します。明示承認後に新形式へ移行します。' : 'pendingを検出しました。照合済みの復旧を明示承認後に実行します。'
      : state.kind === 'stopped' ? `停止：${state.result.reason}／段階：${state.result.phase}／${state.result.writeOutcome === 'unverified' ? '書込結果は未確認です。成功とは判定しません。' : '書込未試行です。'} 旧値：${state.result.remaining.legacy}／新値：${state.result.remaining.v2}。自動修復・削除は行いません。必要なら再診断してください。`
      : state.kind === 'cancelled' ? 'キャンセルしました。書込せず停止しています。再開には再診断・再承認が必要です。'
      : waiting ? '診断・処理中です。完了を待ってください。' : state.kind === 'ready' ? '診断・処理が完了しました。' : '未診断です。';
  };
  const finish = async () => {
    render();
    if (controller.getState().kind !== 'ready' || entered || entering) return;
    // 診断と通常loadは別の読取。後者の成功までは診断画面と回復導線を維持する。
    entering = true; render();
    try { entered = await enter(); } catch { entered = false; }
    entering = false; entryFailed = !entered;
    element('migration-view').hidden = entered; element('memo-app').hidden = !entered; render();
  };
  const inspect = async () => {
    if (entering || entered) return;
    entryFailed = false; const pending = controller.inspect(); render(); await pending; await finish();
  };
  element('migration-inspect').addEventListener('click', () => { void inspect(); });
  // ハンドラの実行時に表示中の確認だけを消費する。生文字列はDOMへ渡さない。
  element('migration-yes').addEventListener('click', () => { if (displayedToken !== null) {
    const pending = controller.confirm(displayedToken); render(); void pending.then(finish);
  } });
  element('migration-no').addEventListener('click', () => { if (displayedToken !== null) controller.cancel(displayedToken); render(); });
  void inspect();
}

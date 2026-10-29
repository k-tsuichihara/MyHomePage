import type { createLocalMigrationController } from '../local-migration-controller';

/** 移行判断を再実装せず、承認トークンと安全な表示状態だけをDOMへ接続する。 */
export function mountMigrationPreview(doc: Document, controller: ReturnType<typeof createLocalMigrationController>, enter: () => void) {
  const element = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  let entered = false, displayedToken: number | null = null;
  const render = () => {
    const state = controller.getState();
    const waiting = state.kind === 'inspecting' || state.kind === 'running';
    element<HTMLButtonElement>('migration-inspect').disabled = waiting || state.kind === 'ready';
    element('migration-confirmation').hidden = state.kind !== 'confirmation';
    displayedToken = state.kind === 'confirmation' ? state.token : null;
    element('migration-status').textContent = state.kind === 'confirmation'
      ? state.operation === 'migrate' ? '移行可能です。旧データは保持します。明示承認後に新形式へ移行します。' : 'pendingを検出しました。照合済みの復旧を明示承認後に実行します。'
      : state.kind === 'stopped' ? `停止：${state.result.reason}／段階：${state.result.phase}／${state.result.writeOutcome === 'unverified' ? '書込結果は未確認です。成功とは判定しません。' : '書込未試行です。'} 旧値：${state.result.remaining.legacy}／新値：${state.result.remaining.v2}。自動修復・削除は行いません。必要なら再診断してください。`
      : state.kind === 'cancelled' ? 'キャンセルしました。書込せず停止しています。再開には再診断・再承認が必要です。'
      : waiting ? '診断・処理中です。完了を待ってください。' : state.kind === 'ready' ? '診断・処理が完了しました。' : '未診断です。';
    if (state.kind === 'ready' && !entered) { entered = true; element('migration-view').hidden = true; element('memo-app').hidden = false; enter(); }
  };
  const inspect = async () => { const pending = controller.inspect(); render(); await pending; render(); };
  element('migration-inspect').addEventListener('click', () => { void inspect(); });
  // ハンドラの実行時に表示中の確認だけを消費する。生文字列はDOMへ渡さない。
  element('migration-yes').addEventListener('click', () => { if (displayedToken !== null) {
    const pending = controller.confirm(displayedToken); render(); void pending.then(render);
  } });
  element('migration-no').addEventListener('click', () => { if (displayedToken !== null) controller.cancel(displayedToken); render(); });
  void inspect();
}

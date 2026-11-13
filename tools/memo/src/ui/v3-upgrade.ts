import type { createProductV3Upgrade } from '../product-v3-upgrade';

/** ファイル保存完了を自動判定せず、利用者の確認後だけ更新を要求する。 */
export function mountV3Upgrade(doc: Document, upgrade: ReturnType<typeof createProductV3Upgrade>, canStart: () => boolean,
  reload: () => Promise<unknown>) {
  const section = doc.createElement('section'); section.setAttribute('aria-label', 'v3への更新');
  const label = doc.createElement('label'), ack = doc.createElement('input'); ack.type = 'checkbox';
  label.append(ack, '退避ファイルを保存・確認し、旧タブを閉じました。v3へ更新します。');
  const button = doc.createElement('button'); button.type = 'button'; button.textContent = '確認してv3へ更新';
  const inspect = doc.createElement('button'); inspect.type = 'button'; inspect.textContent = '現在値を再診断';
  const status = doc.createElement('p'); status.setAttribute('role', 'status');
  const notice = doc.createElement('p'); notice.textContent = 'メモ・タグ・関連と移行情報を保持し、削除済みID履歴を空で追加します。変更検出時は再退避が必要です。結果不明では再送・巻戻しを行いません。';
  let disposed = false;
  button.onclick = async () => {
    if (disposed || !ack.checked || !canStart()) return;
    button.disabled = true; ack.checked = false;
    await upgrade.confirm();
    if (disposed) return;
    const state = upgrade.getState();
    status.textContent = state === 'updated' ? 'v3更新の読戻しを確認しました。' : state === 'unknown'
      ? '結果不明です。自動再試行・巻戻しは行いません。現在値を再診断してください。'
      : '更新していません。状態を確認し、必要なら再診断・再退避してください。';
    if (state === 'updated') await reload();
    button.disabled = false;
  };
  inspect.onclick = async () => {
    if (disposed) return;
    const value = await upgrade.diagnose();
    if (!disposed) status.textContent = `現在値：${value}。過去のUNKNOWNを成功へ変更しません。`;
  };
  section.append(notice, label, button, inspect, status); doc.getElementById('memo-app')!.append(section);
  return () => { disposed = true; section.remove(); };
}

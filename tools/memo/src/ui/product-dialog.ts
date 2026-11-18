/** DOMの配置だけを扱う。確認やbusyの判定・取消は各既存controllerへ委ねる。 */
export function openProductDialog(dialog: HTMLDialogElement) {
  if (!dialog.open && dialog.isConnected) dialog.showModal();
}

/** PC用の表示ラベルだけを差し替え、スマホと既存のクリック処理を維持する。 */
export function setPcButtonLabel(doc: Document, button: HTMLButtonElement, label: string) {
  button.dataset.presentationLabel = button.textContent ?? '';
  const mobile = doc.createElement('span'); mobile.className = 'mobile-only'; mobile.textContent = button.textContent;
  const pc = doc.createElement('span'); pc.className = 'pc-only'; pc.textContent = label;
  button.replaceChildren(mobile, pc);
}

/** 入れ子モーダルでも、処理中のパネル以外を従来どおりinertにする。 */
export function outsidePanel(root: HTMLElement, panel: HTMLElement): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  for (let active = panel; active !== root && active.parentElement; active = active.parentElement) {
    for (const sibling of Array.from(active.parentElement.children)) if (sibling !== active && sibling instanceof root.ownerDocument.defaultView!.HTMLElement) nodes.push(sibling);
  }
  return nodes;
}

/** 製品では同じモーダルへ整理し、独立した既存試験UIでは従来の配置を維持する。 */
export function appendBackupPanel(doc: Document, section: HTMLElement) {
  const target = doc.getElementById('product-backup-slot');
  if (target) {
    const heading = doc.createElement('h3');
    const labels: Record<string, string> = { 'JSONバックアップ': 'JSONバックアップ作成', '追加型復元': 'JSONからの追加', '完全削除後の回復': '完全削除済みメモの復元', '保存領域喪失時の初期復元': '初期復元' };
    const label = section.getAttribute('aria-label') ?? ''; heading.textContent = labels[label] ?? label; section.prepend(heading);
  }
  (target ?? doc.getElementById('memo-app'))!.append(section);
}

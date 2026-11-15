import { openProductDialog } from './product-dialog';

/** 製品だけの配置・モーダル操作。保存/認証/離脱の状態は所有しない。 */
export function mountProductLayout(doc: Document) {
  doc.documentElement.dataset.productLayout = 'review2';
  const win = doc.defaultView!;
  const click = (event: Event) => {
    const node = (event.target as Element).closest<HTMLElement>('[data-open-dialog],[data-close-dialog]');
    if (!node) return;
    const id = node.dataset.openDialog ?? node.dataset.closeDialog;
    const dialog = doc.getElementById(id!) as HTMLDialogElement | null;
    if (!dialog || node.closest('[inert]') || (node.dataset.closeDialog && dialog.querySelector('[aria-busy="true"]'))) return;
    if (node.dataset.openDialog) openProductDialog(dialog); else dialog.close();
  };
  const blockBusyClose = (event: Event) => {
    const dialog = event.target as HTMLDialogElement;
    if (dialog.querySelector('[data-close-dialog]')?.closest('[inert]') || dialog.querySelector('[aria-busy="true"]')) event.preventDefault();
  };
  doc.addEventListener('click', click); doc.addEventListener('cancel', blockBusyClose, true);
  const search = (id: string, target: string) => {
    const input = doc.getElementById(id) as HTMLInputElement | null;
    if (!input) return;
    const apply = () => doc.querySelectorAll<HTMLElement>(target).forEach(row => {
      row.hidden = !(row.textContent ?? '').toLocaleLowerCase().includes(input.value.toLocaleLowerCase());
    });
    input.addEventListener('input', apply);
    return apply;
  };
  const filters = search('tag-filter-search', '#filters label');
  const editor = search('editor-tag-search', '#editor-tags label');
  const manager = search('tag-manager-search', '#tag-manager-rows > div');
  const confirm = doc.getElementById('confirmation') as HTMLDialogElement;
  const cancel = (event: Event) => { event.preventDefault(); doc.getElementById('confirm-no')?.click(); };
  confirm?.addEventListener('cancel', cancel);
  const update = () => {
    filters?.(); editor?.(); manager?.();
    const cloud = doc.querySelector('.memo-product')?.getAttribute('data-source') === 'cloud';
    const editing = cloud ? doc.getElementById('product-cloud-editor') : doc.getElementById('editor-view');
    const viewing = cloud ? doc.querySelector('[data-view="detail"]') : doc.getElementById('detail-view');
    const heading = doc.getElementById('page-title');
    const title = editing && !editing.hidden ? 'メモ編集' : viewing && !(viewing as HTMLElement).hidden ? 'メモ詳細' : 'メモ一覧';
    if (heading && heading.textContent !== title) heading.textContent = title;
    if (confirm && !confirm.hidden && !confirm.open && !doc.getElementById('memo-app')?.inert) openProductDialog(confirm);
    if (confirm?.hidden && confirm.open) confirm.close();
    const app = doc.getElementById('memo-app');
    if (app?.inert) for (const dialog of app.querySelectorAll<HTMLDialogElement>('dialog[open]')) dialog.close();
    const backup = doc.getElementById('backup-dialog') as HTMLDialogElement | null;
    const detail = doc.getElementById('detail-view');
    // 復元成功後の通常詳細遷移は既存controllerが決める。モーダルは表示だけを追従する。
    const returned = doc.querySelector<HTMLButtonElement>('#product-backup-slot button[data-return-preview]');
    let link = doc.getElementById('product-return-preview') as HTMLButtonElement | null;
    if (returned && detail && !detail.hidden) {
      if (!link) { backup?.close(); link = doc.createElement('button'); link.id = 'product-return-preview'; link.type = 'button'; link.textContent = 'バックアッププレビューに戻る'; detail.append(link); }
      link.onclick = () => { if (backup && returned.isConnected) { openProductDialog(backup); returned.click(); } };
    } else link?.remove();
  };
  // 既存renderが作るDOMの表示状態だけを追従し、Authやeditor世代を複製しない。
  const observer = new win.MutationObserver(update);
  const scope = doc.querySelector('.memo-product');
  if (scope) observer.observe(scope, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert'] });
  if (confirm) observer.observe(confirm, { attributes: true, attributeFilter: ['hidden'] });
  const cleanup = () => { observer.disconnect(); doc.removeEventListener('click', click); doc.removeEventListener('cancel', blockBusyClose, true); confirm?.removeEventListener('cancel', cancel); };
  win.addEventListener('pagehide', event => { if (!event.persisted) cleanup(); });
  update(); return cleanup;
}

import { createLocalDataStore } from './local-data-store';
import type { LocalLockManager } from './local-lock';

/** 既存loadだけを使う停止保守表示。書込・復元・移行の入口を公開しない。 */
export async function showProductMaintenance(doc: Document, storage: { getItem(key: string): string | null }, locks: LocalLockManager | undefined) {
  const result = await createLocalDataStore({ storage: { getItem: key => storage.getItem(key), setItem() { throw new Error('Maintenance writes forbidden'); } }, locks }).load();
  const status = doc.getElementById('product-status');
  if (status) status.textContent = result.kind === 'loaded'
    ? `保守版：書込停止。検証済みv${result.value.version} メモ${result.value.memos.length}件。新旧キーを保持し、通常利用は再開しないでください。`
    : '保守版：書込停止。保存先は空、要移行、pending、不正または読取不能です。自動修復・削除は行いません。';
}

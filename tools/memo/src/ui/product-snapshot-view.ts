import type { MemoData } from '../types';
import { uuidKey } from '../read-primitives';

/** C04検証済みの値だけを閲覧する。保存先・Auth・通信の状態は所有しない。 */
export function mountProductSnapshot(doc: Document, parent: HTMLElement) {
  const root = doc.createElement('section'); root.id = 'product-cloud-snapshot';
  root.setAttribute('aria-label', 'クラウドメモ（読取専用）'); root.hidden = true;
  parent.append(root);
  let active: { value: MemoData; valid: () => boolean; token: object } | null = null;
  let disposed = false;
  const clear = () => { active = null; root.replaceChildren(); root.hidden = true; };
  const current = (token: object) => {
    if (disposed || active?.token !== token) return null;
    try { if (active.valid()) return active.value; } catch { /* 元例外は表示しない。 */ }
    clear(); return null;
  };
  const text = (tag: 'h2' | 'p' | 'pre', value: string) => {
    const node = doc.createElement(tag); node.textContent = value; return node;
  };
  const button = (label: string, action: () => void) => {
    const node = doc.createElement('button'); node.type = 'button'; node.textContent = label;
    node.onclick = action; return node;
  };
  const detail = (index: number, token: object) => {
    const value = current(token), memo = value?.memos[index]; if (!value || !memo) return;
    const tags = value.memoTags.filter(row => uuidKey(row.memoId) === uuidKey(memo.id))
      .map(row => value.tags.find(tag => uuidKey(tag.id) === uuidKey(row.tagId))!.name);
    root.replaceChildren(text('h2', 'クラウドメモ詳細（読取専用）'), text('p', memo.title), text('pre', memo.body),
      text('p', memo.deletedAt ? 'ゴミ箱内のメモ（読取専用）' : '通常メモ（読取専用）'),
      text('p', tags.length ? `タグ：${tags.join('、')}` : 'タグなし'),
      button('クラウド一覧へ戻る', () => list(token)));
  };
  const list = (token: object) => {
    const value = current(token); if (!value) return;
    root.replaceChildren(text('h2', 'クラウドメモ一覧（読取専用）'));
    if (!value.memos.length) root.append(text('p', 'クラウドメモはありません。'));
    const rows = doc.createElement('ul');
    value.memos.forEach((memo, index) => {
      const row = doc.createElement('li');
      // IDは属性/URLへ出さず、現在表示だけに有効な添字で選択する。
      row.append(button(memo.title, () => detail(index, token))); rows.append(row);
    });
    root.append(rows); root.hidden = false;
  };
  return Object.freeze({
    show(value: MemoData, valid: () => boolean) {
      clear(); if (disposed) return;
      const token = {}; active = { value, valid, token }; list(token);
    },
    refresh() { if (active) current(active.token); },
    clear,
    dispose() { disposed = true; clear(); root.remove(); },
  });
}

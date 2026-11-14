import type { MemoData, Memo } from '../types';
import { uuidKey } from '../read-primitives';

/** C04検証済みの値だけを閲覧する。保存先・Auth・通信の状態は所有しない。 */
export function mountProductSnapshot(doc: Document, parent: HTMLElement,
  edit?: (memo: Memo, tagIds: string[], valid: () => boolean) => boolean,
  changeState?: (memo: Memo, action: 'trash' | 'restore', valid: () => boolean) => boolean,
  deletePermanently?: (memo: Memo, valid: () => boolean) => boolean) {
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
    if (edit && memo.deletedAt === null) root.append(button('このクラウドメモを編集', () => {
      const latest = current(token), selected = latest?.memos[index]; if (!latest || !selected) return;
      const tagIds = latest.memoTags.filter(row => uuidKey(row.memoId) === uuidKey(selected.id)).map(row => row.tagId);
      const valid = active!.valid;
      if (edit(selected, tagIds, valid)) clear();
    }));
    const action = memo.deletedAt === null ? 'trash' : 'restore';
    const label = action === 'trash' ? 'ゴミ箱へ移動' : '復元';
    if (changeState) {
      const start = button(label, () => {
        if (!root.contains(start) || !current(token)) return;
        const confirm = button(`確認して${label}`, () => {
          // 同じsnapshotでも、キャンセル/別詳細への移動で外れた確認は再利用しない。
          if (!root.contains(confirm)) return;
          const latest = current(token), selected = latest?.memos[index];
          if (!selected || (action === 'trash' ? selected.deletedAt !== null : selected.deletedAt === null)) return;
          const valid = active!.valid;
          if (changeState(selected, action, valid)) clear();
        });
        root.replaceChildren(text('p', `このメモを${label}しますか。`), confirm,
          button(action === 'trash' ? '移動をキャンセル' : '復元をキャンセル', () => detail(index, token)));
      });
      root.append(start);
    }
    if (deletePermanently && memo.deletedAt !== null) {
      const start = button('完全削除', () => {
        if (!root.contains(start) || !current(token)) return;
        const confirm = button('完全に削除', () => {
          if (!root.contains(confirm)) return;
          const selected = current(token)?.memos[index];
          if (!selected || selected.deletedAt === null) return;
          if (deletePermanently(selected, active!.valid)) clear();
        });
        root.replaceChildren(text('p', 'このメモを完全に削除します。元に戻せません。'), confirm,
          button('完全削除をキャンセル', () => detail(index, token)));
      });
      root.append(start);
    }
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

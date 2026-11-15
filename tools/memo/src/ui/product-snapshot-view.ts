import type { MemoData, Memo, Tag } from '../types';
import { uuidKey } from '../read-primitives';
import { queryMemos } from '../memo-query';
import { countTagUsage } from '../tag-usage';
import type { ListContext } from '../navigation-state';
import type { CloudTarget } from '../cloud-rpc-types';
import { openProductDialog } from './product-dialog';

/** C04検証済みの値だけを閲覧する。保存先・Auth・通信の状態は所有しない。 */
export function mountProductSnapshot(doc: Document, parent: HTMLElement,
  edit?: (memo: Memo, tagIds: string[], valid: () => boolean, tags: readonly Tag[]) => boolean,
  changeState?: (memo: Memo, action: 'pin' | 'unpin' | 'trash' | 'restore', valid: () => boolean) => boolean,
  deletePermanently?: (memo: Memo, valid: () => boolean) => boolean,
  emptyTrash?: (targets: readonly CloudTarget[], valid: () => boolean) => boolean,
  tagEditor?: { canStart: () => boolean; save: (tag: Tag | null, name: string, valid: () => boolean) => boolean; feedback?: HTMLElement },
  deleteTag?: (tag: Tag, valid: () => boolean) => boolean,
  duplicate?: (memo: Memo, tagIds: string[], valid: () => boolean, tags: readonly Tag[]) => boolean) {
  const root = doc.createElement('section'); root.id = 'product-cloud-snapshot';
  const productLayout = doc.documentElement.dataset.productLayout === 'review2';
  root.setAttribute('aria-label', 'クラウドメモ（読取専用）'); root.hidden = true;
  parent.append(root);
  let active: { value: MemoData; valid: () => boolean; token: object; view: 'normal' | 'trash'; normal: ListContext; trash: ListContext } | null = null;
  let disposed = false;
  const releaseTagFeedback = () => { if (tagEditor?.feedback && root.contains(tagEditor.feedback)) parent.append(tagEditor.feedback); };
  const clear = () => { releaseTagFeedback(); active = null; root.replaceChildren(); root.hidden = true; };
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
  const confirmView = (...nodes: HTMLElement[]) => {
    if (!productLayout) { root.replaceChildren(...nodes); return; }
    const dialog = doc.createElement('dialog'); dialog.className = 'product-dialog'; dialog.setAttribute('aria-label', 'クラウド操作の確認');
    dialog.append(...nodes); dialog.addEventListener('cancel', event => { event.preventDefault(); nodes[nodes.length - 1]?.click(); });
    root.replaceChildren(dialog); openProductDialog(dialog);
  };
  const detail = (id: string, token: object) => {
    const value = current(token), memo = value?.memos.find(row => uuidKey(row.id) === uuidKey(id)); if (!value || !memo) return;
    const tags = value.memoTags.filter(row => uuidKey(row.memoId) === uuidKey(memo.id))
      .map(row => value.tags.find(tag => uuidKey(tag.id) === uuidKey(row.tagId))!.name);
    releaseTagFeedback(); root.dataset.view = 'detail';
    root.replaceChildren(text('h2', 'クラウドメモ詳細（読取専用）'), text('p', memo.title), text('pre', memo.body),
      text('p', memo.deletedAt ? 'ゴミ箱内のメモ（読取専用）' : '通常メモ（読取専用）'),
      text('p', tags.length ? `タグ：${tags.join('、')}` : 'タグなし'),
      button('クラウド一覧へ戻る', () => list(token)));
    if (productLayout) {
      root.classList.add('memo-detail-layout');
      const ordered = active![active!.view].result.items.map(item => item.memo.id);
      const index = ordered.findIndex(value => uuidKey(value) === uuidKey(memo.id));
      const nav = doc.createElement('nav'); nav.className = 'detail-actions'; nav.setAttribute('aria-label', 'クラウドの前後移動');
      for (const [target, label] of [[ordered[index - 1], '前のメモ'], [ordered[index + 1], '次のメモ']] as const) {
        const move = button(label, () => { if (root.contains(move) && current(token) && target) detail(target, token); }); move.disabled = !target; nav.append(move);
      }
      root.prepend(nav);
    }
    if (edit && memo.deletedAt === null) root.append(button('このクラウドメモを編集', () => {
      const latest = current(token), selected = latest?.memos.find(row => uuidKey(row.id) === uuidKey(id)); if (!latest || !selected) return;
      const tagIds = latest.memoTags.filter(row => uuidKey(row.memoId) === uuidKey(selected.id)).map(row => row.tagId);
      const valid = active!.valid;
      if (edit(selected, tagIds, valid, latest.tags)) clear();
    }));
    const action = memo.deletedAt === null ? 'trash' : 'restore';
    const label = action === 'trash' ? 'ゴミ箱へ移動' : '復元';
    if (duplicate && memo.deletedAt === null) {
      const copy = button('このクラウドメモを複製', () => {
        if (!root.contains(copy)) return;
        const latest = current(token), selected = latest?.memos.find(row => uuidKey(row.id) === uuidKey(id));
        if (!latest || !selected || selected.deletedAt !== null || selected.revision !== memo.revision) return;
        const tagIds = latest.memoTags.filter(row => uuidKey(row.memoId) === uuidKey(selected.id)).map(row => row.tagId);
        if (duplicate(selected, tagIds, active!.valid, latest.tags)) clear();
      });
      root.append(copy);
    }
    if (changeState) {
      if (memo.deletedAt === null) {
        const pinAction = memo.pinnedAt === null ? 'pin' : 'unpin';
        const pin = button(pinAction === 'pin' ? 'ピン留め' : 'ピン留め解除', () => {
          if (!root.contains(pin)) return;
          const selected = current(token)?.memos.find(row => uuidKey(row.id) === uuidKey(id));
          if (!selected || selected.deletedAt !== null || uuidKey(selected.id) !== uuidKey(memo.id)
            || selected.revision !== memo.revision || selected.pinnedAt !== memo.pinnedAt) return;
          if (changeState(selected, pinAction, active!.valid)) clear();
        });
        root.append(pin);
      }
      const start = button(label, () => {
        if (!root.contains(start) || !current(token)) return;
        const confirm = button(`確認して${label}`, () => {
          // 同じsnapshotでも、キャンセル/別詳細への移動で外れた確認は再利用しない。
          if (!root.contains(confirm)) return;
          const latest = current(token), selected = latest?.memos.find(row => uuidKey(row.id) === uuidKey(id));
          if (!selected || (action === 'trash' ? selected.deletedAt !== null : selected.deletedAt === null)) return;
          const valid = active!.valid;
          if (changeState(selected, action, valid)) clear();
        });
        confirmView(text('p', `このメモを${label}しますか。`), confirm,
          button(action === 'trash' ? '移動をキャンセル' : '復元をキャンセル', () => detail(id, token)));
      });
      root.append(start);
    }
    if (deletePermanently && memo.deletedAt !== null) {
      const start = button('完全削除', () => {
        if (!root.contains(start) || !current(token)) return;
        const confirm = button('完全に削除', () => {
          if (!root.contains(confirm)) return;
          const selected = current(token)?.memos.find(row => uuidKey(row.id) === uuidKey(id));
          if (!selected || selected.deletedAt === null) return;
          if (deletePermanently(selected, active!.valid)) clear();
        });
        confirmView(text('p', 'このメモを完全に削除します。元に戻せません。'), confirm,
          button('完全削除をキャンセル', () => detail(id, token)));
      });
      root.append(start);
    }
  };
  const hasTag = (value: MemoData, tag: Tag) => value.tags.some(row => uuidKey(row.id) === uuidKey(tag.id) && row.revision === tag.revision && row.name === tag.name);
  const editTag = (tag: Tag | null, token: object) => {
    if (!current(token) || !tagEditor?.canStart()) return;
    const form = doc.createElement('form');
    const label = doc.createElement('label'); label.textContent = 'クラウドのタグ名';
    const input = doc.createElement('input'); input.type = 'text'; input.value = tag?.name ?? ''; label.append(input);
    const save = button(tag ? '変更' : '作成', () => submit());
    const submit = () => {
      if (!root.contains(form) || !tagEditor?.canStart()) return;
      const value = current(token); if (!value) return;
      if (tag && !hasTag(value, tag)) { clear(); return; }
      if (productLayout && tag && !doc.defaultView!.confirm(`タグ「${tag.name}」の名前を変更しますか？`)) return;
      if (tagEditor.save(tag, input.value, active!.valid)) clear();
    };
    form.onsubmit = event => { event.preventDefault(); submit(); };
    form.append(text('h2', tag ? 'クラウドタグの改名' : 'クラウドタグの作成'));
    if (tag) form.append(text('p', `現在のタグ名：${tag.name}`));
    form.append(label, save, button('タグ編集をキャンセル', () => list(token)));
    if (productLayout) {
      const dialog = doc.createElement('dialog'); dialog.className = 'product-dialog'; dialog.setAttribute('aria-label', 'クラウドタグの編集');
      dialog.append(form);
      // 既存の通知要素を移し、同じC04/入力検証メッセージをアクティブなmodal内で通知する。
      if (tagEditor.feedback) form.append(tagEditor.feedback);
      dialog.addEventListener('cancel', event => { event.preventDefault(); list(token); });
      root.replaceChildren(dialog); openProductDialog(dialog);
    } else root.replaceChildren(form);
    input.focus();
  };
  const list = (token: object) => {
    const value = current(token); if (!value) return;
    releaseTagFeedback();
    const view = active!.view;
    root.dataset.view = 'list'; root.classList.remove('memo-detail-layout');
    root.replaceChildren(text('h2', 'クラウドメモ一覧（読取専用）'));
    const rows = doc.createElement('ul'); rows.id = 'product-cloud-items'; rows.setAttribute('aria-label', 'クラウドの一覧結果');
    const context = () => active![view];
    const rememberScroll = () => { if (root.contains(rows) && current(token) && active!.view === view) active![view] = { ...context(), scrollTop: rows.scrollTop }; };
    const navigate = (next: 'normal' | 'trash') => {
      if (!current(token)) return;
      rememberScroll(); active!.view = next; list(token);
    };
    const normal = button('クラウド通常一覧', () => { if (root.contains(normal)) navigate('normal'); });
    const trash = button('クラウドゴミ箱', () => { if (root.contains(trash)) navigate('trash'); });
    normal.setAttribute('aria-pressed', String(view === 'normal')); trash.setAttribute('aria-pressed', String(view === 'trash')); root.append(normal, trash);
    if (productLayout) { normal.hidden = view === 'normal'; trash.hidden = view === 'trash'; }
    const count = text('p', ''); count.setAttribute('role', 'status');
    const renderRows = () => {
      if (!current(token)) return;
      const scroll = context().scrollTop;
      rows.replaceChildren();
      context().result.items.forEach(({ memo, tags }) => {
        const row = doc.createElement('li');
        // 検索結果の添字ではなく、現在snapshotのIDをclosureに結び付ける。DOMへIDを出さない。
        const open = button(memo.title, () => {
          if (!root.contains(open) || !current(token)) return;
          rememberScroll(); detail(memo.id, token);
        });
        row.append(open);
        if (productLayout) {
          open.className = 'open-card';
          const preview = text('p', memo.body); preview.className = 'card-preview';
          const meta = text('p', ''); meta.className = 'card-meta';
          const tagNames = doc.createElement('span'); tagNames.textContent = tags.map(tag => tag.name).join('・');
          const updated = doc.createElement('time'); updated.dateTime = memo.updatedAt; updated.textContent = `更新 ${new Date(memo.updatedAt).toLocaleString('ja-JP')}`; meta.append(tagNames, updated);
          const pin = doc.createElement('span'); pin.className = 'pin-indicator'; pin.textContent = memo.pinnedAt ? '📌' : ''; pin.setAttribute('aria-label', memo.pinnedAt ? 'ピン留め済み' : 'ピン留めなし');
          const menu = doc.createElement('details'), summary = doc.createElement('summary'); summary.textContent = '︙ 操作'; menu.append(summary);
          // 既存詳細の操作入口へ委譲し、確認・要求固定・currentnessを複製しない。
          const action = (label: string, existing: string) => {
            const item = button(label, () => {
              if (!root.contains(item) || !current(token)) return;
              rememberScroll(); detail(memo.id, token);
              Array.from(root.querySelectorAll('button')).find(node => node.textContent === existing)?.click();
            }); menu.append(item);
          };
          if (memo.deletedAt === null) {
            if (changeState) action(memo.pinnedAt ? 'ピン留め解除' : 'ピン留め', memo.pinnedAt ? 'ピン留め解除' : 'ピン留め');
            if (duplicate) action('複製', 'このクラウドメモを複製');
            if (changeState) action('ゴミ箱へ', 'ゴミ箱へ移動');
          } else { if (changeState) action('復元', '復元'); if (deletePermanently) action('完全削除', '完全削除'); }
          row.append(preview, meta, pin, menu);
        }
        rows.append(row);
      });
      count.textContent = `${view === 'normal' ? '通常メモ' : 'ゴミ箱'}：${context().result.resultCount}件`;
      rows.scrollTop = scroll;
    };
    const usage = new Map(countTagUsage(value).map(row => [uuidKey(row.tagId), row.count]));
    let tagHeading: HTMLElement | undefined;
    if (view === 'normal') {
      const controls = doc.createElement('div');
      if (productLayout) controls.className = 'cloud-list-controls';
      const searchLabel = doc.createElement('label'); searchLabel.textContent = 'クラウドの検索';
      const search = doc.createElement('input'); search.type = 'search'; search.value = context().result.query.text; searchLabel.append(search);
      const sortLabel = doc.createElement('label'); sortLabel.textContent = 'クラウドの並び順';
      const sort = doc.createElement('select'); sort.setAttribute('aria-label', 'クラウドの並び順');
      for (const [key, label] of [['updated-desc', '更新が新しい順'], ['updated-asc', '更新が古い順'], ['created-desc', '作成が新しい順'], ['created-asc', '作成が古い順']]) {
        const option = doc.createElement('option'); option.value = key!; option.textContent = label!; sort.append(option);
      }
      sort.value = context().result.query.sort; sortLabel.append(sort);
      const filters = doc.createElement('fieldset'), legend = doc.createElement('legend'); legend.textContent = 'クラウドのタグ絞込（OR）'; filters.append(legend);
      const chips = productLayout ? doc.createElement('div') : filters;
      if (productLayout) { chips.className = 'tag-chips'; filters.append(chips); }
      const inputs: { id: string; node: HTMLInputElement }[] = [];
      const query = (ids?: string[]) => {
        if (!root.contains(controls) || !current(token)) return;
        try { active!.normal = { result: queryMemos(value, { view: 'normal', text: search.value, selectedTagIds: ids ?? context().result.query.selectedTagIds, sort: sort.value }), scrollTop: rows.scrollTop }; }
        catch { count.textContent = '一覧条件を確認できません。条件を再選択してください。'; return; }
        inputs.forEach(({ id, node }) => { node.checked = context().result.query.selectedTagIds.some(selected => uuidKey(selected) === uuidKey(id)); });
        renderRows();
      };
      value.tags.forEach(tag => {
        const label = doc.createElement('label'), node = doc.createElement('input'); node.type = 'checkbox';
        node.setAttribute('aria-label', `クラウド絞込タグ：${tag.name}`);
        node.checked = context().result.query.selectedTagIds.some(id => uuidKey(id) === uuidKey(tag.id));
        node.onchange = () => {
          if (!root.contains(node) || !current(token)) return;
          const ids = context().result.query.selectedTagIds.filter(id => uuidKey(id) !== uuidKey(tag.id));
          if (node.checked) ids.push(tag.id); query(ids);
        };
        label.append(node, `${tag.name}（使用 ${usage.get(uuidKey(tag.id)) ?? 0}件）`); chips.append(label); inputs.push({ id: tag.id, node });
      });
      const reset = button('クラウドのタグ絞込を解除', () => { if (root.contains(reset)) query([]); });
      search.oninput = () => query(); sort.onchange = () => query();
      if (productLayout) {
        controls.className = 'list-controls'; search.placeholder = 'タイトル・本文・タグ名で検索…';
        const toolbar = doc.createElement('div'); toolbar.className = 'list-toolbar'; toolbar.append(searchLabel, normal, trash);
        const options = doc.createElement('div'); options.className = 'list-options';
        const tags = doc.createElement('div'); tags.className = 'tag-controls';
        tagHeading = doc.createElement('div'); tagHeading.className = 'section-heading'; tagHeading.append(text('h2', 'タグで絞り込み'));
        filters.className = 'cloud-filter-wrap'; legend.className = 'visually-hidden';
        const tagSearch = doc.createElement('input'); tagSearch.type = 'search'; tagSearch.placeholder = 'タグを検索…'; tagSearch.setAttribute('aria-label', 'クラウドのタグを検索');
        tagSearch.oninput = () => Array.from(filters.querySelectorAll('label')).forEach(label => { label.hidden = !(label.textContent ?? '').toLocaleLowerCase().includes(tagSearch.value.toLocaleLowerCase()); });
        const row = doc.createElement('div'); row.className = 'tag-search-row'; row.append(tagSearch, reset);
        tags.append(tagHeading, row, filters); sortLabel.className = 'sort-control'; searchLabel.className = 'memo-search';
        options.append(tags, sortLabel); controls.append(toolbar, options);
      } else controls.append(searchLabel, sortLabel, filters, reset);
      root.append(controls);
    }
    root.append(count, rows); root.hidden = false;
    renderRows(); rows.onscroll = rememberScroll;
    if (tagEditor || deleteTag) {
      const manager = doc.createElement('div');
      if (tagEditor) {
        const create = button('タグを作成', () => { if (root.contains(create)) editTag(null, token); });
        manager.append(create);
      }
      const tags = doc.createElement('ul'); tags.setAttribute('aria-label', 'クラウドタグ一覧');
      if (productLayout) tags.className = 'cloud-tag-rows';
      value.tags.forEach(tag => {
        const row = doc.createElement('li'); row.append(text('p', tag.name), text('p', `使用 ${usage.get(uuidKey(tag.id)) ?? 0}件`));
        if (tagEditor) {
          const rename = button('名前を変更', () => { if (root.contains(rename)) editTag(tag, token); });
          row.append(rename);
        }
        if (deleteTag) {
          const remove = button('削除', () => {
            if (!root.contains(remove) || !current(token)) return;
            const confirm = button('削除する', () => {
              if (!root.contains(confirm)) return;
              const latest = current(token); if (!latest) return;
              if (!hasTag(latest, tag)) { clear(); return; }
              if (deleteTag(tag, active!.valid)) clear();
            });
            confirmView(text('p', `タグ『${tag.name}』を削除します。`),
              text('p', 'メモとの関連も解除されます。メモ自体は削除しません。'), confirm,
              button('タグ削除をキャンセル', () => list(token)));
          });
          row.append(remove);
        }
        tags.append(row);
      });
      manager.append(tags);
      if (productLayout) {
        const dialog = doc.createElement('dialog'); dialog.className = 'product-dialog'; dialog.setAttribute('aria-label', 'クラウドタグ管理');
        const search = doc.createElement('input'); search.type = 'search'; search.placeholder = 'タグを検索…'; search.setAttribute('aria-label', '管理するクラウドタグを検索');
        search.oninput = () => Array.from(tags.children).forEach(row => { (row as HTMLElement).hidden = !(row.textContent ?? '').toLocaleLowerCase().includes(search.value.toLocaleLowerCase()); });
        dialog.append(text('h2', 'タグ管理'), search, manager, button('閉じる', () => dialog.close()));
        const open = button('タグ管理', () => { if (root.contains(open) && current(token)) openProductDialog(dialog); });
        if (tagHeading) tagHeading.append(open); else root.append(open);
        root.append(dialog);
      } else root.append(manager);
    }
    if (emptyTrash) {
      const targets = Object.freeze(value.memos.filter(memo => memo.deletedAt !== null)
        .map(memo => Object.freeze({ id: memo.id, revision: memo.revision })));
      if (!targets.length) { root.append(text('p', 'ゴミ箱は空です。')); return; }
      const start = button('ゴミ箱を空にする', () => {
        if (!root.contains(start) || !current(token)) return;
        const confirm = button('すべて完全に削除', () => {
          if (!root.contains(confirm)) return;
          const latest = current(token); if (!latest) return;
          const now = latest.memos.filter(memo => memo.deletedAt !== null);
          if (now.length !== targets.length || !targets.every((row, index) =>
            uuidKey(row.id) === uuidKey(now[index]!.id) && row.revision === now[index]!.revision)) { clear(); return; }
          if (emptyTrash(targets, active!.valid)) clear();
        });
        confirmView(text('p', `ゴミ箱内のメモ${targets.length}件を完全に削除します。元に戻せません。`), confirm,
          button('一括削除をキャンセル', () => list(token)));
      });
      root.append(start);
    }
  };
  return Object.freeze({
    tagChoices() {
      if (!active) return null;
      const value = current(active.token); return value && active ? { tags: value.tags, valid: active.valid } : null;
    },
    show(value: MemoData, valid: () => boolean) {
      clear(); if (disposed) return;
      const token = {}; active = { value, valid, token, view: 'normal', normal: { result: queryMemos(value), scrollTop: 0 },
        trash: { result: queryMemos(value, { view: 'trash' }), scrollTop: 0 } }; list(token);
    },
    refresh() { if (active) current(active.token); },
    clear,
    dispose() { disposed = true; clear(); root.remove(); },
  });
}

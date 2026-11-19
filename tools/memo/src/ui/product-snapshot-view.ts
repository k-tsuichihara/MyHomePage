import type { MemoData, Memo, Tag } from '../types';
import { uuidKey } from '../read-primitives';
import { queryMemos } from '../memo-query';
import { countTagUsage } from '../tag-usage';
import type { ListContext } from '../navigation-state';
import type { CloudTarget } from '../cloud-rpc-types';
import { openProductDialog, setPcButtonLabel } from './product-dialog';
import { mountTagManagerView } from './tag-manager-view';

/** C04検証済みの値だけを閲覧する。保存先・Auth・通信の状態は所有しない。 */
export function mountProductSnapshot(doc: Document, parent: HTMLElement,
  edit?: (memo: Memo, tagIds: string[], valid: () => boolean, tags: readonly Tag[], context: ListContext) => boolean,
  changeState?: (memo: Memo, action: 'pin' | 'unpin' | 'trash' | 'restore', valid: () => boolean) => boolean,
  deletePermanently?: (memo: Memo, valid: () => boolean) => boolean,
  emptyTrash?: (targets: readonly CloudTarget[], valid: () => boolean) => boolean,
  tagEditor?: { canStart: () => boolean; save: (tag: Tag | null, name: string, valid: () => boolean) => boolean; feedback?: HTMLElement },
  deleteTag?: (tag: Tag, valid: () => boolean) => boolean,
  duplicate?: (memo: Memo, tagIds: string[], valid: () => boolean, tags: readonly Tag[], context: ListContext) => boolean) {
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
    // 入力検証でmodal内へ移した共有通知を、確認画面のDOM置換に巻き込まない。
    releaseTagFeedback();
    if (!productLayout) { root.replaceChildren(...nodes); return; }
    const dialog = doc.createElement('dialog'); dialog.className = 'product-dialog'; dialog.setAttribute('aria-label', 'クラウド操作の確認');
    dialog.append(...nodes); dialog.addEventListener('cancel', event => { event.preventDefault(); nodes[nodes.length - 1]?.click(); });
    root.replaceChildren(dialog); openProductDialog(dialog);
  };
  const editMemo = (id: string, token: object) => {
    const latest = current(token), selected = latest?.memos.find(row => uuidKey(row.id) === uuidKey(id));
    if (!edit || !latest || !selected || selected.deletedAt !== null) return;
    const tagIds = latest.memoTags.filter(row => uuidKey(row.memoId) === uuidKey(selected.id)).map(row => row.tagId);
    if (edit(selected, tagIds, active!.valid, latest.tags, active![active!.view])) clear();
  };
  const detail = (id: string, token: object) => {
    const value = current(token), memo = value?.memos.find(row => uuidKey(row.id) === uuidKey(id)); if (!value || !memo) return;
    if (edit && memo.deletedAt === null) { editMemo(id, token); return; }
    const tags = value.memoTags.filter(row => uuidKey(row.memoId) === uuidKey(memo.id))
      .map(row => value.tags.find(tag => uuidKey(tag.id) === uuidKey(row.tagId))!.name);
    releaseTagFeedback(); root.dataset.view = 'detail';
    root.replaceChildren(text('h2', 'クラウドメモ詳細（読取専用）'), text('p', memo.title), text('pre', memo.body),
      text('p', memo.deletedAt ? 'ゴミ箱内のメモ（読取専用）' : '通常メモ（読取専用）'),
      text('p', tags.length ? `タグ：${tags.join('、')}` : 'タグなし'),
      button('クラウド一覧へ戻る', () => list(token)));
    if (productLayout) {
      root.classList.add('memo-detail-layout');
      const back = root.querySelector('button')!; setPcButtonLabel(doc, back, '< 一覧へ');
      const ordered = active![active!.view].result.items.map(item => item.memo.id);
      const index = ordered.findIndex(value => uuidKey(value) === uuidKey(memo.id));
      const nav = doc.createElement('nav'); nav.className = 'detail-actions pc-cloud-detail-nav'; nav.setAttribute('aria-label', 'クラウドの前後移動');
      for (const [target, label] of [[ordered[index - 1], '前のメモ'], [ordered[index + 1], '次のメモ']] as const) {
        const move = button(label, () => { if (root.contains(move) && current(token) && target) detail(target, token); }); move.disabled = !target;
        setPcButtonLabel(doc, move, label === '前のメモ' ? '〈 前のメモ' : '次のメモ 〉'); nav.append(move);
      }
      root.prepend(nav);
    }
    root.append(...memoActions(memo, token));
  };
  const memoActions = (memo: Memo, token: object) => {
    const id = memo.id, actions: HTMLButtonElement[] = [];
    const action = memo.deletedAt === null ? 'trash' : 'restore';
    const label = action === 'trash' ? 'ゴミ箱へ移動' : '復元';
    if (duplicate && memo.deletedAt === null) {
      const copy = button('このクラウドメモを複製', () => {
        if (!root.contains(copy)) return;
        const latest = current(token), selected = latest?.memos.find(row => uuidKey(row.id) === uuidKey(id));
        if (!latest || !selected || selected.deletedAt !== null || selected.revision !== memo.revision) return;
        const tagIds = latest.memoTags.filter(row => uuidKey(row.memoId) === uuidKey(selected.id)).map(row => row.tagId);
        if (duplicate(selected, tagIds, active!.valid, latest.tags, active![active!.view])) clear();
      });
      if (productLayout) { copy.classList.add('pc-cloud-duplicate'); copy.textContent = '複製'; }
      actions.push(copy);
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
        actions.push(pin);
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
          button(action === 'trash' ? '移動をキャンセル' : '復元をキャンセル', () => memo.deletedAt === null && (productLayout || edit) ? list(token) : detail(id, token)));
      });
      actions.push(start);
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
          button('完全削除をキャンセル', () => memo.deletedAt === null && productLayout ? list(token) : detail(id, token)));
      });
      actions.push(start);
    }
    return actions;
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
    normal.setAttribute('aria-pressed', String(view === 'normal')); trash.setAttribute('aria-pressed', String(view === 'trash'));
    if (productLayout) {
      normal.hidden = view === 'normal'; trash.hidden = view === 'trash';
      normal.className = 'cloud-normal-toggle'; trash.className = 'cloud-trash-toggle';
      const operations = doc.createElement('div'); operations.className = 'cloud-operation-group'; operations.setAttribute('role', 'group'); operations.setAttribute('aria-label', 'クラウド一覧の切替');
      operations.append(normal, trash); root.append(operations);
    } else root.append(normal, trash);
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
          rememberScroll();
          if (edit && memo.deletedAt === null) editMemo(memo.id, token);
          else detail(memo.id, token);
        });
        row.append(open);
        if (!productLayout && edit) row.append(...memoActions(memo, token));
        if (productLayout) {
          open.className = 'open-card';
          open.setAttribute('aria-label', memo.title);
          const caption = doc.createElement('span'); caption.className = 'card-title'; caption.textContent = memo.title; open.replaceChildren(caption);
          const preview = doc.createElement('span'); preview.textContent = memo.body; preview.className = 'card-preview';
          const meta = doc.createElement('span'); meta.className = 'card-meta';
          const tagNames = doc.createElement('span'); tagNames.textContent = tags.map(tag => tag.name).join('・');
          const updated = doc.createElement('time'); updated.dateTime = memo.updatedAt; updated.textContent = `更新：${new Date(memo.updatedAt).toLocaleString('ja-JP')}`; meta.append(tagNames, updated);
          const pin = doc.createElement('span'); pin.className = 'pin-indicator'; pin.textContent = memo.pinnedAt ? '📌' : ''; pin.setAttribute('aria-label', memo.pinnedAt ? 'ピン留め済み' : 'ピン留めなし');
          const menu = doc.createElement('details'), summary = doc.createElement('summary'); summary.textContent = '︙'; summary.setAttribute('aria-label', 'メモの操作'); menu.append(summary);
          const options = doc.createElement('div'); options.className = 'card-menu-items'; menu.append(options);
          // 一覧から正式handlerを直接使用し、通常詳細の中継画面を作らない。
          options.append(...memoActions(memo, token));

          open.append(preview, meta); row.append(pin, menu);
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
        reset.setAttribute('aria-label', 'クラウドのタグ絞込を解除');
        const desktopReset = doc.createElement('span'); desktopReset.className = 'desktop-reset-label'; desktopReset.textContent = reset.textContent;
        const mobileReset = doc.createElement('span'); mobileReset.className = 'mobile-reset-label'; mobileReset.textContent = '絞込解除'; reset.replaceChildren(desktopReset, mobileReset);
        controls.className = 'list-controls'; search.placeholder = 'タイトル・本文・タグ名で検索…';
        const caption = doc.createElement('span'); caption.className = 'sort-caption pc-sort-caption'; caption.textContent = '並び替え';
        const mobileCaption = doc.createElement('span'); mobileCaption.className = 'mobile-sort-caption'; mobileCaption.textContent = 'クラウドの並び順';
        sortLabel.firstChild?.remove(); sortLabel.prepend(caption, mobileCaption);
        const toolbar = doc.createElement('div'); toolbar.className = 'list-toolbar'; toolbar.append(searchLabel);
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
      if (!productLayout) {
        const manager = doc.createElement('div');
        if (tagEditor) {
          const create = button('タグを作成', () => { if (root.contains(create)) editTag(null, token); });
          manager.append(create);
        }
        const tags = doc.createElement('ul'); tags.setAttribute('aria-label', 'クラウドタグ一覧');
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
        root.append(manager);
      }
      if (productLayout) {
        const dialog = doc.createElement('dialog'); dialog.className = 'product-dialog'; dialog.setAttribute('aria-label', 'クラウドタグ管理');
        const heading = doc.createElement('div'); heading.className = 'dialog-heading';
        const close = button('×', () => dialog.close()); close.setAttribute('aria-label', 'タグ管理を閉じる'); heading.append(text('h2', 'タグ管理'), close);
        const content = doc.createElement('div'); dialog.append(heading, content);
        const canStart = () => !!current(token) && (!tagEditor || tagEditor.canStart());
        const managerView = mountTagManagerView(doc, content, {
          canStart,
          save: tagEditor ? (tag, name) => {
            if (!current(token) || !tagEditor?.canStart() || (tag && !hasTag(value, tag))) return false;
            if (tag && !doc.defaultView!.confirm(`タグ「${tag.name}」の名前を変更しますか？`)) return false;
            // 入力検証の通知は既存と同じ要素。送信開始後は既存hostがsnapshotを失効させる。
            if (tagEditor.feedback) content.append(tagEditor.feedback);
            if (tagEditor.save(tag, name, active!.valid)) clear();
            return false;
          } : undefined,
          remove: deleteTag ? tag => {
            if (!current(token) || (tagEditor && !tagEditor.canStart()) || !hasTag(value, tag)) return;
            // 既存の単件削除確認を利用し、対象ID/name/revisionを固定する。
            const confirm = button('削除する', () => {
              if (!root.contains(confirm)) return;
              const latest = current(token); if (!latest || !hasTag(latest, tag)) return;
              if (deleteTag(tag, active!.valid)) clear();
            });
            confirmView(text('p', `タグ『${tag.name}』を削除します。`),
              text('p', 'メモとの関連も解除されます。メモ自体は削除しません。'), confirm,
              button('タグ削除をキャンセル', () => list(token)));
          } : undefined,
        });
        const counts = new Map(value.tags.map(tag => [tag.id, usage.get(uuidKey(tag.id)) ?? 0]));
        managerView.update(value.tags, counts, false);
        const open = button('タグ管理', () => {
          if (root.contains(open) && canStart()) { managerView.update(value.tags, counts, false); openProductDialog(dialog); }
        });
        if (tagHeading) tagHeading.append(open); else root.append(open);
        root.append(dialog);
      }
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
      const value = current(active.token); return value && active ? { tags: value.tags, valid: active.valid, context: active.normal } : null;
    },
    show(value: MemoData, valid: () => boolean, context?: ListContext | null) {
      clear(); if (disposed) return;
      // 通常一覧へ復帰する。ゴミ箱のqueryを通常一覧へ持ち込まない。
      const normal = context?.result.query.view === 'normal' ? context : null;
      const token = {}; active = { value, valid, token, view: 'normal', normal: { result: queryMemos(value, normal?.result.query), scrollTop: normal?.scrollTop ?? 0 },
        trash: { result: queryMemos(value, { view: 'trash' }), scrollTop: 0 } }; list(token);
    },
    refresh() { if (active) current(active.token); },
    clear,
    dispose() { disposed = true; clear(); root.remove(); },
  });
}

import type { createLocalMemoController } from '../local-memo-controller';
import type { ControllerCommand } from '../local-app-state';
import { isDirty } from '../editor-state';

type Controller = ReturnType<typeof createLocalMemoController>;
const messages: Record<string, string> = {
  'invalid-input': '入力を確認してください。タイトル100・本文10000コードポイントが上限です。',
  conflict: '競合しました。入力を保持したまま再確認してください。',
  'duplicate-tag': '同じ名前のタグがあります。', 'stale-confirmation': '確認後に状態が変わりました。再確認してください。',
  'not-ready': '読込が完了していないため操作できません。', writing: '保存処理中です。',
  'editor-active': 'タグ管理・状態操作は編集を終了してから行ってください。',
};

/**
 * 検証用DOMと既存controllerだけを接続する。保存先や永続APIへはアクセスしない。
 * 入力欄は一度だけ作り、非同期結果の描画でもIME・選択範囲を壊さない。
 */
export function mountMemoPreview(doc: Document, controller: Controller): () => void {
  const win = doc.defaultView!;
  const element = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const title = element<HTMLInputElement>('memo-title'), body = element<HTMLTextAreaElement>('memo-body');
  const search = element<HTMLInputElement>('search'), sort = element<HTMLSelectElement>('sort');
  const cards = element<HTMLUListElement>('cards');
  let composing = false, lastGeneration = -1, lastRoute = '', lastSession = '';
  let listSignature = '', filterSignature = '', editorTagSignature = '', managerSignature = '';
  let feedback = '', displayedToken: number | null = null, frame = 0, stopped = false;
  const text = (id: string, value: string) => { element(id).textContent = value; };
  const button = (label: string, action: () => void, disabled = false) => {
    const node = doc.createElement('button'); node.type = 'button'; node.textContent = label;
    node.disabled = disabled; node.addEventListener('click', action); return node;
  };
  const send = async (command: ControllerCommand) => {
    if (composing && command.kind !== 'draft') return;
    feedback = '';
    const pending = controller.dispatch(command);
    render();
    const result = await pending;
    if (result.kind === 'blocked' && result.reason !== 'writing') feedback = messages[result.reason] ?? `操作を停止しました（${result.reason}）。`;
    render();
  };
  const selected = (id: string) => Array.from(element(id).querySelectorAll<HTMLInputElement>('input:checked')).map(node => node.value);
  const query = () => send({ kind: 'query', options: { ...controller.getState().list?.result.query,
    text: search.value, sort: sort.value, selectedTagIds: selected('filters') }, scrollTop: cards.scrollTop });
  const updateDraft = () => send({ kind: 'draft', value: { title: title.value, body: body.value, tagIds: selected('editor-tags') } });
  const bind = (id: string, action: () => void) => element(id).addEventListener('click', action);
  bind('new', () => { void send({ kind: 'new' }); });
  bind('back', () => { void send({ kind: 'list' }); });
  bind('reload', () => { void send({ kind: 'load' }); });
  bind('previous', () => { void send({ kind: 'adjacent', direction: 'previous' }); });
  bind('next', () => { void send({ kind: 'adjacent', direction: 'next' }); });
  bind('edit', () => { const state = controller.getState(); if (state.route.kind === 'detail') void send({ kind: 'edit', id: state.route.id }); });
  for (const [id, view] of [['trash-view', 'trash'], ['normal-view', 'normal']] as const) bind(id, () => {
    void send({ kind: 'query', options: { ...controller.getState().list?.result.query, view }, scrollTop: 0 });
  });
  for (const [id, accepted] of [['confirm-yes', true], ['confirm-no', false]] as const) bind(id, () => {
    // 表示時のtokenだけを送る。編集で失効した確認を最新tokenへ勝手に差し替えない。
    if (displayedToken !== null) void send({ kind: 'confirm', token: displayedToken, accepted });
  });
  element('memo-form').addEventListener('submit', event => {
    event.preventDefault(); if (!composing) void send({ kind: 'save' });
  });
  search.addEventListener('input', () => { if (!composing) void query(); }); sort.addEventListener('change', () => { void query(); });
  for (const input of [title, body]) input.addEventListener('input', () => { if (!composing) void updateDraft(); });
  // 合成イベントだけで実IMEの全挙動を保証しないが、変換中の入力・DOMを置換しない契約を守る。
  doc.addEventListener('compositionstart', () => { composing = true; render(); });
  doc.addEventListener('compositionend', event => {
    composing = false;
    if (event.target === search) void query();
    else if (event.target === title || event.target === body) void updateDraft();
    else render();
  });
  let scrollFrame = 0;
  cards.addEventListener('scroll', () => {
    win.cancelAnimationFrame(scrollFrame);
    scrollFrame = win.requestAnimationFrame(() => {
      const state = controller.getState();
      if (state.route.kind === 'list' && state.read.kind === 'ready' && cards.scrollTop !== state.list?.scrollTop) void query();
    });
  });
  const managed = element<HTMLSelectElement>('managed-tag'), tagName = element<HTMLInputElement>('tag-name');
  managed.addEventListener('change', () => { tagName.value = controller.getState().data?.tags.find(tag => tag.id === managed.value)?.name ?? ''; });
  element('tag-form').addEventListener('submit', event => {
    event.preventDefault(); const state = controller.getState(), tag = state.data?.tags.find(row => row.id === managed.value);
    void send({ kind: 'mutate', operation: { kind: 'save-tag', id: tag?.id ?? win.crypto.randomUUID(), name: tagName.value, expectedRevision: tag?.revision ?? null } });
  });
  bind('tag-delete', () => {
    const tag = controller.getState().data?.tags.find(row => row.id === managed.value);
    if (tag) void send({ kind: 'mutate', operation: { kind: 'delete-tag', id: tag.id, expectedRevision: tag.revision } });
  });

  function render() {
    const state = controller.getState(), busy = state.write.kind === 'writing', ready = state.read.kind === 'ready';
    text('save-status', state.write.kind === 'writing' ? '保存処理中：追加入力は保持します。'
      : state.write.kind === 'succeeded' ? '送信した内容の保存は成功しました。'
      : state.write.kind === 'unknown' ? '保存結果は不明です。自動再送しません。'
      : state.write.kind === 'rejected' ? `保存・操作は拒否されました。${messages[state.write.reason] ?? state.write.reason}` : 'まだ保存操作は行っていません。');
    text('read-status', state.read.kind === 'loading' ? '一覧を再読込中です。'
      : state.read.kind === 'failed' ? '一覧の再読込に失敗しました。以前の表示は最新とは限りません。' : ready ? '一覧の読込が完了しました。' : '読込前です。');
    text('draft-status', state.editor ? isDirty(state.editor) ? '未保存の追加編集があります。' : '現在のドラフトに未保存の変更はありません。' : '');
    text('error', feedback || (state.editorIssue ? `編集中データの不整合：${state.editorIssue}。入力は保持しています。` : ''));
    for (const id of ['new', 'back', 'edit', 'previous', 'next', 'tag-save', 'tag-delete']) {
      element<HTMLButtonElement>(id).disabled = busy || !ready || composing;
    }
    element<HTMLButtonElement>('reload').disabled = busy || composing;
    element<HTMLButtonElement>('save').disabled = busy || !ready || composing;
    if (!composing) {
      text('page-title', state.route.kind === 'list' ? 'メモ一覧' : state.route.kind === 'edit' ? 'メモ編集' : 'メモ詳細');
      element('list-view').hidden = state.route.kind !== 'list'; element('detail-view').hidden = state.route.kind !== 'detail';
      element('editor-view').hidden = state.route.kind !== 'edit';
      if (state.route.kind === 'edit' && state.editor) {
        for (const [input, value] of [[title, state.editor.draft.title], [body, state.editor.draft.body]] as const) {
          if (input.value !== value && doc.activeElement !== input) input.value = value;
        }
        text('lengths', `タイトル ${Array.from(title.value).length}/100・本文 ${Array.from(body.value).length}/10000 コードポイント`);
        const signature = JSON.stringify([state.data?.tags, state.editor.draft.tagIds]);
        if (signature !== editorTagSignature) {
          editorTagSignature = signature; const fragment = doc.createDocumentFragment();
          for (const tag of state.data?.tags ?? []) {
            const label = doc.createElement('label'), input = doc.createElement('input'); input.type = 'checkbox'; input.value = tag.id;
            input.checked = state.editor.draft.tagIds.includes(tag.id); input.addEventListener('change', () => { void updateDraft(); });
            label.append(input, tag.name); fragment.append(label);
          }
          element('editor-tags').replaceChildren(fragment);
        }
        if (lastSession !== state.editor.sessionId) { lastSession = state.editor.sessionId; title.focus(); }
      }
    }
    const routeKey = JSON.stringify(state.route);
    if (routeKey !== lastRoute && state.route.kind === 'list') cards.scrollTop = state.list?.scrollTop ?? 0;
    lastRoute = routeKey;
    if (state.route.kind === 'detail') {
      const id = state.route.id;
      const memo = state.data?.memos.find(row => row.id === id);
      text('detail-title', memo?.title ?? '対象のメモはありません。'); text('detail-body', memo?.body ?? '');
      text('detail-tags', state.data?.memoTags.filter(row => row.memoId === memo?.id).map(row => state.data?.tags.find(tag => tag.id === row.tagId)?.name ?? '').join('・') ?? '');
      element<HTMLButtonElement>('edit').disabled ||= memo?.deletedAt !== null;
    }
    if (!composing && doc.activeElement !== search && search.value !== state.list?.result.query.text) search.value = state.list?.result.query.text ?? '';
    sort.value = state.list?.result.query.sort ?? 'updated-desc';
    const filterKey = JSON.stringify([state.data?.tags, state.usage, state.list?.result.query.selectedTagIds]);
    if (filterKey !== filterSignature) {
      filterSignature = filterKey; const fragment = doc.createDocumentFragment();
      for (const tag of state.data?.tags ?? []) {
        const label = doc.createElement('label'), input = doc.createElement('input'); input.type = 'checkbox'; input.value = tag.id;
        input.checked = state.list?.result.query.selectedTagIds.includes(tag.id) ?? false;
        input.addEventListener('change', () => { void query(); });
        label.append(input, `${tag.name}（使用 ${state.usage.find(row => row.tagId === tag.id)?.count ?? 0}件）`); fragment.append(label);
      }
      element('filters').replaceChildren(fragment);
    }
    text('missing-tags', state.list?.result.missingSelectedTagIds.length ? '選択中のタグが削除されています。選択は自動解除しません。' : '');
    text('count', `${state.list?.result.query.view === 'trash' ? 'ゴミ箱' : '通常メモ'}：検索結果 ${state.list?.result.resultCount ?? 0}件`);
    const listKey = JSON.stringify([state.list?.result.items, busy, ready]);
    if (listKey !== listSignature) {
      listSignature = listKey; const scroll = cards.scrollTop, fragment = doc.createDocumentFragment();
      for (const { memo, tags } of state.list?.result.items ?? []) {
        const row = doc.createElement('li'); row.dataset.id = memo.id; row.dataset.revision = String(memo.revision);
        const open = button(`${memo.pinnedAt ? '📌 ' : ''}${memo.title}`, () => { void send({ kind: 'detail', id: memo.id }); }, busy || !ready);
        open.className = 'open-card'; const preview = doc.createElement('p'); preview.textContent = Array.from(memo.body).slice(0, 80).join('');
        const metadata = doc.createElement('p'); metadata.textContent = `${tags.map(tag => tag.name).join('・')} 更新 ${memo.updatedAt}`;
        const menu = doc.createElement('details'), summary = doc.createElement('summary'); summary.textContent = '︙ 操作'; menu.append(summary);
        const action = (name: string, value: 'pin' | 'unpin' | 'trash' | 'restore') => button(name, () => {
          void send({ kind: 'mutate', operation: { kind: 'state', id: memo.id, action: value, expectedRevision: memo.revision } });
        }, busy || !ready);
        if (memo.deletedAt === null) menu.append(action(memo.pinnedAt ? 'ピン解除' : 'ピン留め', memo.pinnedAt ? 'unpin' : 'pin'), action('ゴミ箱へ', 'trash'));
        else menu.append(action('復元する', 'restore'));
        row.append(open, preview, metadata, menu); fragment.append(row);
      }
      cards.replaceChildren(fragment); cards.scrollTop = scroll;
    }
    const managerKey = JSON.stringify(state.data?.tags);
    if (managerKey !== managerSignature) {
      managerSignature = managerKey; const previous = managed.value;
      const empty = doc.createElement('option'); empty.value = ''; empty.textContent = '新規タグ'; managed.replaceChildren(empty);
      for (const tag of state.data?.tags ?? []) { const option = doc.createElement('option'); option.value = tag.id; option.textContent = tag.name; managed.append(option); }
      managed.value = state.data?.tags.some(tag => tag.id === previous) ? previous : '';
    }
    const ticket = state.confirmation;
    const validTicket = ticket && ticket.generation === state.generation;
    element('confirmation').hidden = !validTicket;
    if (validTicket) {
      displayedToken = ticket.token;
      const command = ticket.command;
      let operation = command.kind === 'save' ? '現在のドラフトを新しい保存試行として保存します。'
        : command.kind === 'list' ? '一覧へ戻ります。' : command.kind === 'new' ? '新規編集を開始します。' : '選択したメモへ移動します。';
      if (command.kind === 'mutate') {
        const op = command.operation;
        const name = op.kind === 'state' ? state.data?.memos.find(row => row.id === op.id)?.title : state.data?.tags.find(row => row.id === op.id)?.name;
        const action = op.kind === 'delete-tag' ? 'タグと関連を削除します。' : op.kind === 'save-tag' ? 'タグを保存します。'
          : op.action === 'trash' ? 'ゴミ箱へ移動します。' : op.action === 'restore' ? 'ゴミ箱から復元します。' : 'ピン状態を変更します。';
        operation = `「${name ?? '対象'}」の${action}`;
      }
      text('confirm-description', operation + (ticket.reason === 'operation' ? '確認時の対象に対して実行してよいですか？'
        : ticket.reason === 'rejected' ? '保存が拒否されています。入力を保持したまま画面を離れますか？'
        : ticket.reason === 'unknown' ? '結果不明の要求があります。成功と断定せず、確認した操作だけを実行しますか？'
        : '未保存の入力があります。画面を離れますか？入力はメモリ内に保持します。'));
    } else displayedToken = null;
    lastGeneration = state.generation;
  }
  // controllerの公開APIを拡張せず、待機中の中間状態もフレームごとに観測する。
  const observe = () => { if (stopped) return; if (controller.getState().generation !== lastGeneration) render(); frame = win.requestAnimationFrame(observe); };
  render(); frame = win.requestAnimationFrame(observe); void send({ kind: 'load' });
  return () => { stopped = true; win.cancelAnimationFrame(frame); win.cancelAnimationFrame(scrollFrame); };
}

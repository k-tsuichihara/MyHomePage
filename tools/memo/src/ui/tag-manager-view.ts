import type { Tag } from '../types';

/** タグ管理の表示と行入力だけを所有する。検証・確認・保存は既存の呼出し側へ委譲する。 */
export function mountTagManagerView(doc: Document, root: HTMLElement, actions: {
  canStart: () => boolean;
  save?: ((tag: Tag | null, name: string) => boolean | Promise<boolean>) | undefined;
  remove?: ((tag: Tag) => void) | undefined;
  local?: boolean;
}) {
  root.classList.add('tag-manager-content');
  const text = (tag: 'h3' | 'span', value: string) => { const node = doc.createElement(tag); node.textContent = value; return node; };
  const button = (label: string, action: () => void) => {
    const node = doc.createElement('button'); node.type = 'button'; node.textContent = label; node.onclick = action; return node;
  };
  const create = doc.createElement('section'); create.setAttribute('aria-label', 'タグの新規作成');
  const form = doc.createElement('form'); form.className = 'tag-create-form';
  const name = doc.createElement('input'); name.setAttribute('aria-label', '新規タグ名'); name.placeholder = 'タグ名を入力…';
  const add = button('＋追加', () => { void submit(); });
  if (actions.local) { form.id = 'tag-form'; name.id = 'tag-name'; add.id = 'tag-save'; }
  const submit = async () => {
    if (!root.isConnected || !actions.canStart() || !actions.save) return;
    const sent = name.value;
    if (await actions.save(null, sent)) { if (name.value === sent) name.value = ''; }
  };
  form.onsubmit = event => { event.preventDefault(); void submit(); };
  form.append(name, add); create.append(text('h3', 'タグの新規作成'), form);
  create.hidden = !actions.save;
  const registered = doc.createElement('section'); registered.setAttribute('aria-label', '登録済みタグ');
  const search = doc.createElement('input'); search.type = 'search'; search.placeholder = 'タグを検索…'; search.setAttribute('aria-label', '管理タグを検索');
  const labels = doc.createElement('div'); labels.className = 'tag-manager-columns'; labels.setAttribute('aria-hidden', 'true');
  labels.append(text('span', 'タグ名'), text('span', '使用メモ数'));
  const rows = doc.createElement('div'); rows.className = 'tag-manager-rows';
  if (actions.local) rows.id = 'tag-manager-rows';
  registered.append(text('h3', '登録済みタグ'), search, labels, rows);
  const notice = doc.createElement('p'); notice.textContent = 'タグ削除時は関連する全メモ（ゴミ箱内を含む）からタグを外します。確認後に実行します。';
  root.append(create, registered, notice);
  let signature = '', tags: readonly Tag[] = [], usage = new Map<string, number>(), disabled = false;
  let editing: Tag | null = null;
  const filter = () => { Array.from(rows.children).forEach((row, index) => {
    const tag = tags[index];
    (row as HTMLElement).hidden = !!tag && !tag.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase());
  }); };
  search.oninput = filter;
  const lock = () => root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(node => { node.disabled = disabled; });
  const renderRows = () => {
    rows.replaceChildren();
    for (const tag of tags) {
      const row = doc.createElement('div'); row.className = 'tag-manager-row'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', `タグ「${tag.name}」`);
      const current = () => root.contains(row) && actions.canStart();
      if (editing === tag) {
        row.classList.add('is-editing');
        const field = doc.createElement('input'); field.setAttribute('aria-label', '変更後のタグ名'); field.value = tag.name;
        const save = async () => {
          if (!current() || !actions.save) return;
          if (await actions.save(tag, field.value)) { editing = null; renderRows(); }
        };
        const form = doc.createElement('form'); form.className = 'tag-row-form'; form.onsubmit = event => { event.preventDefault(); void save(); };
        form.append(field, button('保存', () => { void save(); }), button('キャンセル', () => { if (current()) { editing = null; renderRows(); } })); row.append(form);
      } else {
        row.append(text('span', tag.name), text('span', `${usage.get(tag.id) ?? 0}件`));
        if (actions.save) row.append(button('編集', () => { if (current()) { editing = tag; renderRows(); rows.querySelector<HTMLInputElement>('.is-editing input')?.focus(); } }));
        if (actions.remove) row.append(button('削除', () => { if (current()) actions.remove!(tag); }));
      }
      rows.append(row);
    }
    filter(); lock();
  };
  return { update(value: readonly Tag[], counts: ReadonlyMap<string, number>, blocked: boolean) {
    disabled = blocked;
    const next = JSON.stringify([value, [...counts]]);
    if (signature !== next) { signature = next; tags = value; usage = new Map(counts); editing = null; renderRows(); }
    lock();
  } };
}

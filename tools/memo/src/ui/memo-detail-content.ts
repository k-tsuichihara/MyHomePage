/** 通常詳細とバックアッププレビューで共用するテキスト描画。外部文字列をHTMLへ展開しない。 */
export function renderMemoDetail(nodes: { title: HTMLElement; body: HTMLElement; tags: HTMLElement }, content: { title: string; body: string; tags: string }) {
  nodes.title.textContent = content.title; nodes.body.textContent = content.body; nodes.tags.textContent = content.tags;
}

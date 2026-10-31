import type { createDeletedRecoveryController, RecoveryCommand } from '../deleted-recovery-controller';
import { canRecover } from '../deleted-recovery';
import { uuidKey } from '../read-primitives';
import { MAX_IMPORT_BYTES } from '../backup-json';
import { renderMemoDetail } from './memo-detail-content';

/** 単件回復は専用controllerだけへ接続する。実ストレージやStep 3の保存経路を参照しない。 */
export function mountDeletedRecoveryPreview(doc: Document, controller: ReturnType<typeof createDeletedRecoveryController>, detailId: () => string | null): void {
  const section = doc.createElement('section'); section.setAttribute('aria-label', '完全削除後の回復');
  const notice = doc.createElement('p'); notice.textContent = '現在の削除履歴にある正常メモを1件ずつ新しいメモとして復元します。元ID・削除履歴は保持し、同IDの現在タグだけを使用します。';
  const file = doc.createElement('input'); file.type = 'file'; file.accept = '.json'; file.setAttribute('aria-label', '単件回復のバックアップJSON');
  const status = doc.createElement('p'); status.setAttribute('role', 'status');
  const content = doc.createElement('div');
  let reading = false, last: unknown = null, lastDetail: string | null = null, error = '', sourceEnded = false, sawDetail = false;
  const held = new Map<HTMLElement, boolean>();
  const button = (label: string, command: RecoveryCommand) => { const node = doc.createElement('button'); node.type = 'button'; node.textContent = label; node.onclick = () => { void send(command); }; return node; };
  const send = async (command: RecoveryCommand) => { const pending = controller.dispatch(command); render(); await pending; render(); };
  file.onchange = () => { void (async () => {
    if (reading) return; const selected = file.files?.[0]; if (!selected) return;
    file.value = ''; reading = true; error = ''; render();
    try { await send({ kind: 'file', bytes: selected.size > MAX_IMPORT_BYTES ? new Uint8Array(MAX_IMPORT_BYTES + 1) : new Uint8Array(await selected.arrayBuffer()) }); sourceEnded = false; sawDetail = false; }
    catch { error = 'ファイルを読み取れません。保存は行いません。'; }
    finally { reading = false; render(); }
  })(); };
  function render() {
    const s = controller.getState(), busy = reading || ['reading', 'writing', 'diagnosing', 'opening'].includes(s.phase);
    const modal = s.phase === 'preview' || s.phase === 'unknown';
    for (const child of Array.from(doc.getElementById('memo-app')!.children)) {
      if (child !== section && child instanceof doc.defaultView!.HTMLElement && (busy || modal)) {
        if (!held.has(child)) held.set(child, child.inert); child.inert = true;
      }
    }
    if (!busy && !modal) { for (const [node, previous] of held) node.inert = previous; held.clear(); }
    file.disabled = busy || modal; file.hidden = s.phase === 'unknown';
    status.textContent = error || s.message;
    if (s.navigation === 'failed') status.textContent += ' 作成は確認済みですが通常詳細を開けませんでした。通常画面を再読込してください。';
    content.replaceChildren();
    if (!s.backup) return;
    const uncertain = (id: string) => s.uncertainSourceIds.some(source => uuidKey(source) === uuidKey(id));
    const warn = () => {
      const node = doc.createElement('p'); node.textContent = 'この元メモの前回の復元結果は不明です。再復元すると同内容のメモが重複する可能性があります。'; return node;
    };
    if (s.phase === 'list') {
      const heading = doc.createElement('p'); heading.textContent = `${s.page + 1}ページ・初期未選択。元ID重複行は同じ正常関連を参照します。警告${s.backup.warnings.length}件。`; content.append(heading);
      if (s.page > 0) content.append(button('単件回復の前ページ', { kind: 'page', page: s.page - 1 }));
      if ((s.page + 1) * 50 < s.backup.rows.length) content.append(button('単件回復の次ページ', { kind: 'page', page: s.page + 1 }));
      for (const row of s.backup.rows.slice(s.page * 50, s.page * 50 + 50)) {
        const node = button(`${row.index + 1}: ${row.memo?.title ?? '不正なメモ'}をプレビュー`, { kind: 'select', index: row.index });
        node.disabled = !s.current || !canRecover(row, s.current); content.append(node);
        if (row.memo && uncertain(row.memo.id)) {
          const warning = warn(); warning.textContent = `${row.index + 1}行目: ${warning.textContent}`; content.append(warning);
        }
      }
    }
    if (s.phase === 'preview' && s.selected !== null) {
      const row = s.backup.rows[s.selected]!, article = doc.createElement('article'); article.setAttribute('aria-label', '読取専用バックアッププレビュー');
      const title = doc.createElement('h3'), body = doc.createElement('p'), tags = doc.createElement('p');
      renderMemoDetail({ title, body, tags }, { title: row.memo!.title, body: row.memo!.body,
        tags: s.current!.tags.filter(t => s.tagIds.some(id => uuidKey(id) === uuidKey(t.id))).map(t => t.name).join('・') });
      article.append(title, body, tags);
      if (uncertain(row.memo!.id)) article.append(warn());
      for (const id of row.tagIds.filter(id => !s.tagIds.some(tag => uuidKey(tag) === uuidKey(id)))) {
        const warning = doc.createElement('p'); warning.textContent = `バックアップのタグ「${s.backup.tags.find(t => uuidKey(t.id) === uuidKey(id))?.name ?? 'タグ'}」は現在存在しないため復元されません。`; article.append(warning);
      }
      if (row.warnings.length) { const warning = doc.createElement('p'); warning.textContent = `バックアップ診断の警告: ${row.warnings.join('、')}`; article.append(warning); }
      content.append(article, button('新しいメモとして復元', { kind: 'restore' }), button('バックアップ一覧へ戻る', { kind: 'back' }));
    }
    if (s.phase === 'unknown') {
      const warning = doc.createElement('p'); warning.textContent = '既に作成されている可能性があり、もう一度復元すると同内容のメモが重複する場合があります。自動再書込はしません。一時UUIDはページ再読込・終了で失われます。';
      content.append(warning, button('単件回復の保存状況を再確認', { kind: 'inspect' }), button('もう一度復元する', { kind: 'retry' }), button('復元せずに戻る', { kind: 'back' }));
    }
    if (s.phase === 'created') {
      const current = detailId();
      if (current && s.newId && uuidKey(current) === uuidKey(s.newId)) sawDetail = true;
      else if (sawDetail) sourceEnded = true;
      if (!sourceEnded && s.navigation === 'opened' && current === s.newId) content.append(button('バックアッププレビューに戻る', { kind: 'source' }));
    }
    if (s.phase === 'failed') content.append(button('単件回復の一覧へ戻る', { kind: 'back' }));
  }
  section.append(notice, file, status, content); doc.getElementById('memo-app')!.append(section); render();
  const observe = () => { const s = controller.getState(), detail = detailId(); if (s !== last || detail !== lastDetail) { last = s; lastDetail = detail; render(); } doc.defaultView!.requestAnimationFrame(observe); };
  doc.defaultView!.requestAnimationFrame(observe);
}

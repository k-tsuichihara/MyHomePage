import type { createLocalRestoreController, RestoreCommand } from '../local-restore-controller';
import { MAX_IMPORT_BYTES } from '../backup-json';
import { compareRestoreRow } from '../local-restore';

/** 保存先へ直接アクセスせず、合成環境の復元controllerだけを操作する。 */
export function mountRestorePreview(doc: Document, controller: ReturnType<typeof createLocalRestoreController>): void {
  const section = doc.createElement('section'); section.setAttribute('aria-label', '追加型復元');
  const notice = doc.createElement('p'); notice.textContent = '既存の正常v3へ新しいメモを追加します。初期復元ではありません。バックアップの削除履歴は取り込みません。元ID重複行には共通の正常タグ関連を適用します。入力10 MiB・深度32、メモ10000・タグ5000・関連100000・削除ID100000、候補16 MiBが上限です。';
  const file = doc.createElement('input'); file.type = 'file'; file.accept = '.json'; file.setAttribute('aria-label', 'バックアップJSONを選択');
  const status = doc.createElement('p'); status.setAttribute('role', 'status');
  const recovery = doc.createElement('p');
  const controls = doc.createElement('div'), rows = doc.createElement('div'); let readingFile = false, fileError = '';
  const button = (label: string, command: RestoreCommand, disabled = false) => {
    const node = doc.createElement('button'); node.type = 'button'; node.textContent = label; node.disabled = disabled;
    node.onclick = () => { void send(command); }; return node;
  };
  const send = async (command: RestoreCommand) => { const promise = controller.dispatch(command); render(); await promise; render(); };
  file.onchange = () => { void read(); };
  async function read() {
    if (readingFile) return; const selected = file.files?.[0]; if (!selected) return;
    // Fileは保持し、同じファイルの再選択でもchangeを発生させる。再診断は明示操作だけ。
    file.value = '';
    readingFile = true; file.disabled = true; fileError = '';
    try {
      await send({ kind: 'reset' });
      if (controller.getState().phase !== 'idle') return;
      // 全読取より前の上限検査。名前・MIMEは保存先や信頼の根拠に使わない。
      if (selected.size > MAX_IMPORT_BYTES) { await send({ kind: 'file', bytes: new Uint8Array(MAX_IMPORT_BYTES + 1) }); return; }
      await send({ kind: 'file', bytes: new Uint8Array(await selected.arrayBuffer()) });
    } catch { fileError = 'ファイルを読み取れません。保存領域は変更していません。'; }
    finally { readingFile = false; render(); }
  }
  function render() {
    const s = controller.getState(), busy = s.phase === 'writing' || s.phase === 'reading';
    // 確認・適用中の通常画面操作を止める。ブラウザ自体の更新・終了は保証しない。
    for (const child of Array.from(doc.getElementById('memo-app')!.children)) {
      if (child !== section && child instanceof doc.defaultView!.HTMLElement) child.inert = busy || readingFile || s.phase === 'confirmation';
    }
    file.disabled = busy || readingFile;
    recovery.textContent = s.phase === 'failed'
      ? '再操作する場合は「バックアップJSONを選択」でファイルを選び直し、再診断・対象選択・確認を最初から行ってください。自動再試行はしません。'
      : s.phase === 'unknown'
        ? 'まず「保存状況を再確認」を実行してください。読めても過去の書込成功は確定しません。再操作を選ぶ場合はファイルを選び直し、再診断・対象選択・確認が必要です。重複して追加される可能性があります。自動再試行はしません。'
        : '';
    status.textContent = `${fileError || s.message} 選択${s.selected.length}件。${s.page + 1}ページ。警告${s.backup?.warnings.length ?? 0}件（先頭20件表示）: ${s.backup?.warnings.slice(0, 20).join('、') ?? ''}`;
    controls.replaceChildren(); rows.replaceChildren();
    if (!s.backup) return;
    const pageRows = s.backup.rows.slice(s.page * 50, s.page * 50 + 50), locked = s.phase !== 'review';
    controls.append(button('前のページ', { kind: 'page', page: s.page - 1 }, locked || s.page === 0),
      button('次のページ', { kind: 'page', page: s.page + 1 }, locked || (s.page + 1) * 50 >= s.backup.rows.length),
      button('このページを選択', { kind: 'select', indexes: pageRows.map(row => row.index), selected: true }, locked),
      button('このページを解除', { kind: 'select', indexes: pageRows.map(row => row.index), selected: false }, locked),
      button('追加内容を確認', { kind: 'prepare' }, locked || !s.selected.length));
    for (const row of pageRows) {
      const label = doc.createElement('label'), check = doc.createElement('input'); check.type = 'checkbox'; check.checked = s.selected.includes(row.index); check.disabled = locked || !row.memo;
      check.onchange = () => { void send({ kind: 'select', indexes: [row.index], selected: check.checked }); };
      const text = doc.createElement('span'), diff = s.current && row.memo ? compareRestoreRow(row, s.backup, s.current) : [];
      text.textContent = row.memo ? `${row.index + 1}: ${row.memo.title} ${diff === null ? '新規' : diff.length ? `差分あり: ${diff.join('、')}` : '一致'} ${row.warnings.join('、')}`
        : `${row.index + 1}: 不正なメモ（${row.reason}）`;
      label.append(check, text); rows.append(label, doc.createElement('br'));
    }
    if (s.phase === 'confirmation') {
      const confirmation = doc.createElement('div'); confirmation.setAttribute('role', 'dialog'); confirmation.setAttribute('aria-label', '追加型復元の確認');
      confirmation.textContent = `新規メモ${s.summary!.memos}件・新規タグ${s.summary!.tags}件を一回の書込で追加します。既存データ・削除履歴は保持します。`;
      confirmation.append(button('確認して復元', { kind: 'confirm' }), button('復元をキャンセル', { kind: 'cancel' })); controls.append(confirmation);
    }
    if (s.phase === 'unknown') controls.append(button('保存状況を再確認', { kind: 'inspect' }));
  }
  section.append(notice, file, status, recovery, controls, rows); doc.getElementById('memo-app')!.append(section); render();
}

import type { createInitialRestoreController, InitialCommand } from '../initial-restore-controller';
import { MAX_IMPORT_BYTES } from '../backup-json';

/** 合成環境の初期復元専用画面。通常利用を選ぶ操作は既存の通常UIへ委ねる。 */
export function mountInitialRestorePreview(doc: Document, controller: ReturnType<typeof createInitialRestoreController>): void {
  const root = doc.getElementById('memo-app')!, section = doc.createElement('section'); section.setAttribute('aria-label', '保存領域喪失時の初期復元');
  const notice = doc.createElement('p'); notice.textContent = '全件一括の初期復元です。JSONは平文で、暗号化・署名による真正性保証はありません。バックアップ作成後の変更や削除履歴は復元できず、古い状態が再導入される可能性があります。新旧キーが両方存在しない場合だけ実行できます。';
  const file = doc.createElement('input'); file.type = 'file'; file.accept = '.json'; file.setAttribute('aria-label', '初期復元のバックアップJSON');
  const status = doc.createElement('p'); status.setAttribute('role', 'status');
  const history = doc.createElement('p'), controls = doc.createElement('div');
  const held = new Map<HTMLElement, boolean>(); let readingFile = false, fileError = '';
  const send = async (command: InitialCommand) => { const p = controller.dispatch(command); render(); await p; render(); };
  const button = (label: string, command: InitialCommand, disabled = false) => {
    const node = doc.createElement('button'); node.type = 'button'; node.textContent = label; node.disabled = disabled; node.onclick = () => { void send(command); }; return node;
  };
  file.onchange = () => { void (async () => {
    if (readingFile) return; const selected = file.files?.[0]; if (!selected) return; file.value = ''; fileError = ''; readingFile = true; render();
    try {
      // File読取のawaitより先に旧確認を消費させ、遅延中に古い候補を保存させない。
      await send({ kind: 'leave' });
      if (controller.getState().phase !== 'idle' || controller.getState().candidate !== null) return;
      await send({ kind: 'file', bytes: selected.size > MAX_IMPORT_BYTES ? new Uint8Array(MAX_IMPORT_BYTES + 1) : new Uint8Array(await selected.arrayBuffer()) });
    }
    catch { fileError = 'ファイルを読み取れません。書込はありません。'; }
    finally { readingFile = false; render(); }
  })(); };
  function render() {
    const s = controller.getState(), busy = readingFile || s.phase === 'reading' || s.phase === 'writing', modal = s.phase === 'confirmation';
    for (const child of Array.from(root.children)) if (child !== section && child instanceof doc.defaultView!.HTMLElement && (busy || modal)) {
      if (!held.has(child)) held.set(child, child.inert); child.inert = true;
    }
    if (!busy && !modal) { for (const [node, previous] of held) node.inert = previous; held.clear(); }
    const completed = s.result === 'written';
    file.disabled = busy || completed;
    status.textContent = fileError || s.message;
    if (s.navigation === 'failed') status.textContent += ' 復元書込は確認済みですが、通常画面の読込に失敗しました。';
    history.textContent = s.hadUnknown ? '以前の初期復元結果が不明だったことを保持しています。後続の診断・拒否・移動は過去の結果を確定しません。この情報はページ再読込・終了で失われます。' : '';
    controls.replaceChildren();
    controls.append(button('初期復元の保存状況を診断', { kind: 'inspect' }, busy || completed));
    if (completed) {
      const done = doc.createElement('p'); done.textContent = '初期復元は完了しています。この画面から再実行はできません。以降は通常画面を利用してください。'; controls.append(done);
    }
    if (s.candidate) {
      const counts = doc.createElement('p'), d = s.candidate;
      counts.textContent = `メモ${d.memos.length}件・タグ${d.tags.length}件・関連${d.memoTags.length}件・削除履歴${d.deletedMemoIds.length}件。作成日時（参考・真正性の証明ではありません）: ${s.exportedAt}`;
      controls.append(counts);
      controls.append(button('初期復元の確認へ', { kind: 'prepare' }, busy || completed || (s.hadUnknown && s.observed !== 'absent')));
    }
    if (modal) {
      const dialog = doc.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', '初期復元の専用確認');
      dialog.textContent = '全件を原ID・原日時・削除履歴のまま保存します。バックアップ後に失われた履歴は回復できません。実行してよいですか？';
      dialog.append(button('確認して初期復元', { kind: 'confirm', generation: s.generation }), button('初期復元をキャンセル', { kind: 'cancel' })); controls.append(dialog);
    }
    if (!completed) controls.append(button('初期復元を終了して通常利用', { kind: 'leave' }, busy));
  }
  section.append(notice, file, status, history, controls); root.append(section); render();
}

import type { BackupResult } from '../local-backup';

/** 隔離UIから読取専用サービスを呼ぶ。保存完了ではなくダウンロード開始だけを通知する。 */
export function mountBackupPreview(doc: Document, prepare: () => Promise<BackupResult>, mode: 'backup' | 'v2-original' = 'backup'): () => void {
  const original = mode === 'v2-original';
  const section = doc.createElement('section'); section.setAttribute('aria-label', original ? 'v2移行前の原値退避' : 'JSONバックアップ');
  const notice = doc.createElement('p');
  notice.textContent = '通常メモ・ゴミ箱・全タグ・関連・削除済みIDを平文JSONで出力します。旧キー・migration/legacySnapshot・未保存ドラフトは含みません。個人情報を含むため保存先・共有に注意してください。上限10 MiB。ディスクへの保存完了は確認できません。';
  if (original) notice.textContent = 'v3更新前に旧タブを閉じてください。新旧キーの原文字列（旧キー不在はnull）を平文JSONへ退避します。旧データ・移行情報・個人情報を含みます。安全な場所へ保管し共有しないでください。上限10 MiB。通常のバックアップ復元へは取り込めません。保存領域は変更しません。ファイルの保存完了は確認できず、準備やクリックだけで保全完了とは判定しません。';
  const button = doc.createElement('button'); button.type = 'button'; button.textContent = 'JSONバックアップを作成';
  if (original) button.textContent = 'v2移行前の原値ファイルを準備';
  const status = doc.createElement('p'); status.setAttribute('role', 'status');
  const win = doc.defaultView!;
  const link = doc.createElement('a'); link.textContent = '準備済みJSONをダウンロード'; link.hidden = true;
  const discard = doc.createElement('button'); discard.type = 'button'; discard.textContent = '準備済みファイルを破棄'; discard.hidden = true;
  let busy = false, generation = 0, currentUrl: string | null = null, disposed = false;
  function release() {
    generation++;
    if (currentUrl) win.URL.revokeObjectURL(currentUrl);
    currentUrl = null; link.removeAttribute('href'); link.removeAttribute('download'); link.hidden = true; discard.hidden = true;
  }
  // 非同期処理を挟まない通常リンクの既定動作に、利用者のクリックを直接渡す。
  link.addEventListener('click', () => {
    status.textContent = 'ダウンロード操作を受け付けました。保存完了は保証できません。ファイルを確認してください。';
  });
  discard.addEventListener('click', () => { release(); status.textContent = '準備済みファイルを破棄しました。保存領域は変更していません。'; });
  // 保存開始直後の固定時間では解放しない。明示破棄・再作成・ページ終了まで保持する。
  const pagehide = () => { release(); status.textContent = '再度バックアップを準備してください。'; };
  win.addEventListener('pagehide', pagehide);
  button.addEventListener('click', () => { void run(); });
  async function run() {
    if (busy || disposed) return;
    release(); const ticket = generation;
    busy = true; button.disabled = true; status.textContent = 'バックアップを準備しています…';
    let url: string | undefined;
    try {
      const result = await prepare();
      if (ticket !== generation) return;
      if (result.kind === 'failed') {
        status.textContent = result.reason === 'too-large' ? '10 MiBを超えるため全体の出力を中止しました。切り詰め・保存領域の変更はありません。'
          : `バックアップを作成できません（${result.reason}）。保存領域は変更していません。`;
        return;
      }
      const blob = new win.Blob([result.json], { type: 'application/json;charset=utf-8' });
      if (blob.size !== result.bytes || await blob.text() !== result.json) throw new Error('generation');
      if (ticket !== generation) return;
      url = win.URL.createObjectURL(blob);
      link.download = result.filename; link.href = url; currentUrl = url; url = undefined;
      link.hidden = false; discard.hidden = false;
      status.textContent = 'ファイルを準備しました。リンクを押してダウンロードしてください。取得時点の内容です。転送中は破棄・再作成・画面終了を避けてください。';
    } catch {
      if (ticket === generation) status.textContent = 'ファイル準備に失敗しました。保存領域は変更していません。';
    } finally {
      if (url) doc.defaultView!.URL.revokeObjectURL(url);
      busy = false; button.disabled = disposed;
    }
  }
  section.append(notice, button, link, discard, status); doc.getElementById('memo-app')!.append(section);
  return () => {
    if (disposed) return;
    disposed = true; release(); button.disabled = true;
    win.removeEventListener('pagehide', pagehide); section.remove();
  };
}

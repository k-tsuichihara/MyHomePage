import type { BackupResult } from '../local-backup';

/** 隔離UIから読取専用サービスを呼ぶ。保存完了ではなくダウンロード開始だけを通知する。 */
export function mountBackupPreview(doc: Document, prepare: () => Promise<BackupResult>): void {
  const section = doc.createElement('section'); section.setAttribute('aria-label', 'JSONバックアップ');
  const notice = doc.createElement('p');
  notice.textContent = '通常メモ・ゴミ箱・全タグ・関連・削除済みIDを平文JSONで出力します。旧キー・migration/legacySnapshot・未保存ドラフトは含みません。個人情報を含むため保存先・共有に注意してください。上限10 MiB。ディスクへの保存完了は確認できません。';
  const button = doc.createElement('button'); button.type = 'button'; button.textContent = 'JSONバックアップを作成';
  const status = doc.createElement('p'); status.setAttribute('role', 'status');
  let busy = false;
  button.addEventListener('click', () => { void run(); });
  async function run() {
    if (busy) return;
    busy = true; button.disabled = true; status.textContent = 'バックアップを準備しています…';
    let url: string | undefined;
    try {
      const result = await prepare();
      if (result.kind === 'failed') {
        status.textContent = result.reason === 'too-large' ? '10 MiBを超えるため全体の出力を中止しました。切り詰め・保存領域の変更はありません。'
          : `バックアップを作成できません（${result.reason}）。保存領域は変更していません。`;
        return;
      }
      const win = doc.defaultView!;
      const blob = new win.Blob([result.json], { type: 'application/json;charset=utf-8' });
      if (blob.size !== result.bytes || await blob.text() !== result.json) throw new Error('generation');
      url = win.URL.createObjectURL(blob);
      const anchor = doc.createElement('a'); anchor.download = result.filename; anchor.href = url;
      doc.body.append(anchor); anchor.click(); anchor.remove();
      status.textContent = 'ダウンロードを開始しました。保存完了は保証できません。ファイルを確認してください。';
      // ブラウザへクリックを渡した後に解放し、同じURLを再利用しない。
      const released = url; win.setTimeout(() => win.URL.revokeObjectURL(released), 1000); url = undefined;
    } catch {
      status.textContent = 'ファイル生成・ダウンロード開始に失敗しました。保存完了とは確認できません。';
    } finally {
      if (url) doc.defaultView!.URL.revokeObjectURL(url);
      busy = false; button.disabled = false;
    }
  }
  section.append(notice, button, status); doc.getElementById('memo-app')!.append(section);
}

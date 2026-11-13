import { createVoiceInput } from '../voice-input';
import type { VoiceRecognition, VoiceStatus } from '../voice-input';
import type { createLocalMemoController } from '../local-memo-controller';

/** 製品候補だけの音声操作。起動時は認識器を生成せず、権限要求もしない。 */
export function mountVoiceInput(doc: Document, controller: ReturnType<typeof createLocalMemoController>) {
  const win = doc.defaultView! as Window & { SpeechRecognition?: new () => VoiceRecognition; webkitSpeechRecognition?: new () => VoiceRecognition };
  const Native = win.SpeechRecognition ?? win.webkitSpeechRecognition;
  const section = doc.createElement('section'), status = doc.createElement('p'); status.setAttribute('role', 'status');
  const messages: Record<VoiceStatus, string> = {
    idle: '音声入力は手動保存です。', listening: '日本語を認識中です。', unsupported: 'このブラウザは音声入力に対応していません。手入力を続けてください。',
    failed: '音声入力を開始・継続できません。入力は保持しています。手入力を続けてください。',
    'invalid-input': '認識結果が上限または入力条件を超えたため追記しません。手入力を続けてください。', stopped: '音声入力を停止しました。入力は保持しています。',
  };
  const stop = doc.createElement('button'); stop.type = 'button'; stop.textContent = '音声入力を停止';
  const voice = createVoiceInput(controller, Native ? () => new Native() : undefined, value => { status.textContent = messages[value]; stop.disabled = value !== 'listening'; });
  stop.disabled = true; stop.onclick = () => voice.stop();
  const buttons: HTMLButtonElement[] = [];
  for (const [id, label] of [['list-view', '新規音声メモ'], ['detail-view', '音声で本文へ追記'], ['editor-view', '音声で本文へ追記']]) {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = label!;
    button.onclick = () => { void voice.start(); }; doc.getElementById(id!)!.append(button); buttons.push(button);
  }
  const notice = doc.createElement('p'); notice.textContent = '音声入力はブラウザの認識サービスを利用します。音声が外部サービスへ送信される場合があります。アプリは録音を保存しません。開始はボタン操作時だけです。';
  section.append(notice, stop, status); doc.getElementById('memo-app')!.append(section);
  const pagehide = () => voice.stop(); win.addEventListener('pagehide', pagehide);
  return () => { voice.dispose(); win.removeEventListener('pagehide', pagehide); buttons.forEach(button => button.remove()); section.remove(); };
}

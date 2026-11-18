import { createVoiceInput } from '../voice-input';
import type { VoiceRecognition, VoiceStatus, VoiceEditorPort } from '../voice-input';
import type { createLocalMemoController } from '../local-memo-controller';
import type { VoiceEditBridge } from './memo-preview';

/** 一覧の音声スタイルを利用する表示装飾。適用幅は製品CSSへ委ね、認識操作は変更しない。 */
export function decoratePcVoiceButton(doc: Document, button: HTMLButtonElement) {
  button.classList.add('pc-voice-button');
  const icon = doc.createElement('span'); icon.className = 'pc-only'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = '🎙 ';
  button.prepend(icon);
}

/** 製品候補だけの音声操作。起動時は認識器を生成せず、権限要求もしない。 */
export function createVoiceControls(doc: Document, controller: VoiceEditorPort, bridge: VoiceEditBridge, now?: () => Date) {
  const win = doc.defaultView! as Window & { SpeechRecognition?: new () => VoiceRecognition; webkitSpeechRecognition?: new () => VoiceRecognition };
  const Native = win.SpeechRecognition ?? win.webkitSpeechRecognition;
  const section = doc.createElement('section'), status = doc.createElement('p'); section.dataset.voiceControls = ''; status.setAttribute('role', 'status');
  const messages: Record<VoiceStatus, string> = {
    idle: '音声入力は手動保存です。', listening: '日本語を認識中です。', unsupported: 'このブラウザは音声入力に対応していません。手入力を続けてください。',
    failed: '音声入力を開始・継続できません。入力は保持しています。手入力を続けてください。',
    'invalid-input': '認識結果が上限または入力条件を超えたため追記しません。手入力を続けてください。', stopped: '音声入力を停止しました。入力は保持しています。',
  };
  const stop = doc.createElement('button'); stop.type = 'button'; stop.textContent = '音声入力を停止';
  const voice = createVoiceInput(controller, Native ? () => new Native() : undefined, value => { status.textContent = messages[value]; status.dataset.voiceRoutine = String(value === 'idle' || value === 'stopped'); stop.disabled = value !== 'listening'; }, now,
    (session, text, isCurrent) => bridge.append?.(session, text, isCurrent) ?? Promise.resolve(false));
  stop.disabled = true; stop.onclick = () => voice.stop();
  const notice = doc.createElement('p'); notice.className = 'voice-service-notice'; notice.textContent = '音声入力はブラウザの認識サービスを利用します。音声が外部サービスへ送信される場合があります。アプリは録音を保存しません。開始はボタン操作時だけです。';
  section.append(notice, stop, status);
  const pagehide = () => voice.stop(); win.addEventListener('pagehide', pagehide);
  return { section, status, start: () => voice.start(), stop: () => voice.stop(), dispose() {
    voice.dispose(); win.removeEventListener('pagehide', pagehide); stop.onclick = null; section.remove();
  } };
}

export function mountVoiceInput(doc: Document, controller: ReturnType<typeof createLocalMemoController>, bridge: VoiceEditBridge) {
  const voice = createVoiceControls(doc, controller, bridge);
  const buttons: HTMLButtonElement[] = [];
  for (const [id, label] of [['list-view', '新規音声メモ'], ['detail-view', '音声で本文へ追記'], ['editor-view', '音声で本文へ追記']]) {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = label!;
    if (id === 'list-view' && doc.documentElement.dataset.productLayout === 'review2') {
      const icon = doc.createElement('span'); icon.textContent = '🎙'; icon.setAttribute('aria-hidden', 'true');
      button.className = 'voice-memo-button'; button.setAttribute('aria-label', '音声メモ'); button.replaceChildren(icon, ' 音声メモ');
    }
    if (id !== 'list-view' && doc.documentElement.dataset.productLayout === 'review2') decoratePcVoiceButton(doc, button);
    button.onclick = () => { void voice.start(); };
    const slot = doc.getElementById(id === 'list-view' ? 'list-voice-slot' : id === 'detail-view' ? 'detail-voice-slot' : 'editor-voice-slot');
    (slot ?? doc.getElementById(id!))!.append(button); buttons.push(button);
  }
  (doc.getElementById('editor-voice-controls-slot') ?? doc.getElementById('memo-app'))!.append(voice.section);
  const editorFooter = doc.querySelector('#editor-view .editor-footer');
  const stop = voice.section.querySelector('button');
  if (editorFooter && stop && doc.documentElement.dataset.productLayout === 'review2') editorFooter.prepend(stop);
  // 非対応時はeditorへ遷移しないため、通知は一覧・詳細からも見える共通領域へ置く。
  (doc.querySelector('#memo-app .statuses') ?? doc.getElementById('memo-app'))!.append(voice.status);
  return Object.assign(() => { voice.dispose(); voice.status.remove(); if (editorFooter) stop?.remove(); buttons.forEach(button => button.remove()); },
    { stop: () => voice.stop() });
}

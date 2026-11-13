import type { createLocalMemoController } from './local-memo-controller';
import { normalizeMemoInput } from './input';

export interface VoiceRecognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type Controller = ReturnType<typeof createLocalMemoController>;
export type VoiceStatus = 'idle' | 'listening' | 'unsupported' | 'failed' | 'invalid-input' | 'stopped';

/** 認識は明示開始だけ。結果は現在の編集セッションへ追記し、保存は呼び出さない。 */
export function createVoiceInput(controller: Controller, factory: (() => VoiceRecognition) | undefined,
  notify: (status: VoiceStatus) => void, now: () => Date = () => new Date()) {
  let recognition: VoiceRecognition | null = null, disposed = false, starting = false;
  let epoch = 0;
  const stop = () => {
    ++epoch; const current = recognition; recognition = null;
    if (current) {
      current.onresult = null; current.onerror = null; current.onend = null;
      try { current.abort(); } catch { /* 元例外や音声を公開しない */ }
    }
  };
  return {
    async start() {
      if (disposed || recognition || starting) return;
      if (!factory) { notify('unsupported'); return; }
      const state = controller.getState();
      if (state.read.kind !== 'ready' || state.write.kind === 'writing' || state.confirmation) return;
      starting = true; const operation = ++epoch;
      try {
        const command = state.route.kind === 'list' ? { kind: 'new' as const }
          : state.route.kind === 'detail' ? { kind: 'edit' as const, id: state.route.id } : null;
        if (command && (await controller.dispatch(command)).kind !== 'done') return;
        if (disposed || operation !== epoch) return;
        if (state.route.kind === 'list') {
          const date = now(), pad = (value: number) => String(value).padStart(2, '0');
          const title = `音声メモ-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
          const editor = controller.getState().editor;
          if (!editor || (await controller.dispatch({ kind: 'draft', value: { ...editor.draft, title } })).kind !== 'done') return;
        }
        const session = controller.getState().editor?.sessionId;
        if (!session) return;
        const current = factory(); recognition = current;
        current.lang = 'ja-JP'; current.continuous = false; current.interimResults = false;
        current.onresult = event => {
          if (disposed || operation !== epoch || recognition !== current) return;
          const latest = controller.getState();
          if (latest.route.kind !== 'edit' || latest.editor?.sessionId !== session || latest.write.kind === 'writing') { stop(); notify('stopped'); return; }
          let transcript = '';
          for (let index = event.resultIndex; index < event.results.length; index++) {
            const result = event.results[index]; if (result?.isFinal) transcript += result[0].transcript;
          }
          if (!transcript) return;
          const draft = latest.editor.draft;
          const body = draft.body + transcript;
          try { normalizeMemoInput(draft.title, body); }
          catch { stop(); notify('invalid-input'); return; }
          // 一回の認識結果を一回だけ反映し、手入力の最新値を基準にする。
          stop(); void controller.dispatch({ kind: 'draft', value: { ...draft, body } }); notify('idle');
        };
        current.onerror = () => { if (operation === epoch) { stop(); notify('failed'); } };
        current.onend = () => { if (operation === epoch) { stop(); notify('idle'); } };
        notify('listening'); current.start();
      } catch { stop(); if (!disposed) notify('failed'); }
      finally { starting = false; }
    },
    stop() { stop(); if (!disposed) notify('stopped'); },
    dispose() { disposed = true; stop(); },
  };
}

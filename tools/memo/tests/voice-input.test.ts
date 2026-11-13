import { expect, it, vi } from 'vitest';
import { createVoiceInput } from '../src/voice-input';
import type { VoiceRecognition, VoiceStatus } from '../src/voice-input';
import { createLocalMemoController } from '../src/local-memo-controller';
import { saveFixture, token } from './local-save-fixtures';

async function fixture() {
  const f = saveFixture();
  let id = 10;
  const controller = createLocalMemoController({ store: f.store, createId: () => token(++id) });
  await controller.dispatch({ kind: 'load' });
  const recognition: VoiceRecognition = { lang: '', continuous: true, interimResults: true, onresult: null, onerror: null, onend: null, start: vi.fn(), abort: vi.fn() };
  const statuses: VoiceStatus[] = [];
  const factory = vi.fn(() => recognition);
  const voice = createVoiceInput(controller, factory, status => statuses.push(status), () => new Date(2026, 10, 13, 9, 5));
  const result = (text: string) => recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
  return { ...f, controller, recognition, statuses, factory, voice, result };
}

it('明示開始だけで日本語認識し、新規音声ドラフトを作り保存しない', async () => {
  const f = await fixture(); expect(f.factory).not.toHaveBeenCalled();
  await f.voice.start(); await f.voice.start();
  expect(f.factory).toHaveBeenCalledTimes(1); expect(f.recognition.lang).toBe('ja-JP');
  expect(f.controller.getState().editor?.draft.title).toBe('音声メモ-20261113-0905');
  f.result('合成音声');
  expect(f.controller.getState().editor?.draft.body).toBe('合成音声');
  expect(f.storage.writes).toEqual([]);
});

it('認識中の追加入力へ追記し、上限超過は全結果を拒否する', async () => {
  const f = await fixture(); await f.voice.start();
  await f.controller.dispatch({ kind: 'draft', value: { title: '手入力', body: '最新本文', tagIds: [] } });
  f.result('追記'); expect(f.controller.getState().editor?.draft.body).toBe('最新本文追記');
  await f.voice.start();
  f.result('😀'.repeat(10001));
  expect(f.controller.getState().editor?.draft.body).toBe('最新本文追記');
  expect(f.statuses.at(-1)).toBe('invalid-input'); expect(f.storage.writes).toEqual([]);
});

it('拒否・失敗・dispose後の古い結果で既存入力を変更しない', async () => {
  const f = await fixture(); await f.voice.start();
  const late = f.recognition.onresult!;
  const before = f.controller.getState().editor?.draft;
  f.recognition.onerror?.(); expect(f.statuses.at(-1)).toBe('failed');
  late({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: '遅延結果' } }] });
  expect(f.controller.getState().editor?.draft).toEqual(before);
  f.voice.dispose(); await f.voice.start(); expect(f.factory).toHaveBeenCalledTimes(1);
});

it('非対応では画面遷移せず手入力を維持する', async () => {
  const f = await fixture(); const before = f.controller.getState();
  const voice = createVoiceInput(f.controller, undefined, status => f.statuses.push(status));
  await voice.start(); expect(f.statuses.at(-1)).toBe('unsupported');
  expect(f.controller.getState()).toBe(before);
});

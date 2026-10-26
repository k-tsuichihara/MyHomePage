import { createLocalMemoStore } from '../../src/local-memo-store';
import { createLocalMemoController } from '../../src/local-memo-controller';
import { NEW_STORAGE_KEY } from '../../src/local-migration';
import type { LocalLockManager } from '../../src/local-lock';

const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2026-10-26T00:00:00Z';

/** ブラウザ保存APIを参照しない合成保存先。ページを閉じればすべて失われる。 */
export function createPreviewController(scenario: string) {
  let raw = JSON.stringify({ version: 2, migration: { status: 'not-required' },
    memos: Array.from({ length: 12 }, (_, i) => ({ id: id(i + 1), title: i === 0 ? '仕事メモ' : `合成メモ ${i + 1}`,
      body: i === 0 ? '入力・保存・ドラフト保護を検証します。' : '合成データだけを使います。',
      createdAt: now, updatedAt: now, pinnedAt: i === 0 ? now : null, deletedAt: null, revision: 1, lastRequestId: null })),
    tags: [{ id: id(50), name: '仕事', createdAt: now, revision: 1 }, { id: id(51), name: '個人', createdAt: now, revision: 1 }],
    memoTags: [{ memoId: id(1), tagId: id(50) }] });
  let written = false;
  const storage = {
    getItem(key: string): string | null {
      if (key !== NEW_STORAGE_KEY) return null;
      return raw;
    },
    setItem(key: string, value: string) {
      if (key !== NEW_STORAGE_KEY) throw new Error('Unexpected synthetic key');
      raw = value; written = true;
      if (scenario === 'unknown') throw new Error('Synthetic unknown write');
    },
  };
  // 実Web Locksではない。単一ページの合成操作だけを直列化する。
  let tail: Promise<unknown> = Promise.resolve();
  const locks: LocalLockManager = { request(_name, _options, operation) {
    const next = tail.then(operation); tail = next.catch(() => undefined); return next;
  } };
  const base = createLocalMemoStore({ storage, locks, now: () => now });
  const store: typeof base = { ...base, async load() {
    // 保存直後の読戻し検証は成功させ、確定成功後の別loadだけを失敗させる。
    if (scenario === 'reload-failure' && written) return { kind: 'unavailable', reason: 'storage-failure' };
    return base.load();
  }, async save(input) {
    if (scenario === 'slow') await new Promise(resolve => setTimeout(resolve, 600));
    if (scenario === 'rejected') return { kind: 'rejected', reason: 'conflict', writeOutcome: 'not-attempted' };
    return base.save(input);
  } };
  let sequence = 100;
  return createLocalMemoController({ store, createId: () => id(++sequence) });
}

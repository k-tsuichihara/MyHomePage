import { createLocalMemoStore } from '../../src/local-memo-store';
import { createLocalMemoController } from '../../src/local-memo-controller';
import { NEW_STORAGE_KEY } from '../../src/local-migration';
import type { LocalLockManager } from '../../src/local-lock';
import { createLocalRestoreController } from '../../src/local-restore-controller';
import { createDeletedRecoveryController } from '../../src/deleted-recovery-controller';

const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2026-10-26T00:00:00Z';

/** ブラウザ保存APIを参照しない合成保存先。ページを閉じればすべて失われる。 */
export function createPreviewEnvironment(scenario: string) {
  const deletion = scenario.startsWith('delete') || scenario.startsWith('recovery') || scenario === 'backup' || scenario === 'restore-slow';
  let raw = JSON.stringify({ version: deletion ? 3 : 2, ...(deletion ? { deletedMemoIds: scenario === 'recovery-quota' ? [id(99), id(98)] : scenario === 'backup' || scenario.startsWith('recovery') ? [id(99)] : [] } : {}), migration: { status: 'not-required' },
    memos: Array.from({ length: 12 }, (_, i) => ({ id: id(i + 1), title: i === 0 ? '仕事メモ' : `合成メモ ${i + 1}`,
      body: i === 0 ? '入力・保存・ドラフト保護を検証します。' : '合成データだけを使います。',
      createdAt: now, updatedAt: now, pinnedAt: i === 0 ? now : null, deletedAt: deletion && (i === 1 || i === 2) ? now : null, revision: 1, lastRequestId: null })),
    tags: [{ id: id(50), name: '仕事', createdAt: now, revision: 1 }, { id: id(51), name: '個人', createdAt: now, revision: 1 }],
    memoTags: [{ memoId: id(1), tagId: id(50) }] });
  let written = false;
  const storage = {
    getItem(key: string): string | null {
      if (key !== NEW_STORAGE_KEY) return null;
      if (scenario === 'delete-readback' && written) throw new Error('Synthetic readback');
      if (scenario === 'recovery-unreadable' && written) throw new Error('Synthetic readback');
      return raw;
    },
    setItem(key: string, value: string) {
      if (key !== NEW_STORAGE_KEY) throw new Error('Unexpected synthetic key');
      if (scenario === 'delete-quota' || scenario === 'recovery-quota') throw new Error('Synthetic quota');
      raw = value; written = true;
      if (scenario === 'unknown' || scenario === 'delete-unknown' || scenario === 'recovery-unknown' || scenario === 'recovery-unreadable') throw new Error('Synthetic unknown write');
    },
  };
  // 実Web Locksではない。単一ページの合成操作だけを直列化する。
  let tail: Promise<unknown> = Promise.resolve();
  const locks: LocalLockManager = { request(_name, _options, operation) {
    const next = tail.then(operation); tail = next.catch(() => undefined); return next;
  } };
  const base = createLocalMemoStore({ storage, locks, now: () => now });
  const store: typeof base = { ...base,
    async recoverDeleted(input) {
      if (scenario === 'recovery-slow') await new Promise(resolve => setTimeout(resolve, 500));
      return base.recoverDeleted(input);
    },
    async prepareRestore(...args) {
      if (scenario === 'restore-slow') await new Promise(resolve => setTimeout(resolve, 1200));
      return base.prepareRestore(...args);
    }, async applyRestore(...args) {
      if (scenario === 'restore-slow') await new Promise(resolve => setTimeout(resolve, 1200));
      return base.applyRestore(...args);
    },
    async deletePermanently(input) {
      if (scenario === 'delete-slow') await new Promise(resolve => setTimeout(resolve, 600));
      return base.deletePermanently(input);
    }, async emptyTrash(input) {
      if (scenario === 'delete-slow') await new Promise(resolve => setTimeout(resolve, 600));
      return base.emptyTrash(input);
    }, async load() {
    if (scenario === 'slow-load') await new Promise(resolve => setTimeout(resolve, 300));
    // 保存直後の読戻し検証は成功させ、確定成功後の別loadだけを失敗させる。
    if (scenario === 'reload-failure' && written) return { kind: 'unavailable', reason: 'storage-failure' };
    return base.load();
  }, async save(input) {
    if (scenario === 'slow') await new Promise(resolve => setTimeout(resolve, 600));
    if (scenario === 'rejected') return { kind: 'rejected', reason: 'conflict', writeOutcome: 'not-attempted' };
    return base.save(input);
  }, async changeState(input) {
    if (scenario === 'slow-mutation') await new Promise(resolve => setTimeout(resolve, 300));
    return base.changeState(input);
  }, async saveTag(input) {
    if (scenario === 'slow-mutation') await new Promise(resolve => setTimeout(resolve, 300));
    return base.saveTag(input);
  }, async deleteTag(input) {
    if (scenario === 'slow-mutation') await new Promise(resolve => setTimeout(resolve, 300));
    return base.deleteTag(input);
  } };
  let sequence = 100;
  const controller = createLocalMemoController({ store, createId: () => id(++sequence) });
  const canStart = () => {
    const state = controller.getState(); return !state.editor && state.write.kind !== 'writing' && state.read.kind === 'ready' && !state.confirmation;
  };
  return { controller, recovery: createDeletedRecoveryController({ store, createId: () => id(++sequence), canStart,
    openCreated: async id => {
      await controller.dispatch({ kind: 'load' });
      if (controller.getState().read.kind !== 'ready') return false;
      const result = await controller.dispatch({ kind: 'detail', id });
      const route = controller.getState().route;
      return result.kind === 'done' && route.kind === 'detail' && route.id === id;
    } }), restore: createLocalRestoreController({ store, createId: () => id(++sequence), canStart }),
    migration: { storage, locks, createId: () => id(++sequence) } };
}

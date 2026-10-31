import { diagnoseBackup } from './local-restore';
import type { RestoreBackup } from './local-restore';
import type { MemoStorageV3 } from './local-format';
import type { createLocalMemoStore } from './local-memo-store';
import { BackupInputError } from './backup-json';
import { immutable } from './editor-state';

type Store = ReturnType<typeof createLocalMemoStore>;
export type RestoreCommand = { kind: 'file'; bytes: Uint8Array } | { kind: 'select'; indexes: number[]; selected: boolean }
  | { kind: 'page'; page: number } | { kind: 'prepare' } | { kind: 'confirm' } | { kind: 'cancel' } | { kind: 'inspect' } | { kind: 'reset' };
export interface RestoreState {
  phase: 'idle' | 'reading' | 'review' | 'confirmation' | 'writing' | 'applied' | 'unknown' | 'failed';
  backup: RestoreBackup | null; current: MemoStorageV3 | null; selected: number[]; page: number;
  message: string; summary: { memos: number; tags: number } | null;
}
/** ファイル・選択の変更で固定候補を失効させ、書込は確認済みの一回に限定する。 */
export function createLocalRestoreController(deps: { store: Store; createId: () => string; canStart?: () => boolean }) {
  const store = deps.store;
  let state: RestoreState = immutable({ phase: 'idle', backup: null, current: null, selected: [], page: 0, message: '', summary: null });
  let token: number | null = null;
  const patch = (part: Partial<RestoreState>) => { state = immutable({ ...state, ...part }); };
  const invalidate = () => { token = null; store.invalidateRestore(); };
  return {
    getState: () => state,
    async dispatch(command: RestoreCommand): Promise<void> {
      if (state.phase === 'writing' || state.phase === 'reading') return;
      if (command.kind === 'reset') { invalidate(); patch({ phase: 'idle', backup: null, current: null, selected: [], page: 0, summary: null, message: '' }); return; }
      if (deps.canStart && !deps.canStart()) { patch({ message: '通常画面の編集・保存・確認を終了してください。' }); return; }
      let applying = false;
      try {
        if (command.kind === 'cancel') { if (state.phase !== 'confirmation') return; invalidate(); patch({ phase: 'review', summary: null, message: '確認をキャンセルしました。書込はありません。' }); return; }
        if (command.kind === 'file') {
          invalidate(); patch({ phase: 'reading', backup: null, current: null, selected: [], page: 0, summary: null, message: '' });
          const backup = diagnoseBackup(command.bytes.slice());
          const loaded = await store.load();
          if (loaded.kind !== 'loaded' || loaded.value.version !== 3) throw new BackupInputError('v3-required-or-unavailable');
          patch({ phase: 'review', backup, current: loaded.value, message: '正常行を選択してください。元ID重複行には同じ正常タグ関連を適用します。' }); return;
        }
        if (command.kind === 'inspect') {
          if (state.phase !== 'unknown') return;
          invalidate(); patch({ phase: 'reading' }); const result = await store.load();
          patch({ phase: 'unknown', message: result.kind === 'loaded' ? '現在のデータを読めました。過去の書込成功は確定しません。新しいファイル診断・確認から再操作してください。重複する可能性があります。'
            : '現在状態を確認できません。復元結果は不明です。' }); return;
        }
        if (!state.backup || !state.current) return;
        if (command.kind === 'page') {
          if (state.phase === 'confirmation' || state.phase === 'unknown' || state.phase === 'applied') return;
          if (Number.isInteger(command.page) && command.page >= 0 && command.page < Math.max(1, Math.ceil(state.backup.rows.length / 50))) patch({ page: command.page }); return;
        }
        if (command.kind === 'select') {
          if (state.phase !== 'review') return;
          invalidate(); const selected = new Set(state.selected);
          for (const index of command.indexes) if (state.backup.rows[index]?.memo) command.selected ? selected.add(index) : selected.delete(index);
          patch({ selected: [...selected].sort((a, b) => a - b), summary: null }); return;
        }
        if (command.kind === 'prepare') {
          if (state.phase !== 'review' || !state.selected.length) return;
          patch({ phase: 'reading' });
          const plan = await store.prepareRestore(state.backup, state.selected, deps.createId, state.current);
          token = plan.token; patch({ phase: 'confirmation', summary: { memos: plan.memos, tags: plan.tags }, message: '対象と追加件数を確認してください。' }); return;
        }
        if (command.kind === 'confirm') {
          if (state.phase !== 'confirmation' || token === null) return;
          const accepted = token; token = null; patch({ phase: 'writing', message: '復元を書き込んでいます…' });
          const requestId = deps.createId(); applying = true;
          const result = await store.applyRestore({ token: accepted, requestId });
          patch({ phase: result.kind === 'written' ? 'applied' : result.kind === 'unknown' ? 'unknown' : 'failed',
            message: result.kind === 'written' ? '追加型復元が成功しました。通常一覧は再読込してください。' : result.kind === 'unknown'
              ? '復元結果は不明です。自動再送しません。保存状況を再確認してください。' : `書込前に停止しました（${'reason' in result ? result.reason : 'invalid-state'}）。再診断・再確認が必要です。` });
        }
      } catch (error) {
        invalidate();
        patch({ phase: applying ? 'unknown' : 'failed', message: applying ? '復元結果は不明です。自動再送しません。'
          : `操作を停止しました（${error instanceof BackupInputError ? error.code : 'validation-or-storage'}）。保存領域は変更していません。` });
      }
    },
  };
}

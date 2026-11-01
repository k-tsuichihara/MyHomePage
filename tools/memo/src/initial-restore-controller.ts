import { immutable } from './editor-state';
import { parseInitialBackup } from './initial-restore';
import { BackupInputError } from './backup-json';
import type { RestoreV3 } from './local-restore';
import type { createLocalMemoStore } from './local-memo-store';

type Store = Pick<ReturnType<typeof createLocalMemoStore>, 'prepareInitial' | 'applyInitial' | 'invalidateInitial' | 'inspectInitial'>;
export type InitialCommand = { kind: 'file'; bytes: Uint8Array } | { kind: 'inspect' } | { kind: 'prepare' }
  | { kind: 'confirm'; generation: number } | { kind: 'cancel' } | { kind: 'leave' };
export interface InitialState {
  phase: 'idle' | 'reading' | 'preview' | 'confirmation' | 'writing' | 'unknown' | 'success' | 'blocked'; generation: number;
  observed: 'none' | 'absent' | 'v3' | 'occupied' | 'unavailable'; candidate: RestoreV3 | null; exportedAt: string;
  hadUnknown: boolean; result: 'none' | 'rejected' | 'unknown' | 'written'; message: string; navigation: 'none' | 'opened' | 'failed';
}
/** 過去のunknownを現在状態や後続拒否で消さない。候補・確認材料はタブのメモリ内だけ。 */
export function createInitialRestoreController(deps: { store: Store; createId: () => string; canStart?: () => boolean; openNormal?: () => Promise<boolean> }) {
  // 確認中に呼出元の依存オブジェクトを書き換えても別ストアへ適用させない。
  deps = { ...deps };
  let state: InitialState = immutable({ phase: 'idle', generation: 0, observed: 'none', candidate: null, exportedAt: '',
    hadUnknown: false, result: 'none', message: '', navigation: 'none' });
  let bytes: Uint8Array | null = null, token: number | null = null;
  const patch = (part: Partial<InitialState>) => { state = immutable({ ...state, ...part }); };
  const invalidate = () => { token = null; deps.store.invalidateInitial(); patch({ generation: state.generation + 1 }); };
  const busy = () => state.phase === 'reading' || state.phase === 'writing';
  return {
    getState: () => state,
    async dispatch(command: InitialCommand): Promise<void> {
      if (busy()) return;
      if (deps.canStart && !deps.canStart()) { patch({ message: '通常画面の編集・保存・確認を終了してください。' }); return; }
      let attempted = false;
      try {
        if (command.kind === 'cancel' || command.kind === 'leave') {
          invalidate();
          if (command.kind === 'leave') { bytes = null; patch({ candidate: null, exportedAt: '' }); }
          patch({ phase: bytes ? 'preview' : 'idle', message: '初期復元の画面操作を中止しました。この操作による書込はありません。' }); return;
        }
        if (command.kind === 'file') {
          invalidate(); bytes = null;
          patch({ phase: 'reading', candidate: null, exportedAt: '', navigation: 'none', observed: 'none' });
          const accepted = command.bytes.slice(), parsed = parseInitialBackup(accepted);
          bytes = accepted;
          patch({ phase: 'preview', candidate: parsed.candidate, exportedAt: parsed.exportedAt, message: '全件の内容・件数と復元の限界を確認してください。' }); return;
        }
        if (command.kind === 'inspect') {
          invalidate(); patch({ phase: 'reading', observed: 'none' });
          const observation = await deps.store.inspectInitial();
          patch({ phase: state.hadUnknown ? 'unknown' : bytes ? 'preview' : 'idle', observed: observation.kind,
            message: observation.kind === 'absent' ? '現在は新旧キーが両方ありません。過去の未保存を証明するものではありません。'
              : observation.kind === 'v3' ? '現在の正常v3を確認しました。過去の初期復元成功を証明するものではありません。初期復元はできません。'
              : '保存先が存在するか読取不能です。初期復元はできません。' }); return;
        }
        if (command.kind === 'prepare') {
          if (!bytes || !state.candidate || (state.hadUnknown && state.observed !== 'absent')) return;
          invalidate(); patch({ phase: 'reading', navigation: 'none' });
          const plan = await deps.store.prepareInitial(bytes);
          token = plan.token; patch({ phase: 'confirmation', candidate: plan.candidate, exportedAt: plan.exportedAt, message: '専用確認：このバックアップ全体を初期復元しますか？' }); return;
        }
        if (command.kind === 'confirm') {
          if (state.phase !== 'confirmation' || token === null || command.generation !== state.generation) return;
          const accepted = token; token = null; patch({ phase: 'writing', generation: state.generation + 1, observed: 'none', navigation: 'none', message: '初期復元を書き込んでいます…' });
          const requestId = deps.createId(); attempted = true;
          const result = await deps.store.applyInitial({ token: accepted, requestId });
          if (result.kind === 'written') {
            patch({ result: 'written', message: '初期復元の書込と読戻しを確認しました。' });
            try { patch({ navigation: await deps.openNormal?.() ? 'opened' : 'failed' }); } catch { patch({ navigation: 'failed' }); }
            patch({ phase: 'success' }); return;
          }
          invalidate(); patch({ phase: result.kind === 'unknown' ? 'unknown' : 'blocked', result: result.kind === 'unknown' ? 'unknown' : 'rejected',
            hadUnknown: state.hadUnknown || result.kind === 'unknown', message: result.kind === 'unknown'
              ? '初期復元の結果は不明です。自動再診断・自動再書込はしません。保存状況を手動で確認してください。'
              : '書込前に中止しました。この試行は未書込です。保存先を再診断し、新しい確認が必要です。' });
        }
      } catch (error) {
        invalidate(); patch({ phase: attempted ? 'unknown' : 'blocked', observed: 'none', result: attempted ? 'unknown' : 'rejected', hadUnknown: state.hadUnknown || attempted,
          message: attempted ? '初期復元の結果は不明です。手動で保存状況を確認してください。' : `初期復元を停止しました（${error instanceof BackupInputError ? error.code : 'validation-or-storage'}）。書込はありません。` });
      }
    },
  };
}

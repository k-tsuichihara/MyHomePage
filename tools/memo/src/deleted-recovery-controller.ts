import { immutable } from './editor-state';
import { diagnoseBackup } from './local-restore';
import type { RestoreBackup, RestoreV3 } from './local-restore';
import { canRecover, recoverableTags } from './deleted-recovery';
import { uuid, uuidKey } from './read-primitives';
import { validateLocalV3 } from './local-format';
import type { createLocalMemoStore } from './local-memo-store';

type Store = Pick<ReturnType<typeof createLocalMemoStore>, 'load' | 'recoverDeleted'>;
export type RecoveryCommand = { kind: 'file'; bytes: Uint8Array } | { kind: 'page'; page: number } | { kind: 'select'; index: number }
  | { kind: 'restore' } | { kind: 'retry' } | { kind: 'inspect' } | { kind: 'back' } | { kind: 'source' };
export interface RecoveryState {
  phase: 'idle' | 'reading' | 'list' | 'preview' | 'writing' | 'diagnosing' | 'opening' | 'created' | 'unknown' | 'failed';
  outcome: 'none' | 'created' | 'not-saved' | 'unknown';
  backup: RestoreBackup | null; current: RestoreV3 | null; selected: number | null; page: number; tagIds: string[];
  newId: string | null; unresolvedIds: string[]; message: string; navigation: 'none' | 'opened' | 'failed';
  uncertainSourceIds: string[];
}
/** 単件回復固有の3状態と一時UUIDを管理する。Step 3の結果判定は変更しない。 */
export function createDeletedRecoveryController(deps: { store: Store; createId: () => string; canStart?: () => boolean;
  openCreated?: (id: string) => Promise<boolean> }) {
  let state: RecoveryState = immutable({ phase: 'idle', outcome: 'none', backup: null, current: null, selected: null, page: 0,
    tagIds: [], newId: null, unresolvedIds: [], uncertainSourceIds: [], message: '', navigation: 'none' });
  const patch = (part: Partial<RecoveryState>) => { state = immutable({ ...state, ...part }); };
  const busy = () => ['reading', 'writing', 'diagnosing', 'opening'].includes(state.phase);
  const readFailed = (reason: string) => {
    patch({ current: null, message: `${reason}に失敗しました。${state.outcome === 'unknown' ? '復元結果は不明です。' : '保存は行いません。'}` });
    return null;
  };
  async function readCurrent(): Promise<RestoreV3 | null> {
    let loaded;
    try { loaded = await deps.store.load(); }
    catch { return readFailed('読取'); }
    if (loaded.kind === 'loaded' && loaded.value.version === 3) {
      try {
        const checked = validateLocalV3(loaded.value);
        if (checked.kind !== 'validated-pending') return checked.value as RestoreV3;
      } catch { return readFailed('整合性確認'); }
    }
    const reason = loaded.kind === 'unavailable' && loaded.reason === 'invalid-data' ? '整合性確認' : '読取';
    return readFailed(reason);
  }
  async function created() {
    patch({ phase: 'opening', outcome: 'created', message: 'メモの作成を確認しました。', navigation: 'none' });
    // 読込・画面遷移の失敗で、確認済みの作成結果を書き換えない。
    try { patch({ navigation: await deps.openCreated?.(state.newId!) ? 'opened' : 'failed' }); }
    catch { patch({ navigation: 'failed' }); }
    patch({ phase: 'created' });
  }
  async function inspect() {
    patch({ phase: 'diagnosing', message: '保存状況を確認しています…' });
    const current = await readCurrent();
    if (current && state.newId && current.memos.some(memo => uuidKey(memo.id) === uuidKey(state.newId!))) {
      patch({ current }); await created();
    } else patch({ phase: 'unknown', outcome: 'unknown', current, message: current
      ? '現在の新UUIDを確認できません。復元結果は不明です。自動再送しません。' : state.message });
  }
  return {
    getState: () => state,
    async dispatch(command: RecoveryCommand): Promise<void> {
      if (busy()) return;
      if (deps.canStart && !deps.canStart()) { patch({ message: '通常画面の編集・保存・確認を終了してください。' }); return; }
      let attempted = false;
      try {
        if (command.kind === 'inspect') { if (state.phase === 'unknown') await inspect(); return; }
        if (command.kind === 'back') {
          // 再診断用UUIDを引き継ぐ保証とは別に、同じ元メモの再選択時に注意を残す。
          const sourceId = state.phase === 'unknown' ? state.backup?.rows[state.selected!]?.memo?.id : undefined;
          const uncertainSourceIds = sourceId && !state.uncertainSourceIds.some(id => uuidKey(id) === uuidKey(sourceId))
            ? [...state.uncertainSourceIds, sourceId] : state.uncertainSourceIds;
          patch({ phase: state.backup ? 'list' : 'idle', selected: null, tagIds: [], newId: null, uncertainSourceIds, navigation: 'none', message: '' }); return;
        }
        if (command.kind === 'source') {
          if (state.phase !== 'created') return;
          patch({ phase: 'reading' });
          const current = await readCurrent(), row = state.backup?.rows[state.selected!];
          if (current && row && canRecover(row, current)) patch({ phase: 'preview', current, tagIds: recoverableTags(row.tagIds, current), outcome: 'none', newId: null, navigation: 'none', message: '' });
          else patch({ phase: 'created', outcome: 'created', navigation: 'failed', message: 'メモの作成は確認済みです。元プレビューを再表示できませんでした。' });
          return;
        }
        if (command.kind === 'file') {
          patch({ phase: 'reading', backup: null, current: null, selected: null, page: 0, tagIds: [], newId: null, uncertainSourceIds: [], outcome: 'none', navigation: 'none', message: '' });
          const backup = diagnoseBackup(command.bytes.slice());
          const current = await readCurrent();
          patch({ backup, current, phase: current ? 'list' : 'failed' }); return;
        }
        if (!state.backup || !state.current) {
          // unknownの再復元でも再読取できなければ書かない。
          if (command.kind !== 'retry' || !state.backup || state.phase !== 'unknown') return;
        }
        if (command.kind === 'page') {
          if (state.phase === 'list' && Number.isInteger(command.page) && command.page >= 0 && command.page * 50 < state.backup!.rows.length) patch({ page: command.page }); return;
        }
        if (command.kind === 'select') {
          if (state.phase !== 'list') return;
          const row = state.backup!.rows[command.index];
          if (!row || !canRecover(row, state.current!)) return;
          patch({ phase: 'preview', selected: command.index, tagIds: recoverableTags(row.tagIds, state.current!), outcome: 'none', newId: null, message: '', navigation: 'none' }); return;
        }
        if (command.kind !== 'restore' && command.kind !== 'retry') return;
        if (command.kind === 'restore' ? state.phase !== 'preview' : state.phase !== 'unknown') return;
        const row = state.backup!.rows[state.selected!]; if (!row?.memo) return;
        if (command.kind === 'retry') {
          // 独立した新操作でも全条件を再確認。壊れた保存先を初期化しない。
          patch({ phase: 'reading' }); const current = await readCurrent();
          if (!current) { patch({ phase: 'unknown' }); return; }
          patch({ current });
        }
        const id = uuid(deps.createId()), requestId = uuid(deps.createId());
        const previous = state.outcome === 'unknown' && state.newId ? [...state.unresolvedIds, state.newId] : state.unresolvedIds;
        patch({ phase: 'writing', newId: id, unresolvedIds: previous, outcome: 'none', message: '新しいメモとして復元しています…', navigation: 'none' });
        attempted = true;
        const result = await deps.store.recoverDeleted({ source: row.memo, sourceTags: row.tagIds, expectedTags: state.tagIds, id, requestId });
        if (result.kind === 'saved') { await created(); return; }
        if (result.kind === 'unknown') { patch({ outcome: 'unknown' }); await inspect(); return; }
        patch({ outcome: 'not-saved', phase: 'reading', message: `書込前に中止しました（${result.reason}）。未保存です。` });
        const message = state.message, current = await readCurrent();
        patch({ current, phase: current && canRecover(row, current) ? 'preview' : 'failed',
          tagIds: current ? recoverableTags(row.tagIds, current) : [],
          message: current ? `${message}最新プレビューを確認してから改めて操作してください。` : state.message });
      } catch {
        if (attempted) { patch({ outcome: 'unknown' }); try { await inspect(); } catch { patch({ phase: 'unknown', message: '再診断に失敗しました。復元結果は不明です。' }); } }
        else patch({ phase: state.outcome === 'unknown' ? 'unknown' : 'failed', message: '入力または読取を検証できないため停止しました。書込は行いません。' });
      }
    },
  };
}

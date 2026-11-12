export type StorageTarget = 'local' | 'cloud';

export type StorageTargetState = Readonly<{
  target: StorageTarget;
  dirty: boolean;
  generation: number | null;
}>;

export type StorageTargetDecision =
  | { kind: 'changed'; state: StorageTargetState }
  | { kind: 'confirmation-required'; from: StorageTarget; to: StorageTarget; expectedGeneration: number | null; expectedRevision: number; state: StorageTargetState }
  | { kind: 'cancelled'; state: StorageTargetState }
  | { kind: 'rejected'; reason: 'not-authenticated' | 'stale-generation' | 'stale-confirmation' | 'invalid-target'; state: StorageTargetState };

export type StorageTargetAuth = Readonly<{
  authenticated: boolean;
  generation: number;
}>;
export type StorageLeaveDecision =
  | { kind: 'allowed' }
  | { kind: 'confirmation-required'; reason: 'unsaved' | 'unknown' | 'rejected' }
  | { kind: 'blocked'; reason: 'saving' | 'stale-confirmation' };

function snapshot(target: StorageTarget, dirty: boolean, generation: number | null): StorageTargetState {
  return Object.freeze({ target, dirty, generation });
}

/**
 * UI・同期・RPCから独立した保存先状態の制御層。
 * 切替は状態だけを変更し、upload/download/syncは一切開始しない。
 */
export function createStorageTargetController() {
  let state: StorageTargetState = snapshot('local', false, null);
  let revision = 0;

  const current = () => state;
  const setDirty = (dirty: boolean): StorageTargetState => {
    revision += 1;
    state = snapshot(state.target, dirty, state.generation);
    return state;
  };

  const request = (target: StorageTarget, auth: StorageTargetAuth | null, leave: StorageLeaveDecision): StorageTargetDecision => {
    if (target !== 'local' && target !== 'cloud') return { kind: 'rejected', reason: 'invalid-target', state };
    if (target === 'cloud' && (!auth?.authenticated || !Number.isInteger(auth.generation) || auth.generation < 0)) {
      return { kind: 'rejected', reason: 'not-authenticated', state };
    }
    if (target === 'cloud' && state.target === 'cloud' && state.generation !== auth!.generation) {
      return { kind: 'rejected', reason: 'stale-generation', state };
    }
    if (state.target === target && (target !== 'cloud' || state.generation === auth?.generation)) return { kind: 'changed', state };
    if (leave.kind === 'blocked') return { kind: 'rejected', reason: leave.reason === 'saving' ? 'stale-confirmation' : 'stale-confirmation', state };
    if (leave.kind === 'confirmation-required') return { kind: 'confirmation-required', from: state.target, to: target,
      expectedGeneration: target === 'cloud' ? auth!.generation : null, expectedRevision: revision, state };
    if (state.dirty) return { kind: 'confirmation-required', from: state.target, to: target,
      expectedGeneration: target === 'cloud' ? auth!.generation : null, expectedRevision: revision, state };
    state = snapshot(target, false, target === 'cloud' ? auth!.generation : null);
    return { kind: 'changed', state };
  };

  const confirm = (decision: Extract<StorageTargetDecision, { kind: 'confirmation-required' }>, proceed: boolean,
    auth: StorageTargetAuth | null, leave: StorageLeaveDecision): StorageTargetDecision => {
    if (!proceed) return { kind: 'cancelled', state };
    if (leave.kind === 'blocked') return { kind: 'rejected', reason: 'stale-confirmation', state };
    if (state.target !== decision.from || revision !== decision.expectedRevision) {
      return { kind: 'rejected', reason: 'stale-confirmation', state };
    }
    if (decision.to === 'cloud'
      && (!auth?.authenticated || auth.generation !== decision.expectedGeneration)) {
      return { kind: 'rejected', reason: 'stale-generation', state };
    }
    state = snapshot(decision.to, false, decision.to === 'cloud' ? auth!.generation : null);
    return { kind: 'changed', state };
  };

  const logout = (leave: StorageLeaveDecision): StorageTargetDecision => {
    if (leave.kind === 'blocked') return { kind: 'rejected', reason: 'stale-confirmation', state };
    if (leave.kind === 'confirmation-required' || state.dirty) return { kind: 'confirmation-required', from: state.target, to: 'local',
      expectedGeneration: null, expectedRevision: revision, state };
    state = snapshot('local', false, null);
    return { kind: 'changed', state };
  };
  const acceptAuthenticatedGeneration = (auth: StorageTargetAuth): StorageTargetState => {
    if (state.target === 'cloud' && auth.authenticated && Number.isInteger(auth.generation) && auth.generation >= 0) {
      state = snapshot('cloud', state.dirty, auth.generation);
    }
    return state;
  };

  return Object.freeze({ current, setDirty, request, confirm, logout, acceptAuthenticatedGeneration });
}

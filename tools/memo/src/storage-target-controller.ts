export type StorageTarget = 'local' | 'cloud';

export type StorageTargetState = Readonly<{
  target: StorageTarget;
  dirty: boolean;
  generation: number | null;
}>;

export type StorageTargetDecision =
  | { kind: 'changed'; state: StorageTargetState }
  | { kind: 'confirmation-required'; from: StorageTarget; to: StorageTarget; state: StorageTargetState }
  | { kind: 'cancelled'; state: StorageTargetState }
  | { kind: 'rejected'; reason: 'not-authenticated' | 'stale-generation' | 'invalid-target'; state: StorageTargetState };

export type StorageTargetAuth = Readonly<{
  authenticated: boolean;
  generation: number;
}>;

function snapshot(target: StorageTarget, dirty: boolean, generation: number | null): StorageTargetState {
  return Object.freeze({ target, dirty, generation });
}

/**
 * UI・同期・RPCから独立した保存先状態の制御層。
 * 切替は状態だけを変更し、upload/download/syncは一切開始しない。
 */
export function createStorageTargetController(initial: StorageTarget = 'local') {
  let state: StorageTargetState = snapshot(initial, false, null);

  const current = () => state;
  const setDirty = (dirty: boolean): StorageTargetState => {
    state = snapshot(state.target, dirty, state.generation);
    return state;
  };

  const request = (target: StorageTarget, auth: StorageTargetAuth | null): StorageTargetDecision => {
    if (target !== 'local' && target !== 'cloud') return { kind: 'rejected', reason: 'invalid-target', state };
    if (target === 'cloud' && (!auth?.authenticated || !Number.isInteger(auth.generation) || auth.generation < 0)) {
      return { kind: 'rejected', reason: 'not-authenticated', state };
    }
    if (target === 'cloud' && state.target === 'cloud' && state.generation !== auth!.generation) {
      return { kind: 'rejected', reason: 'stale-generation', state };
    }
    if (state.target === target && (target !== 'cloud' || state.generation === auth?.generation)) return { kind: 'changed', state };
    if (state.dirty) return { kind: 'confirmation-required', from: state.target, to: target, state };
    state = snapshot(target, false, target === 'cloud' ? auth!.generation : null);
    return { kind: 'changed', state };
  };

  const confirm = (decision: Extract<StorageTargetDecision, { kind: 'confirmation-required' }>, proceed: boolean,
    auth: StorageTargetAuth | null): StorageTargetDecision => {
    if (!proceed) return { kind: 'cancelled', state };
    if (state.target !== decision.from || !state.dirty || (decision.to === 'cloud' && !auth?.authenticated)) {
      return { kind: 'rejected', reason: 'stale-generation', state };
    }
    state = snapshot(decision.to, false, decision.to === 'cloud' ? auth!.generation : null);
    return { kind: 'changed', state };
  };

  const logout = (): StorageTargetState => { state = snapshot('local', state.dirty, null); return state; };
  const authExpired = (generation: number): StorageTargetState => {
    if (state.target === 'cloud' && state.generation === generation) state = snapshot('local', state.dirty, null);
    return state;
  };

  return Object.freeze({ current, setDirty, request, confirm, logout, authExpired });
}

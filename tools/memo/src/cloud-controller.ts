import { createCloudRpcAdapter } from './cloud-rpc-adapter';
import type { AuthContext, AuthRpcPreparation } from './auth-session';
import type { CloudResult, CloudSaveInput } from './cloud-rpc-types';
import { uuidKey } from './read-primitives';

type CloudAdapter = ReturnType<typeof createCloudRpcAdapter>;
export type CloudLoadResult = Awaited<ReturnType<CloudAdapter['load']>>;
export type CloudSaveResult = Awaited<ReturnType<CloudAdapter['save']>>;
export type CloudResolveResult = Awaited<ReturnType<CloudAdapter['resolve']>>;

export interface CloudAuthBoundary {
  isCurrent(context: AuthContext): boolean;
  prepareRpc(context: AuthContext): Promise<AuthRpcPreparation>;
}

export interface PendingCloudSave {
  readonly ownerId: string;
  readonly authGeneration: number;
  readonly input: CloudSaveInput;
}

type CloudControlResult<T> =
  | { readonly kind: 'completed'; readonly result: T }
  | { readonly kind: 'stopped'; readonly reason: 'auth-not-current' | 'auth-unavailable' | 'owner-mismatch'
    | 'invalid-pending' | 'request-closed' | 'disposed' }
  | { readonly kind: 'busy' };

export type CloudLoadControlResult = CloudControlResult<CloudLoadResult>
  | { readonly kind: 'stale-response' };

export type CloudSaveControlResult = CloudControlResult<CloudSaveResult>
  | { readonly kind: 'stale-response'; readonly pending: PendingCloudSave }
  | { readonly kind: 'unresolved'; readonly result: CloudSaveResult; readonly pending: PendingCloudSave };

export type CloudResolveControlResult =
  | CloudControlResult<CloudResolveResult>
  | { readonly kind: 'stale-response'; readonly pending: PendingCloudSave }
  | { readonly kind: 'diagnosed'; readonly result: CloudResolveResult; readonly pending: PendingCloudSave;
    readonly pendingActive: boolean }
  | { readonly kind: 'unresolved'; readonly result: CloudResolveResult; readonly pending: PendingCloudSave };

function freezeSaveInput(input: CloudSaveInput): CloudSaveInput {
  return Object.freeze({
    memoId: input.memoId,
    title: input.title,
    body: input.body,
    tagIds: Object.freeze([...input.tagIds]),
    expectedRevision: input.expectedRevision,
    requestId: input.requestId,
  });
}

/**
 * C01のRPC結果を変更せず、現在の認証世代にだけ結果を反映するUI非依存境界。
 * 結果不明の保存は自動再送せず、同じ要求を明示resolveへ渡す。
 */
export function createCloudController(auth: CloudAuthBoundary) {
  let busy = false;
  let disposed = false;
  const pendingSaves = new WeakMap<object, 'pending' | 'closed'>();

  const stopped = (preparation: Exclude<AuthRpcPreparation, { readonly kind: 'ready' }>): CloudControlResult<never> => ({
    kind: 'stopped',
    reason: preparation.reason === 'not-current' ? 'auth-not-current'
      : preparation.reason === 'unavailable' ? 'auth-unavailable' : 'owner-mismatch',
  });

  async function prepare(context: AuthContext) {
    if (!auth.isCurrent(context)) return { kind: 'stopped', reason: 'not-current' } as const;
    const preparation = await auth.prepareRpc(context);
    return preparation;
  }

  function makePending(context: AuthContext, input: CloudSaveInput): PendingCloudSave {
    const pending = Object.freeze({ ownerId: context.userId, authGeneration: context.generation, input });
    pendingSaves.set(pending, 'pending');
    return pending;
  }

  async function exclusive<T>(operation: () => Promise<T>): Promise<T | { readonly kind: 'busy' }> {
    if (busy) return { kind: 'busy' };
    busy = true;
    try { return await operation(); }
    finally { busy = false; }
  }

  return Object.freeze({
    async load(context: AuthContext): Promise<CloudLoadControlResult> {
      return exclusive(async () => {
        if (disposed) return { kind: 'stopped', reason: 'disposed' } as const;
        const preparation = await prepare(context);
        if (preparation.kind !== 'ready') return stopped(preparation);
        const result = await createCloudRpcAdapter(preparation.ownerId, preparation.transport).load();
        if (!preparation.wasSent()) return { kind: 'stopped', reason: 'auth-not-current' } as const;
        if (disposed || !auth.isCurrent(context)) return { kind: 'stale-response' } as const;
        return { kind: 'completed', result } as const;
      });
    },

    async save(context: AuthContext, input: CloudSaveInput): Promise<CloudSaveControlResult> {
      const frozen = freezeSaveInput(input);
      return exclusive(async () => {
        if (disposed) return { kind: 'stopped', reason: 'disposed' } as const;
        const preparation = await prepare(context);
        if (preparation.kind !== 'ready') return stopped(preparation);
        if (uuidKey(preparation.ownerId) !== uuidKey(context.userId)) {
          return { kind: 'stopped', reason: 'owner-mismatch' } as const;
        }
        const result = await createCloudRpcAdapter(preparation.ownerId, preparation.transport).save(frozen);
        if (!preparation.wasSent() && result.kind !== 'not-attempted') {
          return { kind: 'stopped', reason: 'auth-not-current' } as const;
        }
        if (disposed || !auth.isCurrent(context)) {
          return preparation.wasSent()
            ? { kind: 'stale-response', pending: makePending(context, frozen) } as const
            : { kind: 'stopped', reason: disposed ? 'disposed' : 'auth-not-current' } as const;
        }
        if (result.kind === 'unknown') {
          return { kind: 'unresolved', result, pending: makePending(context, frozen) } as const;
        }
        return { kind: 'completed', result } as const;
      });
    },

    async resolve(context: AuthContext, pending: PendingCloudSave): Promise<CloudResolveControlResult> {
      return exclusive(async () => {
        if (disposed) return { kind: 'stopped', reason: 'disposed' } as const;
        const pendingState = pendingSaves.get(pending);
        if (!pendingState) return { kind: 'stopped', reason: 'invalid-pending' } as const;
        if (pendingState === 'closed') return { kind: 'stopped', reason: 'request-closed' } as const;
        if (uuidKey(pending.ownerId) !== uuidKey(context.userId)) return { kind: 'stopped', reason: 'owner-mismatch' } as const;
        const preparation = await prepare(context);
        if (preparation.kind !== 'ready') return stopped(preparation);
        if (uuidKey(preparation.ownerId) !== uuidKey(pending.ownerId)) {
          return { kind: 'stopped', reason: 'owner-mismatch' } as const;
        }
        const result = await createCloudRpcAdapter(preparation.ownerId, preparation.transport).resolve(pending.input);
        if (!preparation.wasSent() && result.kind !== 'not-attempted') {
          return { kind: 'stopped', reason: 'auth-not-current' } as const;
        }
        if (disposed || !auth.isCurrent(context)) return preparation.wasSent()
          ? { kind: 'stale-response', pending } as const
          : { kind: 'stopped', reason: disposed ? 'disposed' : 'auth-not-current' } as const;
        if (result.kind === 'failed' || result.kind === 'unknown') {
          return { kind: 'unresolved', result, pending } as const;
        }
        const pendingActive = result.kind !== 'ok' || result.value.kind === 'no-record';
        if (!pendingActive) pendingSaves.set(pending, 'closed');
        return { kind: 'diagnosed', result, pending, pendingActive } as const;
      });
    },
    dispose() { disposed = true; },
  });
}

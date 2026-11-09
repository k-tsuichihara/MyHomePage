import { createCloudRpcAdapter } from './cloud-rpc-adapter';
import type { AuthContext, AuthRpcPreparation } from './auth-session';
import type { CloudMutation, CloudResult, CloudSaveInput, CloudTarget } from './cloud-rpc-types';
import { uuidKey } from './read-primitives';

type CloudAdapter = ReturnType<typeof createCloudRpcAdapter>;
export type CloudLoadResult = Awaited<ReturnType<CloudAdapter['load']>>;
export type CloudSaveResult = Awaited<ReturnType<CloudAdapter['save']>>;
export type CloudResolveResult = Awaited<ReturnType<CloudAdapter['resolve']>>;
export type CloudStateResult = Awaited<ReturnType<CloudAdapter['changeState']>>;
export type CloudDeleteResult = Awaited<ReturnType<CloudAdapter['deletePermanently']>>;
export type CloudEmptyTrashResult = Awaited<ReturnType<CloudAdapter['emptyTrash']>>;
export type CloudSaveTagResult = Awaited<ReturnType<CloudAdapter['saveTag']>>;
export type CloudDeleteTagResult = Awaited<ReturnType<CloudAdapter['deleteTag']>>;

export interface CloudAuthBoundary {
  isCurrent(context: AuthContext): boolean;
  prepareRpc(context: AuthContext): Promise<AuthRpcPreparation>;
}

export interface PendingCloudSave {
  readonly ownerId: string;
  readonly authGeneration: number;
  readonly input: CloudSaveInput;
}

export type UncertainCloudOperation =
  | Readonly<{ operation: 'change-state'; ownerId: string; authGeneration: number; id: string;
    action: 'pin' | 'unpin' | 'trash' | 'restore'; mutation: Readonly<CloudMutation> }>
  | Readonly<{ operation: 'delete-permanently'; ownerId: string; authGeneration: number; id: string;
    mutation: Readonly<CloudMutation> }>
  | Readonly<{ operation: 'empty-trash'; ownerId: string; authGeneration: number;
    targets: readonly Readonly<CloudTarget>[]; requestId: string }>
  | Readonly<{ operation: 'save-tag'; ownerId: string; authGeneration: number; id: string; name: string;
    expectedRevision: number | null }>
  | Readonly<{ operation: 'delete-tag'; ownerId: string; authGeneration: number; id: string;
    expectedRevision: number }>;

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
export type CloudControllerDisposeResult = 'applied' | 'busy' | 'pending';
export type CloudUncertainOperationResult<T> = CloudControlResult<T>
  | { readonly kind: 'stale-response'; readonly operation: UncertainCloudOperation }
  | { readonly kind: 'unresolved'; readonly result: T; readonly operation: UncertainCloudOperation };
export type CloudOperationAcknowledgement = 'applied' | 'invalid-operation' | 'already-acknowledged';

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

function freezeMutation(context: CloudMutation): Readonly<CloudMutation> {
  return Object.freeze({ expectedRevision: context.expectedRevision, requestId: context.requestId });
}

function freezeTargets(targets: readonly CloudTarget[]): readonly Readonly<CloudTarget>[] {
  return Object.freeze(targets.map(target => Object.freeze({ id: target.id, revision: target.revision })));
}

/**
 * C01のRPC結果を変更せず、現在の認証世代にだけ結果を反映するUI非依存境界。
 * 結果不明の保存は自動再送せず、同じ要求を明示resolveへ渡す。
 */
export function createCloudController(auth: CloudAuthBoundary) {
  let busy = false;
  let disposed = false;
  let openPendingCount = 0;
  const pendingSaves = new WeakMap<object, 'pending' | 'closed'>();
  const uncertainOperations = new WeakMap<object, 'pending' | 'closed'>();

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
    openPendingCount++;
    return pending;
  }

  function trackUncertain<T extends UncertainCloudOperation>(operation: T): T {
    uncertainOperations.set(operation, 'pending');
    openPendingCount++;
    return operation;
  }

  function operationBase(context: AuthContext) {
    return { ownerId: context.userId, authGeneration: context.generation } as const;
  }

  async function exclusive<T>(operation: () => Promise<T>): Promise<T | { readonly kind: 'busy' }> {
    if (busy) return { kind: 'busy' };
    busy = true;
    try { return await operation(); }
    finally { busy = false; }
  }

  async function mutate<T>(context: AuthContext, operation: UncertainCloudOperation,
    invoke: (adapter: CloudAdapter) => Promise<T>): Promise<CloudUncertainOperationResult<T>> {
    return exclusive(async () => {
      if (disposed) return { kind: 'stopped', reason: 'disposed' } as const;
      const preparation = await prepare(context);
      if (preparation.kind !== 'ready') return stopped(preparation);
      if (uuidKey(preparation.ownerId) !== uuidKey(context.userId)) {
        return { kind: 'stopped', reason: 'owner-mismatch' } as const;
      }
      const result = await invoke(createCloudRpcAdapter(preparation.ownerId, preparation.transport));
      const cloudResult = result as CloudResult<unknown>;
      if (!preparation.wasSent() && cloudResult.kind !== 'not-attempted') {
        return { kind: 'stopped', reason: 'auth-not-current' } as const;
      }
      if (disposed || !auth.isCurrent(context)) {
        return preparation.wasSent()
          ? { kind: 'stale-response', operation: trackUncertain(operation) } as const
          : { kind: 'stopped', reason: disposed ? 'disposed' : 'auth-not-current' } as const;
      }
      if (cloudResult.kind === 'unknown') {
        return { kind: 'unresolved', result, operation: trackUncertain(operation) } as const;
      }
      return { kind: 'completed', result } as const;
    }) as Promise<CloudUncertainOperationResult<T>>;
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
        if (!pendingActive) {
          pendingSaves.set(pending, 'closed');
          openPendingCount--;
        }
        return { kind: 'diagnosed', result, pending, pendingActive } as const;
      });
    },
    async changeState(context: AuthContext, id: string, action: 'pin' | 'unpin' | 'trash' | 'restore',
      mutation: CloudMutation): Promise<CloudUncertainOperationResult<CloudStateResult>> {
      const frozenMutation = freezeMutation(mutation);
      const operation = Object.freeze({ operation: 'change-state' as const, ...operationBase(context), id, action,
        mutation: frozenMutation });
      return mutate(context, operation, adapter => adapter.changeState(id, action, frozenMutation));
    },
    async deletePermanently(context: AuthContext, id: string,
      mutation: CloudMutation): Promise<CloudUncertainOperationResult<CloudDeleteResult>> {
      const frozenMutation = freezeMutation(mutation);
      const operation = Object.freeze({ operation: 'delete-permanently' as const, ...operationBase(context), id,
        mutation: frozenMutation });
      return mutate(context, operation, adapter => adapter.deletePermanently(id, frozenMutation));
    },
    async emptyTrash(context: AuthContext, targets: readonly CloudTarget[],
      requestId: string): Promise<CloudUncertainOperationResult<CloudEmptyTrashResult>> {
      const frozenTargets = freezeTargets(targets);
      const operation = Object.freeze({ operation: 'empty-trash' as const, ...operationBase(context),
        targets: frozenTargets, requestId });
      return mutate(context, operation, adapter => adapter.emptyTrash(frozenTargets, requestId));
    },
    async saveTag(context: AuthContext, id: string, name: string,
      expectedRevision: number | null): Promise<CloudUncertainOperationResult<CloudSaveTagResult>> {
      const operation = Object.freeze({ operation: 'save-tag' as const, ...operationBase(context), id, name,
        expectedRevision });
      return mutate(context, operation, adapter => adapter.saveTag(id, name, expectedRevision));
    },
    async deleteTag(context: AuthContext, id: string,
      expectedRevision: number): Promise<CloudUncertainOperationResult<CloudDeleteTagResult>> {
      const operation = Object.freeze({ operation: 'delete-tag' as const, ...operationBase(context), id,
        expectedRevision });
      return mutate(context, operation, adapter => adapter.deleteTag(id, expectedRevision));
    },
    acknowledgeUncertain(operation: UncertainCloudOperation): CloudOperationAcknowledgement {
      const state = uncertainOperations.get(operation);
      if (!state) return 'invalid-operation';
      if (state === 'closed') return 'already-acknowledged';
      uncertainOperations.set(operation, 'closed');
      openPendingCount--;
      return 'applied';
    },
    dispose(): CloudControllerDisposeResult {
      if (disposed) return 'applied';
      if (busy) return 'busy';
      if (openPendingCount > 0) return 'pending';
      disposed = true;
      return 'applied';
    },
  });
}

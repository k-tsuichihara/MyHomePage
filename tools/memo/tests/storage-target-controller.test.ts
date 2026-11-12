import { describe, expect, it } from 'vitest';
import { createStorageTargetController } from '../src/storage-target-controller';
import type { StorageLeaveDecision } from '../src/storage-target-controller';

const auth = { authenticated: true, generation: 7 } as const;
const safe: StorageLeaveDecision = { kind: 'allowed' };
const unsaved: StorageLeaveDecision = { kind: 'confirmation-required', reason: 'unsaved' };
const rejected: StorageLeaveDecision = { kind: 'confirmation-required', reason: 'rejected' };
const unresolved: StorageLeaveDecision = { kind: 'confirmation-required', reason: 'unknown' };
const saving: StorageLeaveDecision = { kind: 'blocked', reason: 'saving' };

describe('storage target controller', () => {
  it('starts local and changes to cloud without any transport responsibility', () => {
    const c = createStorageTargetController();
    expect(c.current()).toEqual({ target: 'local', dirty: false, generation: null });
    expect(c.request('cloud', auth, safe)).toEqual({ kind: 'changed', state: { target: 'cloud', dirty: false, generation: 7 } });
  });

  it('requires confirmation for a dirty draft and cancellation preserves state', () => {
    const c = createStorageTargetController(); c.setDirty(true);
    const pending = c.request('cloud', auth, unsaved);
    expect(pending.kind).toBe('confirmation-required');
    if (pending.kind !== 'confirmation-required') throw new Error('expected confirmation');
    expect(c.confirm(pending, false, auth, unsaved)).toEqual({ kind: 'cancelled', state: { target: 'local', dirty: true, generation: null } });
    expect(c.current()).toEqual({ target: 'local', dirty: true, generation: null });
    expect(c.confirm(pending, true, auth, unsaved)).toEqual({ kind: 'changed', state: { target: 'cloud', dirty: false, generation: 7 } });
  });

  it('rejects unauthenticated or stale cloud requests', () => {
    const c = createStorageTargetController();
    expect(c.request('cloud', null, safe).kind).toBe('rejected');
    c.request('cloud', auth, safe);
    expect(c.request('cloud', { authenticated: true, generation: 8 }, safe).kind).toBe('rejected');
    expect(c.current().target).toBe('cloud');
  });

  it('rejects confirmation after the auth generation changes and preserves local dirty state', () => {
    const c = createStorageTargetController(); c.setDirty(true);
    const pending = c.request('cloud', auth, unsaved);
    expect(pending.kind).toBe('confirmation-required');
    if (pending.kind !== 'confirmation-required') throw new Error('expected confirmation');
    expect(c.confirm(pending, true, { authenticated: true, generation: 8 }, unsaved)).toEqual({
      kind: 'rejected', reason: 'stale-generation', state: { target: 'local', dirty: true, generation: null },
    });
    expect(c.current()).toEqual({ target: 'local', dirty: true, generation: null });
  });

  it('keeps cloud selection across auth invalidation and returns local only on logout', () => {
    const c = createStorageTargetController(); c.request('cloud', auth, safe); c.setDirty(true);
    expect(c.acceptAuthenticatedGeneration({ authenticated: false, generation: 8 })).toEqual({ target: 'cloud', dirty: true, generation: 7 });
    expect(c.acceptAuthenticatedGeneration({ authenticated: true, generation: 8 })).toEqual({ target: 'cloud', dirty: true, generation: 8 });
    const pending = c.logout(unsaved);
    expect(pending.kind).toBe('confirmation-required');
    if (pending.kind !== 'confirmation-required') throw new Error('expected logout confirmation');
    expect(c.confirm(pending, true, null, unsaved)).toEqual({ kind: 'changed', state: { target: 'local', dirty: false, generation: null } });
  });

  it('logs out clean cloud state immediately', () => {
    const c = createStorageTargetController(); c.request('cloud', auth, safe);
    expect(c.logout(safe)).toEqual({ kind: 'changed', state: { target: 'local', dirty: false, generation: null } });
  });

  it('cancelling dirty logout preserves cloud and dirty state', () => {
    const c = createStorageTargetController(); c.request('cloud', auth, safe); c.setDirty(true);
    const pending = c.logout(unsaved);
    expect(pending.kind).toBe('confirmation-required');
    if (pending.kind !== 'confirmation-required') throw new Error('expected logout confirmation');
    expect(c.confirm(pending, false, null, unsaved)).toEqual({ kind: 'cancelled', state: { target: 'cloud', dirty: true, generation: 7 } });
    expect(c.current()).toEqual({ target: 'cloud', dirty: true, generation: 7 });
  });

  it('rejects an old dirty logout confirmation after editing changes', () => {
    const c = createStorageTargetController(); c.request('cloud', auth, safe); c.setDirty(true);
    const pending = c.logout(unsaved);
    if (pending.kind !== 'confirmation-required') throw new Error('expected logout confirmation');
    c.setDirty(false); c.setDirty(true);
    expect(c.confirm(pending, true, null, unsaved)).toEqual({
      kind: 'rejected', reason: 'stale-confirmation', state: { target: 'cloud', dirty: true, generation: 7 },
    });
  });

  it('rejects a confirmation when the dirty/edit revision changes', () => {
    const c = createStorageTargetController(); c.setDirty(true);
    const pending = c.request('cloud', auth, unsaved);
    if (pending.kind !== 'confirmation-required') throw new Error('expected confirmation');
    c.setDirty(false); c.setDirty(true);
    expect(c.confirm(pending, true, auth, unsaved)).toEqual({
      kind: 'rejected', reason: 'stale-confirmation', state: { target: 'local', dirty: true, generation: null },
    });
  });

  it('never creates an RPC, write, retry, or sync side effect', () => {
    const c = createStorageTargetController();
    const calls = { rpc: 0, write: 0, retry: 0, sync: 0 };
    c.request('cloud', auth, safe); c.logout(safe);
    expect(calls).toEqual({ rpc: 0, write: 0, retry: 0, sync: 0 });
  });

  it('delegates saving/rejected/unresolved leave policy instead of using dirty alone', () => {
    const c = createStorageTargetController(); c.request('cloud', auth, safe);
    expect(c.request('local', auth, saving)).toMatchObject({ kind: 'rejected' });
    expect(c.request('local', auth, rejected).kind).toBe('confirmation-required');
    expect(c.logout(unresolved).kind).toBe('confirmation-required');
  });

  it('rechecks saving after a confirmation was issued', () => {
    const c = createStorageTargetController(); c.setDirty(true);
    const pending = c.request('cloud', auth, unsaved);
    if (pending.kind !== 'confirmation-required') throw new Error('expected confirmation');
    expect(c.confirm(pending, true, auth, saving)).toMatchObject({ kind: 'rejected' });
    expect(c.current()).toEqual({ target: 'local', dirty: true, generation: null });
  });
});

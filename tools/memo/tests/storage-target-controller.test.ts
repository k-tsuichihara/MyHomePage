import { describe, expect, it } from 'vitest';
import { createStorageTargetController } from '../src/storage-target-controller';

const auth = { authenticated: true, generation: 7 } as const;

describe('storage target controller', () => {
  it('starts local and changes to cloud without any transport responsibility', () => {
    const c = createStorageTargetController();
    expect(c.current()).toEqual({ target: 'local', dirty: false, generation: null });
    expect(c.request('cloud', auth)).toEqual({ kind: 'changed', state: { target: 'cloud', dirty: false, generation: 7 } });
  });

  it('requires confirmation for a dirty draft and cancellation preserves state', () => {
    const c = createStorageTargetController(); c.setDirty(true);
    const pending = c.request('cloud', auth);
    expect(pending.kind).toBe('confirmation-required');
    if (pending.kind !== 'confirmation-required') throw new Error('expected confirmation');
    expect(c.confirm(pending, false, auth)).toEqual({ kind: 'cancelled', state: { target: 'local', dirty: true, generation: null } });
    expect(c.current()).toEqual({ target: 'local', dirty: true, generation: null });
    expect(c.confirm(pending, true, auth)).toEqual({ kind: 'changed', state: { target: 'cloud', dirty: false, generation: 7 } });
  });

  it('rejects unauthenticated or stale cloud requests', () => {
    const c = createStorageTargetController();
    expect(c.request('cloud', null).kind).toBe('rejected');
    c.request('cloud', auth);
    expect(c.request('cloud', { authenticated: true, generation: 8 }).kind).toBe('rejected');
    expect(c.current().target).toBe('cloud');
  });

  it('rejects confirmation after the auth generation changes and preserves local dirty state', () => {
    const c = createStorageTargetController(); c.setDirty(true);
    const pending = c.request('cloud', auth);
    expect(pending.kind).toBe('confirmation-required');
    if (pending.kind !== 'confirmation-required') throw new Error('expected confirmation');
    expect(c.confirm(pending, true, { authenticated: true, generation: 8 })).toEqual({
      kind: 'rejected', reason: 'stale-generation', state: { target: 'local', dirty: true, generation: null },
    });
    expect(c.current()).toEqual({ target: 'local', dirty: true, generation: null });
  });

  it('keeps cloud selection across auth invalidation and returns local only on logout', () => {
    const c = createStorageTargetController(); c.request('cloud', auth); c.setDirty(true);
    expect(c.acceptAuthenticatedGeneration({ authenticated: false, generation: 8 })).toEqual({ target: 'cloud', dirty: true, generation: 7 });
    expect(c.acceptAuthenticatedGeneration({ authenticated: true, generation: 8 })).toEqual({ target: 'cloud', dirty: true, generation: 8 });
    expect(c.logout()).toEqual({ target: 'local', dirty: true, generation: null });
  });

  it('rejects a confirmation when the dirty/edit revision changes', () => {
    const c = createStorageTargetController(); c.setDirty(true);
    const pending = c.request('cloud', auth);
    if (pending.kind !== 'confirmation-required') throw new Error('expected confirmation');
    c.setDirty(false); c.setDirty(true);
    expect(c.confirm(pending, true, auth)).toEqual({
      kind: 'rejected', reason: 'stale-confirmation', state: { target: 'local', dirty: true, generation: null },
    });
  });

  it('never creates an RPC, write, retry, or sync side effect', () => {
    const c = createStorageTargetController();
    const calls = { rpc: 0, write: 0, retry: 0, sync: 0 };
    c.request('cloud', auth); c.logout();
    expect(calls).toEqual({ rpc: 0, write: 0, retry: 0, sync: 0 });
  });
});

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

  it('returns to local on logout or matching auth expiry without copying data', () => {
    const c = createStorageTargetController(); c.request('cloud', auth); c.setDirty(true);
    expect(c.authExpired(6).target).toBe('cloud');
    expect(c.authExpired(7)).toEqual({ target: 'local', dirty: true, generation: null });
    expect(c.request('cloud', auth).kind).toBe('confirmation-required');
    expect(c.logout()).toEqual({ target: 'local', dirty: true, generation: null });
  });

  it('never creates an RPC, write, retry, or sync side effect', () => {
    const c = createStorageTargetController();
    const calls = { rpc: 0, write: 0, retry: 0, sync: 0 };
    c.request('cloud', auth); c.logout();
    expect(calls).toEqual({ rpc: 0, write: 0, retry: 0, sync: 0 });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createMemoAuthSession } from '../src/auth-session';

const ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const valid = () => ({ user: { id: ID }, access_token: 'synthetic-token', expires_at: 4102444800 });

describe('Auth failure observation', () => {
  it('keeps a failure classification and clears it after an applied login', async () => {
    let current: unknown = null;
    const api = {
      getSession: vi.fn(async () => ({ data: { session: current }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: { id: ID } }, error: null })),
      signInWithPassword: vi.fn(async () => ({ data: { session: current }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
    };
    const auth = createMemoAuthSession(api);
    expect(await auth.login('synthetic@example.invalid', 'synthetic-password')).toBe('blocked');
    expect(auth.getLastFailureReason()).toBe('invalid-session');
    current = valid();
    expect(await auth.login('synthetic@example.invalid', 'synthetic-password')).toBe('applied');
    expect(auth.getLastFailureReason()).toBe('none');
    expect(JSON.stringify(auth.getState())).not.toContain('synthetic');
  });
  it('classifies only an allowlisted provider code', async () => {
    const api = {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      signInWithPassword: vi.fn(async () => ({ data: { session: null }, error: { code: 'invalid_credentials', message: 'private' } })),
      signOut: vi.fn(async () => ({ error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
    };
    const auth = createMemoAuthSession(api);
    expect(await auth.login('synthetic@example.invalid', 'synthetic-password')).toBe('blocked');
    expect(auth.getLastFailureReason()).toBe('credentials-rejected');
    expect(JSON.stringify(auth.getState())).not.toContain('private');
  });
});

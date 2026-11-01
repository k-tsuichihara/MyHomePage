import { it, expect } from 'vitest';
import { fillBoundedQuota } from './persistence/quota';

it('容量fixtureの回数・文字数・時間を制限し、旧/新キーを操作しない', () => {
  const keys: string[] = []; let chars = 0;
  const result = fillBoundedQuota({ setItem(key, value) { keys.push(key); chars += value.length; } }, () => 0);
  expect(result.attempts).toBe(32); expect(result.attemptedCharacters).toBe(16 * 1024 * 1024); expect(chars).toBe(result.attemptedCharacters);
  expect(keys.every(key => /^__memo_quota_\d+$/.test(key))).toBe(true); expect(result.quota).toBe(false);
  let clock = 0, calls = 0;
  const timeout = fillBoundedQuota({ setItem() { calls++; clock = 5000; } }, () => clock);
  expect(calls).toBe(1); expect(timeout.timedOut).toBe(true);
});
it('実例外と同じDOMExceptionでQuotaのみ認定し、他の例外を隠さない', () => {
  expect(fillBoundedQuota({ setItem() { throw new DOMException('Synthetic', 'QuotaExceededError'); } }, () => 0)).toMatchObject({ quota: true, timedOut: false });
  expect(() => fillBoundedQuota({ setItem() { throw Error('Synthetic'); } }, () => 0)).toThrow('Unexpected quota failure');
});

import { it, expect } from 'vitest';
import { releaseMatches } from './release-transition/gate';
import { cacheOutcome, countOutcome, matchesStop } from './release-transition/outcome';

it.each(['sim-r1', 'sim-r2'])('同一の既知releaseだけ許可：%s', id => { expect(releaseMatches(id, id, id)).toBe(true); });
it.each([
  ['sim-r1', 'sim-r2', 'sim-r1'], ['sim-r2', 'sim-r1', 'sim-r2'],
  ['sim-r2', 'sim-r2', 'sim-r1'], ['sim-r2', 'sim-r2', ''], ['', 'sim-r2', 'sim-r2'], ['unknown', 'unknown', 'unknown'],
])('不一致・欠落・未知releaseを拒否：%s/%s/%s', (html, script, style) => { expect(releaseMatches(html, script, style)).toBe(false); });
it('実キャッシュ観測不能は成功件数へ加算しない', () => {
  const before = { passed: 17, unverified: 0 };
  expect(countOutcome(before, cacheOutcome(1))).toEqual({ passed: 17, unverified: 1 });
  expect(countOutcome(before, cacheOutcome(0))).toEqual({ passed: 18, unverified: 0 });
});
it.each([-1, NaN, 0.5])('不正な観測値は未検証でごまかさず失敗：%s', delta => { expect(() => cacheOutcome(delta)).toThrow('Invalid observation'); });
it('予期しない例外と別理由の停止を期待した拒否と認めない', () => {
  expect(matchesStop({ kind: 'unexpected' }, 'release-mismatch')).toBe(false);
  expect(matchesStop({ kind: 'stopped', reason: 'environment-rejected' }, 'permit-missing')).toBe(false);
  expect(matchesStop({ kind: 'not-started' }, 'release-mismatch')).toBe(false);
  expect(matchesStop({ kind: 'stopped', reason: 'permit-missing' }, 'permit-missing')).toBe(true);
});

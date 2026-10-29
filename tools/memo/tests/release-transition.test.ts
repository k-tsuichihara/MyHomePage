import { it, expect } from 'vitest';
import { releaseMatches } from './release-transition/gate';

it.each(['sim-r1', 'sim-r2'])('同一の既知releaseだけ許可：%s', id => { expect(releaseMatches(id, id, id)).toBe(true); });
it.each([
  ['sim-r1', 'sim-r2', 'sim-r1'], ['sim-r2', 'sim-r1', 'sim-r2'],
  ['sim-r2', 'sim-r2', 'sim-r1'], ['sim-r2', 'sim-r2', ''], ['', 'sim-r2', 'sim-r2'], ['unknown', 'unknown', 'unknown'],
])('不一致・欠落・未知releaseを拒否：%s/%s/%s', (html, script, style) => { expect(releaseMatches(html, script, style)).toBe(false); });

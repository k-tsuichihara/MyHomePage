import { describe, expect, it } from 'vitest';
// @ts-expect-error The helper is an intentionally small Node ESM module used by the runner.
import { createRouteSummary, observeRoute } from '../scripts/human-gate-route-summary.mjs';

describe('Human Gate route summary', () => {
  it('keeps expected Auth observation after later unexpected routes', () => {
    const summary = createRouteSummary();
    observeRoute(summary, { allowed: true, targetMatched: true, method: 'POST', targetClass: 'expected-auth-path' });
    observeRoute(summary, { allowed: false, targetMatched: false, method: 'GET', targetClass: 'unexpected-origin' });
    expect(summary).toMatchObject({ expectedAuthObserved: true, expectedAuthAllowed: true, unexpectedObserved: true, unexpectedBlocked: true, lastTargetClass: 'unexpected-origin' });
  });
});

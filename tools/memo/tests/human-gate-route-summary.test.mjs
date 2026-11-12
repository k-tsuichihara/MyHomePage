import { describe, expect, it } from 'vitest';
import { createRouteSummary, observeRoute } from '../scripts/human-gate-route-summary.mjs';

describe('Human Gate route summary', () => {
  it('keeps expected Auth observation after later unexpected routes', () => {
    const summary = createRouteSummary();
    observeRoute(summary, { allowed: true, targetMatched: true, method: 'POST' });
    observeRoute(summary, { allowed: false, targetMatched: false, method: 'GET' });
    expect(summary).toMatchObject({ expectedAuthObserved: true, expectedAuthAllowed: true, unexpectedObserved: true, unexpectedBlocked: true });
  });
});

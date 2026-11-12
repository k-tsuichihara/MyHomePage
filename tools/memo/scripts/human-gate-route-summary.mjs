export function createRouteSummary() {
  return { observed: false, allowed: false, expectedAuthObserved: false, expectedAuthAllowed: false,
    unexpectedObserved: false, unexpectedBlocked: false, lastMethod: 'none', lastTargetClass: 'none', cspConfiguredForAuthOrigin: true };
}
export function observeRoute(summary, { allowed, targetMatched, method }) {
  const targetClass = targetMatched ? 'expected-auth-path' : 'unexpected-path';
  summary.observed = true; summary.allowed ||= allowed; summary.lastMethod = method; summary.lastTargetClass = targetClass;
  if (targetMatched) { summary.expectedAuthObserved = true; summary.expectedAuthAllowed ||= allowed; }
  else { summary.unexpectedObserved = true; summary.unexpectedBlocked ||= !allowed; }
  return summary;
}

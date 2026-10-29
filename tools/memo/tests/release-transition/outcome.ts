export type StopReason = 'release-mismatch' | 'css-unavailable' | 'css-mismatch' | 'permit-missing' | 'environment-rejected' | 'legacy-asset-missing';
export type BootReport = { kind: 'not-started' | 'starting' | 'ready' | 'unexpected' } | { kind: 'stopped'; reason: StopReason };
export class ExpectedBootStop extends Error {
  constructor(readonly reason: StopReason) { super(reason); }
}
export function matchesStop(report: BootReport | undefined, reason: StopReason): boolean {
  return report?.kind === 'stopped' && report.reason === reason;
}
export type CaseOutcome = 'pass' | 'unverified';
/** 実キャッシュの観測不能を、意図的混在試験の成功に数えない。 */
export function cacheOutcome(serverRequestDelta: number): CaseOutcome {
  if (!Number.isSafeInteger(serverRequestDelta) || serverRequestDelta < 0) throw new Error('Invalid observation');
  return serverRequestDelta === 0 ? 'pass' : 'unverified';
}
export function countOutcome(counts: { passed: number; unverified: number }, outcome: CaseOutcome) {
  return { passed: counts.passed + (outcome === 'pass' ? 1 : 0), unverified: counts.unverified + (outcome === 'unverified' ? 1 : 0) };
}

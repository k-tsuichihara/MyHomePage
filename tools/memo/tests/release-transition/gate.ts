/** HTML・JS・実際に適用されたCSSの版が揃わなければ、Storageの取得前に停止する。 */
export function releaseMatches(html: string, script: string, style: string): boolean {
  return ['sim-r1', 'sim-r2'].includes(html) && html === script && html === style;
}

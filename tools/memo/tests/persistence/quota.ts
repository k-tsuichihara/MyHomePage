/** 既存の回数・投入量を増やさず、時間予算も超えて次の投入を始めない。消去・容量回復はしない。 */
export function fillBoundedQuota(storage: Pick<Storage, 'setItem'>, now = () => performance.now()) {
  const start = now(); let size = 524288, attempts = 0, attemptedCharacters = 0, quota = false;
  while (attempts < 32 && attemptedCharacters + size <= 16 * 1024 * 1024 && now() - start < 5000) {
    const key = `__memo_quota_${attempts++}`; attemptedCharacters += size;
    try { storage.setItem(key, 'Q'.repeat(size)); }
    catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw new Error('Unexpected quota failure');
      quota = true; if (size <= 128) break; size = Math.floor(size / 2);
    }
  }
  const elapsedMs = now() - start;
  return { quota, attempts, attemptedCharacters, elapsedMs, timedOut: elapsedMs >= 5000 };
}

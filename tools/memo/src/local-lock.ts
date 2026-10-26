/** 今後の通常保存も同じ名前で排他し、移行との競合を防ぐ。 */
export const LOCAL_DATA_LOCK_NAME = 'myhomepage.memo.data.v2.write';

/** navigator.locksを渡せる最小契約。テストでは同じ契約の待ち行列を注入する。 */
export interface LocalLockManager {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T>;
}

export class LocalLocksUnavailableError extends Error {
  constructor() { super('Local data writes require Web Locks'); }
}

/** 非対応時に無排他実行へフォールバックしない。例外時の解放はWeb Locksに委ねる。 */
export function withLocalDataLock<T>(locks: LocalLockManager | undefined, operation: () => Promise<T>): Promise<T> {
  if (!locks || typeof locks.request !== 'function') return Promise.reject(new LocalLocksUnavailableError());
  return locks.request(LOCAL_DATA_LOCK_NAME, { mode: 'exclusive' }, operation);
}

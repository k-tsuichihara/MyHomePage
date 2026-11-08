export interface AuthStorageAudit {
  gets: number; reads: number; writes: number; removals: number; denied: number; touched: string[];
}
declare global { interface Window { __authStorageAudit?: () => AuthStorageAudit; } }

/** addInitScriptでSDK importより先に設置する。Storage参照の取得とメソッド操作は別々に数える。 */
export function installAuthStorageGuard(value: { permit: boolean; origin: string; runId: string }) {
  let gets = 0, reads = 0, writes = 0, removals = 0, denied = 0;
  const touched = new Set<string>();
  const key = 'myhomepage.memo.auth.v1';
  const allowed = new Set([key, `${key}-user`, `${key}-code-verifier`, `${key}-flows-code-verifier`]);
  const getter = Object.getOwnPropertyDescriptor(window, 'localStorage')!.get!;
  // 既に取得したStorage参照への通常のメソッド呼出しも、同じprototype監視を通る。
  for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
    const original = Storage.prototype[method];
    Object.defineProperty(Storage.prototype, method, { value: function (this: Storage, name: string, data?: string) {
      if (method === 'getItem') reads++; else if (method === 'setItem') writes++; else removals++;
      if (!value.permit || !allowed.has(name)) { denied++; throw new Error('Forbidden storage operation'); }
      touched.add(name);
      return Reflect.apply(original, this, method === 'setItem' ? [name, data] : [name]);
    } });
  }
  for (const method of ['key', 'clear']) Object.defineProperty(Storage.prototype, method, {
    value() { denied++; throw new Error('Storage enumeration forbidden'); },
  });
  Object.defineProperty(window, '__authStorageAudit', { value: () => ({ gets, reads, writes, removals, denied, touched: [...touched] }) });
  Object.defineProperty(window, 'localStorage', { get() {
    gets++; if (!value.permit) throw new Error('Unpermitted storage'); return getter.call(window);
  } });
  if (value.permit) Object.defineProperty(window, '__authPermit', { value: Object.freeze({ origin: value.origin, runId: value.runId }) });
}

interface Closable { close(): Promise<void> }
interface Owner { readonly runId: string; verify(profile: string): Promise<void>; dispose(profile: string): Promise<void> }
export interface PreservationReport { event: 'PRESERVED'; runId: string; profile: string; ownership: 'verified' | 'unverified' }

/** Context取得後の初期化失敗でも終了する。取得自体の失敗時は架空のContextを閉じない。 */
export async function initializeContext<T extends Closable, R>(create: () => Promise<T>, initialize: (context: T) => Promise<R>): Promise<R> {
  const context = await create();
  try { return await initialize(context); }
  catch (error) {
    try { await context.close(); }
    catch (closeError) { throw new AggregateError([error, closeError], 'Context initialization and close failed'); }
    throw error;
  }
}

/** 失敗したprofileは削除せず、所有再確認結果と生成済み絶対パスだけを報告する。保存内容は出さない。 */
export async function runOwnedCase(owner: Owner, profile: string, operation: () => Promise<void>, report: (value: PreservationReport) => void) {
  try { await owner.verify(profile); await operation(); await owner.dispose(profile); }
  catch (error) {
    let ownership: PreservationReport['ownership'] = 'unverified';
    try { await owner.verify(profile); ownership = 'verified'; } catch { /* 所有不明の候補へ追加操作しない */ }
    report({ event: 'PRESERVED', runId: owner.runId, profile, ownership });
    throw error;
  }
}

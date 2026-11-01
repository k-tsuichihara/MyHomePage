import { strict as assert } from 'node:assert';
import type { BrowserContext, Page } from '@playwright/test';
import { token } from '../local-save-fixtures';
import type { RestoreV3 } from '../../src/local-restore';
import type {} from './backup-entry';

type Run = (name: string, operation: (profile: string) => Promise<void>, verified?: () => boolean) => Promise<void>;
type Launch = (profile: string) => Promise<{ page: Page; context: BrowserContext; close(): Promise<void> }>;
const M1 = token(10), M2 = token(11), TAG = token(30), HISTORY = token(900), T0 = '2026-11-01T00:00:00Z', T2 = '2026-11-01T02:00:00Z', T3 = '2026-11-01T03:00:00Z';

/** 既存ランナーの所有・通信・終了処理を受け取り、独自のprofile生成/削除経路を作らない。 */
export async function runBackupPhaseB(run: Run, launch: Launch, origin: string) {
  let backup = '', fileData: Pick<RestoreV3, 'memos' | 'tags' | 'memoTags' | 'deletedMemoIds'>;
  const withBrowser = async (profile: string, operation: (page: Page, context: BrowserContext) => Promise<void>) => {
    const browser = await launch(profile);
    try {
      await browser.page.goto(`${origin}/backup`); await browser.page.waitForFunction(() => !!window.__backupPhaseB, undefined, { timeout: 5000 });
      await operation(browser.page, browser.context);
    } finally { await browser.close(); }
  };
  const snapshot = (page: Page) => page.evaluate(() => window.__backupPhaseB!.snapshot());
  const load = async (page: Page) => {
    const result = await page.evaluate(() => window.__backupPhaseB!.load());
    assert.equal(result.kind, 'loaded'); if (result.kind !== 'loaded' || result.value.version !== 3) throw Error('Expected ready v3');
    return result.value as RestoreV3;
  };
  const prepareAdd = async (page: Page) => assert.equal((await page.evaluate(json => window.__backupPhaseB!.prepareAdd(json), backup)).phase, 'confirmation');
  await run('B01 実localStorageの通常操作→バックアップ出力・無変更', async profile => withBrowser(profile, async page => {
    await page.evaluate(() => window.__backupPhaseB!.populate()); const before = await snapshot(page), counters = await page.evaluate(() => window.__backupPhaseB!.counters());
    const result = await page.evaluate(() => window.__backupPhaseB!.export());
    assert.equal(result.kind, 'prepared'); if (result.kind !== 'prepared') throw Error('Output failed'); backup = result.json;
    fileData = JSON.parse(backup).data;
    assert.deepEqual(fileData.memos, [
      { id: M1, title: '編集済み', body: ' 更新本文\n', createdAt: T0, updatedAt: T2, revision: 3, lastRequestId: null, pinnedAt: T2, deletedAt: null },
      { id: M2, title: '作成2', body: ' 原本文\n', createdAt: T0, updatedAt: T2, revision: 3, lastRequestId: null, pinnedAt: T2, deletedAt: T2 },
    ]);
    assert.deepEqual(fileData.deletedMemoIds, [HISTORY]); assert.equal(fileData.tags.length, 2); assert.equal(fileData.memoTags.length, 2);
    assert.deepEqual(fileData.tags.map(t => [t.id, t.name, t.revision]), [[TAG, 'Work', 1], [token(31), '未使用', 1]]);
    assert.deepEqual(fileData.memoTags, [{ memoId: M2, tagId: TAG }, { memoId: M1, tagId: TAG }]);
    assert.deepEqual(await snapshot(page), before); assert.equal(before.old, null); assert.deepEqual(await page.evaluate(() => window.__backupPhaseB!.counters()), counters);
    assert.ok(!backup.includes('legacySnapshot') && !backup.includes('migration'));
  }));
  await run('B02 追加型復元→再読込→所有profile再起動', async profile => {
    let expected: RestoreV3;
    await withBrowser(profile, async page => {
      await page.evaluate(() => window.__backupPhaseB!.populate()); const before = await load(page);
      await prepareAdd(page); assert.equal((await page.evaluate(() => window.__backupPhaseB!.confirmAdd())).phase, 'applied');
      expected = await load(page); assert.deepEqual(expected.memos.slice(0, 2), before.memos); assert.deepEqual(expected.tags, before.tags);
      assert.deepEqual(expected.memoTags.slice(0, 2), before.memoTags); assert.deepEqual(expected.deletedMemoIds, before.deletedMemoIds);
      assert.equal(expected.memos.length, 4);
      const newIds = expected.memos.slice(2).map(m => m.id); assert.equal(new Set(newIds).size, 2); assert.ok(newIds.every(id => ![M1, M2, HISTORY].includes(id)));
      for (let i = 0; i < 2; i++) assert.deepEqual(expected.memos[i + 2], { ...fileData.memos[i], id: newIds[i], createdAt: T3, updatedAt: T3, revision: 1, lastRequestId: null, pinnedAt: T3 });
      await page.reload(); assert.deepEqual(await load(page), expected);
    });
    await withBrowser(profile, async page => { assert.deepEqual(await load(page), expected!); assert.equal((await snapshot(page)).old, null); });
  });
  await run('B03 完全削除→選択回復→所有profile再起動', async profile => {
    let expected: RestoreV3;
    await withBrowser(profile, async page => {
      await page.evaluate(() => window.__backupPhaseB!.populate());
      assert.equal((await page.evaluate(() => window.__backupPhaseB!.remove())).kind, 'deleted');
      const state = await page.evaluate(json => window.__backupPhaseB!.recover(json), backup); assert.equal(state.outcome, 'created');
      expected = await load(page); assert.deepEqual(expected.deletedMemoIds, [HISTORY, M2]); assert.equal(expected.memos.length, 2);
      assert.deepEqual(expected.memos[1], { ...fileData.memos[1], id: state.newId, createdAt: T3, updatedAt: T3, revision: 1, lastRequestId: null, pinnedAt: null, deletedAt: null });
      assert.deepEqual(expected.tags, fileData.tags); assert.deepEqual(expected.memoTags.at(-1), { memoId: state.newId, tagId: TAG });
    });
    await withBrowser(profile, async page => { assert.deepEqual(await load(page), expected!); assert.equal((await snapshot(page)).old, null); });
  });
  await run('B04 別の新規所有profileへ初期復元→再起動', async profile => {
    let expected: RestoreV3;
    await withBrowser(profile, async page => {
      assert.deepEqual(await snapshot(page), { old: null, raw: null });
      assert.equal((await page.evaluate(json => window.__backupPhaseB!.prepareInitial(json), backup)).phase, 'confirmation');
      assert.equal((await page.evaluate(() => window.__backupPhaseB!.confirmInitial())).result, 'written');
      expected = await load(page); assert.deepEqual(expected, { version: 3, migration: { status: 'not-required' }, ...fileData });
      await page.reload(); assert.deepEqual(await load(page), expected);
    });
    await withBrowser(profile, async page => { assert.deepEqual(await load(page), expected!); assert.equal((await snapshot(page)).old, null); });
  });
  await run('B05 実Web Locks待機・複数タブ競合・明示再読込', async profile => withBrowser(profile, async (page, context) => {
    await page.evaluate(() => window.__backupPhaseB!.populate()); await prepareAdd(page);
    const other = await context.newPage(); await other.goto(`${origin}/backup`);
    assert.equal((await other.evaluate(() => window.__backupPhaseB!.edit(3))).kind, 'saved'); const before = await snapshot(page);
    assert.equal((await page.evaluate(() => window.__backupPhaseB!.confirmAdd())).phase, 'failed'); assert.deepEqual(await snapshot(page), before);
    assert.equal((await load(page)).memos[0]!.revision, 4);
    await prepareAdd(page); await other.evaluate(() => window.__backupPhaseB!.holdLock());
    let resolved = false;
    const pending = page.evaluate(() => window.__backupPhaseB!.confirmAdd()).then(result => { resolved = true; return result; });
    await page.waitForTimeout(150); assert.equal(resolved, false); await other.close();
    let timer: ReturnType<typeof setTimeout>;
    try { assert.equal((await Promise.race([pending, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Lock timeout')), 5000); })])).phase, 'applied'); }
    finally { clearTimeout(timer!); }
    const third = await context.newPage(); await third.goto(`${origin}/backup`);
    const edits = await Promise.all([page.evaluate(() => window.__backupPhaseB!.edit(4)), third.evaluate(() => window.__backupPhaseB!.edit(4))]);
    assert.equal(edits.filter(result => result.kind === 'saved').length, 1); assert.equal(edits.filter(result => result.kind === 'rejected').length, 1);
    assert.equal((await load(page)).memos[0]!.revision, 5); assert.equal((await load(third)).memos[0]!.revision, 5);
    assert.deepEqual((await load(page)).deletedMemoIds, [HISTORY]);
  }));
  // 呼出元は既存シナリオも完了してから最後にこの容量ケースを実行する。
  return async () => {
    let verified = false;
    await run('B06 上限付き実容量不足→追加型復元unknown・無自動操作', async profile => withBrowser(profile, async page => {
      await page.evaluate(() => window.__backupPhaseB!.populate()); await prepareAdd(page);
      const before = await snapshot(page), counters = await page.evaluate(() => window.__backupPhaseB!.counters());
      const quota = await page.evaluate(() => window.__backupPhaseB!.fillQuota());
      assert.ok(quota.attempts <= 32 && quota.attemptedCharacters <= 16 * 1024 * 1024);
      process.stdout.write(`B06 quota=${quota.quota} attempts=${quota.attempts} characters=${quota.attemptedCharacters} elapsedMs=${Math.round(quota.elapsedMs)}\n`);
      if (!quota.quota || quota.timedOut) return;
      const result = await page.evaluate(() => window.__backupPhaseB!.confirmAdd());
      const after = await page.evaluate(() => window.__backupPhaseB!.counters());
      assert.equal(result.phase, 'unknown'); assert.equal(after.quota, true); assert.equal(after.attempts, counters.attempts + 1); assert.equal(after.writes, counters.writes);
      assert.deepEqual(await snapshot(page), before); await page.waitForTimeout(150);
      assert.deepEqual(await page.evaluate(() => window.__backupPhaseB!.counters()), after); assert.deepEqual(await snapshot(page), before);
      verified = true;
    }), () => verified);
  };
}

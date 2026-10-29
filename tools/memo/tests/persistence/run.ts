import { chromium } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
import { createProfileOwner, prepareProfileBase } from './profile-guard';
import type {} from './entry';

if (process.argv.length !== 2) throw new Error('Custom paths and arguments are forbidden');
// bundleの.persistence固定位置を基準にする。cwdから任意profileを解釈しない。
const root = fileURLToPath(new URL('../', import.meta.url));
const owner = await createProfileOwner(await prepareProfileBase(root));
const assets = new Map([['/', ['preview.html', 'text/html']], ['/preview.js', ['preview.js', 'text/javascript']], ['/preview.css', ['preview.css', 'text/css']]]);
let origin = '';
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.headers.host !== origin.slice('http://'.length) || (req.headers.origin && req.headers.origin !== origin)) { res.writeHead(403).end(); return; }
  if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(405).end(); return; }
  const asset = assets.get(req.url ?? ''); if (!asset) { res.writeHead(404).end(); return; }
  try { const content = await readFile(new URL(`./${asset[0]}`, import.meta.url)); res.setHeader('Content-Type', `${asset[1]}; charset=utf-8`); res.writeHead(200).end(req.method === 'HEAD' ? undefined : content); }
  catch { res.writeHead(503).end(); }
});
await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const address = server.address();
if (!address || typeof address === 'string' || address.port === 4173) {
  await new Promise<void>(resolve => server.close(() => resolve())); throw new Error('Dedicated origin unavailable');
}
origin = `http://127.0.0.1:${address.port}`;
let passed = 0, quotaVerified = false;

async function launch(profile: string, permit = true) {
  await owner.verify(profile);
  const context = await chromium.launchPersistentContext(profile, {
    headless: true, serviceWorkers: 'block', acceptDownloads: false,
    // 外部宛は到達不能なループバックproxyへ限定。検証originだけを直接接続する。
    proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1' },
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
  });
  const external: string[] = [], errors: string[] = [];
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== origin) { external.push('external'); await route.abort(); }
    else await route.continue();
  });
  context.on('page', page => page.on('pageerror', () => errors.push('pageerror')));
  if (permit) await context.addInitScript(value => { Object.defineProperty(window, '__persistencePermit', { value: Object.freeze(value) }); }, { origin, runId: owner.runId });
  else await context.addInitScript(() => {
    let reads = 0;
    Object.defineProperty(window, 'localStorage', { get() { reads++; throw new Error('Must not access storage'); } });
    Object.defineProperty(window, '__storageAccessCount', { get: () => reads });
  });
  const page = await context.newPage(); await page.goto(origin);
  return { context, page, async close() {
    try { assert.equal(external.length, 0); assert.equal(errors.length, 0); assert.equal((await context.cookies()).length, 0); }
    finally { await context.close(); }
  } };
}
async function run(name: string, operation: (profile: string) => Promise<void>) {
  const profile = await owner.create();
  await operation(profile);
  await owner.dispose(profile);
  if (name.startsWith('上限付き') && !quotaVerified) process.stdout.write(`UNVERIFIED ${name}\n`);
  else { passed++; process.stdout.write(`PASS ${name}\n`); }
}
const memoId = 'abcdef00-0000-4000-8000-000000009999';
const seed = (page: Page) => page.evaluate(() => window.__persistence!.seedLegacy());
const oldUnchanged = async (page: Page) => assert.equal(await page.evaluate(() => window.__persistence!.oldUnchanged()), true);
async function withBrowser(profile: string, operation: (page: Page, context: BrowserContext) => Promise<void>) {
  const browser = await launch(profile);
  try { await operation(browser.page, browser.context); } finally { await browser.close(); }
}
try {
  await run('許可なしはストレージ接続前に停止', async profile => {
    const browser = await launch(profile, false);
    try {
      assert.equal(await browser.page.evaluate(() => window.__persistence === undefined), true);
      assert.equal(await browser.page.evaluate(() => (window as unknown as { __storageAccessCount: number }).__storageAccessCount), 0);
      assert.match(await browser.page.locator('#migration-status').innerText(), /安全条件/);
    } finally { await browser.close(); }
  });
  await run('通常保存・再読込・終了後再起動', async profile => {
    await withBrowser(profile, async page => {
      assert.equal((await page.evaluate(id => window.__persistence!.save(id, null), memoId)).kind, 'saved');
      await page.reload(); const data = await page.evaluate(() => window.__persistence!.load()); assert.equal(data.kind, 'loaded');
      if (data.kind === 'loaded') assert.equal(data.value.memos[0]!.revision, 1);
    });
    await withBrowser(profile, async page => {
      const data = await page.evaluate(() => window.__persistence!.load()); assert.equal(data.kind, 'loaded');
      if (data.kind === 'loaded') assert.equal(data.value.memos[0]!.id, memoId);
    });
  });
  await run('旧fixture一回投入・取消・明示移行UI', async profile => withBrowser(profile, async page => {
    await seed(page);
    assert.equal(await page.evaluate(() => { try { window.__persistence!.seedLegacy(); return false; } catch { return true; } }), true);
    await page.evaluate(() => window.__persistence!.start()); await page.locator('#migration-no').click();
    assert.equal(await page.evaluate(() => window.__persistence!.writes()), 0); await oldUnchanged(page);
    await page.locator('#migration-inspect').click(); await page.locator('#migration-yes').click();
    await page.locator('#count').filter({ hasText: '2件' }).waitFor(); await oldUnchanged(page);
    assert.equal(await page.evaluate(() => window.__persistence!.writes()), 2);
  }));
  for (const status of ['pending', 'complete']) await run(`${status}書込後の注入中断・実再起動・復旧`, async profile => {
    await withBrowser(profile, async page => {
      await seed(page); await page.evaluate(value => window.__persistence!.setFault(value), `after-${status}`);
      const result = await page.evaluate(() => window.__persistence!.migrate()); assert.equal(result.kind, 'stopped');
      if (result.kind === 'stopped') { assert.equal(result.writeOutcome, 'unverified'); assert.equal(result.remaining.v2, status); }
      await oldUnchanged(page);
    });
    await withBrowser(profile, async page => {
      // 既存profileへfixtureを再投入できない。
      assert.equal(await page.evaluate(() => { try { window.__persistence!.seedLegacy(); return false; } catch { return true; } }), true);
      const result = await page.evaluate(() => window.__persistence!.inspect()); assert.equal(result.kind, status === 'pending' ? 'recovery-ready' : 'existing');
      assert.equal(await page.evaluate(() => window.__persistence!.writes()), 0);
      await page.evaluate(() => window.__persistence!.start());
      if (status === 'pending') {
        await page.locator('#migration-no').click(); await page.locator('#migration-inspect').click(); await page.locator('#migration-yes').click();
      }
      await page.locator('#count').filter({ hasText: '2件' }).waitFor(); await oldUnchanged(page);
      assert.equal(await page.evaluate(() => window.__persistence!.writes()), status === 'pending' ? 1 : 0);
    });
  });
  await run('複数タブ同一revision競合・明示再読込', async profile => withBrowser(profile, async (page, context) => {
    assert.equal((await page.evaluate(id => window.__persistence!.save(id, null), memoId)).kind, 'saved');
    const other = await context.newPage(); await other.goto(origin);
    const results = await Promise.all([page.evaluate(id => window.__persistence!.save(id, 1, 'タブA'), memoId), other.evaluate(id => window.__persistence!.save(id, 1, 'タブB'), memoId)]);
    assert.equal(results.filter(result => result.kind === 'saved').length, 1);
    assert.equal(results.filter(result => result.kind === 'rejected' && result.reason === 'conflict').length, 1);
    for (const tab of [page, other]) { const data = await tab.evaluate(() => window.__persistence!.load()); if (data.kind !== 'loaded') throw new Error('Expected loaded'); assert.equal(data.value.memos[0]!.revision, 2); }
  }));
  await run('複数タブ同時移行は上書きしない', async profile => withBrowser(profile, async (page, context) => {
    await seed(page); const other = await context.newPage(); await other.goto(origin);
    const results = await Promise.all([page.evaluate(() => window.__persistence!.migrate()), other.evaluate(() => window.__persistence!.migrate())]);
    assert.equal(results.filter(result => result.kind === 'migrated').length, 1);
    assert.equal(results.filter(result => result.kind === 'existing').length, 1); await oldUnchanged(page);
    assert.equal(await page.evaluate(() => window.__persistence!.writes()) + await other.evaluate(() => window.__persistence!.writes()), 2);
  }));
  await run('実Web Locks待機・保持タブ終了による解放', async profile => withBrowser(profile, async (page, context) => {
    const other = await context.newPage(); await other.goto(origin); await other.evaluate(() => window.__persistence!.holdLock());
    let resolved = false; const waiting = page.evaluate(() => window.__persistence!.load()).then(result => { resolved = true; return result; });
    await page.waitForTimeout(150); assert.equal(resolved, false); await other.close();
    let timeout: ReturnType<typeof setTimeout>;
    try { assert.equal((await Promise.race([waiting, new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Lock release timed out')), 5000); })])).kind, 'empty'); }
    finally { clearTimeout(timeout!); }
  }));
  await run('読取・書込・読戻し障害とロック非対応', async profile => withBrowser(profile, async page => {
    assert.equal((await page.evaluate(() => window.__persistence!.withoutLocks())).kind, 'stopped');
    await page.evaluate(() => window.__persistence!.setFault('get-storage')); assert.equal((await page.evaluate(() => window.__persistence!.load())).kind, 'unavailable');
    await page.evaluate(() => window.__persistence!.setFault('read')); assert.equal((await page.evaluate(() => window.__persistence!.load())).kind, 'unavailable');
    await page.evaluate(() => window.__persistence!.setFault('before-write'));
    const before = await page.evaluate(id => window.__persistence!.save(id, null), memoId); assert.equal(before.kind, 'unknown');
    assert.equal(await page.evaluate(() => window.__persistence!.writes()), 0);
    await page.evaluate(() => window.__persistence!.setFault('readback'));
    const after = await page.evaluate(id => window.__persistence!.save(id, null), memoId); assert.equal(after.kind, 'unknown');
    assert.equal(await page.evaluate(() => window.__persistence!.writes()), 1);
    await page.evaluate(() => window.__persistence!.setFault('')); assert.equal((await page.evaluate(() => window.__persistence!.load())).kind, 'loaded');
  }));
  await run('不正v2を補修・空一覧化しない', async profile => withBrowser(profile, async page => {
    await seed(page); await page.evaluate(() => window.__persistence!.corruptNew()); await page.evaluate(() => window.__persistence!.start());
    await page.locator('#migration-status').filter({ hasText: 'invalid-data' }).waitFor(); assert.equal(await page.locator('#memo-app').isHidden(), true); await oldUnchanged(page);
  }));
  for (const mode of ['pending', 'invalid'] as const) await run(`実保存先の診断→初回load変化：${mode}`, async profile => withBrowser(profile, async page => {
    await seed(page); assert.equal((await page.evaluate(() => window.__persistence!.migrate())).kind, 'migrated');
    await page.evaluate(value => window.__persistence!.changeBeforeNextLoad(value), mode); await page.evaluate(() => window.__persistence!.start());
    await page.locator('#migration-status').filter({ hasText: '通常画面の初回読込に失敗' }).waitFor(); assert.equal(await page.locator('#memo-app').isHidden(), true);
    await page.locator('#migration-inspect').click();
    if (mode === 'pending') {
      await page.locator('#migration-status').filter({ hasText: 'pendingを検出' }).waitFor(); await page.locator('#migration-yes').click();
      await page.locator('#count').filter({ hasText: '2件' }).waitFor();
    } else await page.locator('#migration-status').filter({ hasText: 'invalid-data' }).waitFor();
    await oldUnchanged(page);
  }));
  // 容量試験は必ず最後に、他試験とは独立した新規profileで行う。
  await run('上限付き実QuotaExceededError・旧値と既存v2保持', async profile => withBrowser(profile, async page => {
    await seed(page); assert.equal((await page.evaluate(() => window.__persistence!.migrate())).kind, 'migrated');
    const snapshot = await page.evaluate(() => window.__persistence!.snapshot()); const quota = await page.evaluate(() => window.__persistence!.fillQuota());
    assert.ok(quota.attempts <= 32 && quota.attemptedCharacters <= 16 * 1024 * 1024);
    if (!quota.quota) { process.stdout.write('UNVERIFIED quota: bounded attempts did not reproduce\n'); return; }
    const result = await page.evaluate(id => window.__persistence!.save(id, null, '容量試験', 'Q'.repeat(10000)), memoId);
    assert.equal(result.kind, 'unknown'); assert.equal(await page.evaluate(() => window.__persistence!.snapshot()), snapshot); await oldUnchanged(page);
    quotaVerified = true; process.stdout.write(`QUOTA reproduced attempts=${quota.attempts} attemptedCharacters=${quota.attemptedCharacters}\n`);
  }));
  process.stdout.write(`Persistence E2E: ${passed} passed; quota=${quotaVerified ? 'verified' : 'unverified'}\n`);
} finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }

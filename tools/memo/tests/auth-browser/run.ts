import { chromium } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createProfileOwner, prepareProfileBase } from '../persistence/profile-guard';
import { initializeContext, runOwnedCase } from '../persistence/lifecycle';
import { installAuthStorageGuard } from './storage-guard';
import type {} from './entry';

if (process.argv.length !== 2) throw new Error('Custom arguments forbidden');
const root = fileURLToPath(new URL('../', import.meta.url));
const { verifyAuthArtifact }: { verifyAuthArtifact(root: string, outfile: string): Promise<void> } =
  await import(new URL('../scripts/auth-sdk-patch.mjs', import.meta.url).href);
await verifyAuthArtifact(root, fileURLToPath(new URL('./auth.js', import.meta.url)));
const owner = await createProfileOwner(await prepareProfileBase(root));
const assets = new Map([['/', ['preview.html', 'text/html']], ['/auth.js', ['auth.js', 'text/javascript']]]);
let origin = '', passed = 0;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  if (req.headers.host !== origin.slice(7) || req.headers.origin && req.headers.origin !== origin) { res.writeHead(403).end(); return; }
  if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(405).end(); return; }
  const asset = assets.get(req.url ?? ''); if (!asset) { res.writeHead(404).end(); return; }
  try { const body = await readFile(new URL(`./${asset[0]}`, import.meta.url)); res.setHeader('Content-Type', `${asset[1]}; charset=utf-8`); res.writeHead(200).end(req.method === 'HEAD' ? undefined : body); }
  catch { res.writeHead(503).end(); }
});
await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const address = server.address();
if (!address || typeof address === 'string' || address.port === 4173) {
  await new Promise<void>(resolve => server.close(() => resolve())); throw new Error('Dedicated origin unavailable');
}
origin = `http://127.0.0.1:${address.port}`;

async function launch(profile: string, permit = true) {
  await owner.verify(profile);
  return initializeContext(() => chromium.launchPersistentContext(profile, {
    headless: true, serviceWorkers: 'block', acceptDownloads: false,
    proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1' },
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
  }), async context => {
    let errors = 0, leaks = 0, unexpectedRequests = 0;
    const watched = new WeakSet<Page>();
    const watch = (page: Page) => {
      if (watched.has(page)) return; watched.add(page);
      page.on('pageerror', () => errors++);
      page.on('console', message => { if (/synthetic-password|synthetic-refresh|eyJ/.test(message.text())) leaks++; });
    };
    context.on('page', watch); context.pages().forEach(watch);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || !assets.has(url.pathname) || url.search) { unexpectedRequests++; await route.abort(); }
      else await route.continue();
    });
    await context.addInitScript(installAuthStorageGuard, { permit, origin, runId: owner.runId });
    const page = await context.newPage(); await page.goto(origin);
    if (permit) {
      await page.waitForFunction(() => !!window.__authBrowser);
      await page.evaluate(() => window.__authBrowser!.ready());
    }
    else await page.locator('#status').filter({ hasText: 'boundary-stopped' }).waitFor();
    return { context, page, async close() {
      try { assert.equal(errors, 0); assert.equal(leaks, 0); assert.equal(unexpectedRequests, 0); assert.equal((await context.cookies()).length, 0); }
      finally { await context.close(); }
    } };
  });
}
async function withBrowser(profile: string, operation: (page: Page, context: BrowserContext) => Promise<void>, permit = true) {
  const browser = await launch(profile, permit);
  try { await operation(browser.page, browser.context); } finally { await browser.close(); }
}
async function run(name: string, operation: (profile: string) => Promise<void>) {
  const profile = await owner.create();
  await runOwnedCase(owner, profile, () => operation(profile), report => process.stderr.write(`${JSON.stringify(report)}\n`));
  passed++; process.stdout.write(`PASS ${name}\n`);
}
const phase = (page: Page, expected: string) => page.waitForFunction(value => window.__authBrowser!.state().phase === value, expected);
async function login(page: Page) { await page.locator('#login').click(); await phase(page, 'authenticated'); }
async function audit(page: Page) {
  const result = await page.evaluate(() => window.__authBrowser!.audit());
  assert.equal(result.denied, 0);
  const allowed = new Set(['myhomepage.memo.auth.v1', 'myhomepage.memo.auth.v1-user', 'myhomepage.memo.auth.v1-code-verifier', 'myhomepage.memo.auth.v1-flows-code-verifier']);
  assert.ok(result.touched.every(key => allowed.has(key))); return result;
}
try {
  await run('未許可起動はStorage取得0件で停止', profile => withBrowser(profile, async page => {
    assert.deepEqual(await page.evaluate(() => window.__authStorageAudit!()),
      { gets: 0, reads: 0, writes: 0, removals: 0, denied: 0, touched: [] });
  }, false));
  await run('実Storage保存・再読込・管理Chromium再起動からの復元', async profile => {
    await withBrowser(profile, async page => {
      await phase(page, 'signed-out'); await login(page); assert.equal(await page.evaluate(() => window.__authBrowser!.present()), true);
      await page.reload(); await page.waitForFunction(() => !!window.__authBrowser);
      await page.evaluate(() => window.__authBrowser!.ready()); await phase(page, 'authenticated');
      assert.equal((await audit(page)).calls.password, 0);
    });
    await withBrowser(profile, async page => {
      await phase(page, 'authenticated'); assert.equal(await page.evaluate(() => window.__authBrowser!.canWrite()), true);
      assert.equal((await audit(page)).calls.password, 0);
    });
  });
  await run('localログアウト・再読込後も未ログイン、専用キーだけを除去', profile => withBrowser(profile, async page => {
    await login(page); await page.evaluate(() => window.__authBrowser!.rememberContext());
    await page.locator('#logout').click(); await phase(page, 'signed-out');
    assert.equal(await page.evaluate(() => window.__authBrowser!.oldContextCurrent()), false);
    assert.equal(await page.evaluate(() => window.__authBrowser!.present()), false); assert.equal((await audit(page)).calls.logout, 1);
    await page.reload(); await page.waitForFunction(() => !!window.__authBrowser); await page.evaluate(() => window.__authBrowser!.ready());
    await phase(page, 'signed-out'); assert.equal(await page.evaluate(() => window.__authBrowser!.canWrite()), false); await audit(page);
  }));
  await run('期限切れ注入からSDK更新・旧context無効化', profile => withBrowser(profile, async page => {
    await login(page); await page.evaluate(() => { window.__authBrowser!.rememberContext(); window.__authBrowser!.expire(); });
    await page.locator('#restore').click(); await phase(page, 'authenticated');
    assert.equal(await page.evaluate(() => window.__authBrowser!.oldContextCurrent()), false); assert.equal((await audit(page)).calls.refresh, 1);
  }));
  for (const mode of ['refresh-denied', 'user-denied']) await run(`${mode}は書込停止・同一ユーザー再認証`, profile => withBrowser(profile, async page => {
    await login(page); await page.evaluate(value => {
      window.__authBrowser!.rememberContext(); window.__authBrowser!.mode(value);
      if (value === 'refresh-denied') window.__authBrowser!.expire();
    }, mode);
    await page.locator('#restore').click(); await phase(page, 'blocked');
    assert.equal(await page.evaluate(() => window.__authBrowser!.canWrite()), false);
    assert.equal(await page.evaluate(() => window.__authBrowser!.oldContextCurrent()), false);
    await page.evaluate(() => window.__authBrowser!.mode('')); await login(page);
    assert.equal(await page.evaluate(() => window.__authBrowser!.oldContextCurrent()), false); await audit(page);
  }));
  await run('Storage取得拒否は空セッション扱いせず停止・明示再初期化', profile => withBrowser(profile, async page => {
    await login(page); await page.evaluate(() => window.__authBrowser!.mode('get-storage'));
    await page.locator('#restore').click(); await phase(page, 'blocked');
    assert.equal(await page.evaluate(() => window.__authBrowser!.canWrite()), false);
    await page.evaluate(() => window.__authBrowser!.mode('')); await page.locator('#initialize').click(); await phase(page, 'authenticated'); await audit(page);
  }));
  await run('破棄・再初期化と処理中二重ログイン抑止', profile => withBrowser(profile, async page => {
    await page.evaluate(() => window.__authBrowser!.mode('slow-login'));
    const results = await page.evaluate(async () => {
      const first = window.__authBrowser!.perform('login'); const second = await window.__authBrowser!.perform('login'); return [await first, second];
    });
    assert.equal(results[1], 'busy'); await phase(page, 'authenticated'); assert.equal((await audit(page)).calls.password, 1);
    await page.evaluate(() => window.__authBrowser!.rememberContext()); await page.locator('#dispose').click(); await phase(page, 'disposed');
    assert.equal(await page.evaluate(() => window.__authBrowser!.canWrite()), false);
    await page.locator('#initialize').click(); await phase(page, 'authenticated');
    assert.equal(await page.evaluate(() => window.__authBrowser!.oldContextCurrent()), false); await audit(page);
  }));
  await run('複数タブのAuth通知・localログアウトで旧contextを失効', profile => withBrowser(profile, async (page, context) => {
    const other = await context.newPage(); await other.goto(origin); await other.waitForFunction(() => !!window.__authBrowser);
    await other.evaluate(() => window.__authBrowser!.ready());
    await login(page); await phase(other, 'authenticated');
    await other.evaluate(() => window.__authBrowser!.rememberContext());
    await page.locator('#logout').click(); await phase(page, 'signed-out'); await phase(other, 'blocked');
    assert.equal(await other.evaluate(() => window.__authBrowser!.canWrite()), false);
    assert.equal(await other.evaluate(() => window.__authBrowser!.oldContextCurrent()), false);
    assert.equal((await audit(other)).calls.password, 0); await audit(page);
  }));
  await run('他タブログアウト後の遅いSDK更新でセッションを復活させない', profile => withBrowser(profile, async (page, context) => {
    await login(page); await page.evaluate(() => window.__authBrowser!.rememberContext());
    const other = await context.newPage(); await other.goto(origin); await other.waitForFunction(() => !!window.__authBrowser);
    await other.evaluate(() => window.__authBrowser!.ready()); await phase(other, 'authenticated');
    await page.evaluate(() => { window.__authBrowser!.mode('hold-refresh'); window.__authBrowser!.expire(); });
    const restoring = page.evaluate(() => window.__authBrowser!.perform('restore'));
    await page.waitForFunction(() => window.__authBrowser!.refreshHeld());
    try {
      await other.locator('#logout').click(); await phase(other, 'signed-out');
      assert.equal(await other.evaluate(() => window.__authBrowser!.present()), false);
    } finally { await page.evaluate(() => window.__authBrowser!.releaseRefresh()); await restoring; }
    await phase(page, 'blocked'); assert.equal(await page.evaluate(() => window.__authBrowser!.present()), false);
    assert.equal(await page.evaluate(() => window.__authBrowser!.oldContextCurrent()), false);
    await audit(page); await audit(other);
  }));
  await run('実Web LocksとprocessLock・custom lock委譲を維持', profile => withBrowser(profile, async page => {
    const result = await page.evaluate(() => window.__authBrowser!.checkLocks());
    assert.deepEqual(result, { unavailable: true, reacquired: true, timedOut: true, processReacquired: true, customDelegated: true });
    await audit(page);
  }));
  process.stdout.write(`Auth browser: ${passed} passed; external Auth not connected\n`);
} finally { await new Promise<void>(resolve => server.close(() => resolve())); }

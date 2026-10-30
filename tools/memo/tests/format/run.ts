import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createProfileOwner, prepareProfileBase } from '../persistence/profile-guard';
import { initializeContext, runOwnedCase } from '../persistence/lifecycle';
import type {} from './entry';

if (process.argv.length !== 2) throw new Error('Custom paths forbidden');
const owner = await createProfileOwner(await prepareProfileBase(fileURLToPath(new URL('../', import.meta.url))));
let origin = '', passed = 0;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  if (req.headers.host !== origin.slice(7) || (req.headers.origin && req.headers.origin !== origin)) { res.writeHead(403).end(); return; }
  if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(405).end(); return; }
  const assets: Record<string, [string, string]> = { '/': ['preview.html', 'text/html'], '/format.js': ['format.js', 'text/javascript'] };
  const asset = assets[req.url ?? '']; if (!asset) { res.writeHead(404).end(); return; }
  try { const body = await readFile(new URL(`./${asset[0]}`, import.meta.url)); res.setHeader('Content-Type', `${asset[1]}; charset=utf-8`); res.writeHead(200).end(req.method === 'HEAD' ? undefined : body); }
  catch { res.writeHead(503).end(); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); if (!address || typeof address === 'string' || address.port === 4173) throw new Error('Origin rejected');
origin = `http://127.0.0.1:${address.port}`;
async function run(name: string, operation: (page: Page, other: () => Promise<Page>) => Promise<void>, permit = true) {
  const profile = await owner.create();
  await runOwnedCase(owner, profile, async () => {
    await owner.verify(profile);
    const browser = await initializeContext(() => chromium.launchPersistentContext(profile, {
      headless: true, serviceWorkers: 'block', acceptDownloads: false,
      proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1' },
      args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
    }), async context => {
      const errors: string[] = [], external: string[] = [];
      const watch = (page: Page) => page.on('pageerror', () => errors.push('pageerror'));
      context.on('page', watch); context.pages().forEach(watch);
      context.on('request', req => { if (new URL(req.url()).origin !== origin) external.push('external'); });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await context.addInitScript(value => {
        let count = 0; const getter = Object.getOwnPropertyDescriptor(window, 'localStorage')!.get!;
        Object.defineProperty(window, '__formatStorageReads', { get: () => count });
        Object.defineProperty(window, 'localStorage', { get() { ++count; return getter.call(window); } });
        if (value.permit) Object.defineProperty(window, '__persistencePermit', { value: Object.freeze({ origin: value.origin, runId: value.runId }) });
      }, { permit, origin, runId: owner.runId });
      const open = async () => { const page = await context.newPage(); await page.goto(origin); if (permit) await page.waitForFunction(() => !!window.__format); return page; };
      const page = await open();
      return { page, open, async close() {
        try { assert.equal(errors.length, 0); assert.equal(external.length, 0); assert.equal((await context.cookies()).length, 0); }
        finally { await context.close(); }
      } };
    });
    try { await operation(browser.page, browser.open); } finally { await browser.close(); }
  }, report => process.stderr.write(`${JSON.stringify(report)}\n`));
  ++passed; process.stdout.write(`PASS ${name}\n`);
}
const diagnose = async (page: Page, expected: string) => { await page.locator('#inspect').click(); await page.locator('#status').filter({ hasText: expected }).waitFor(); };
const snapshot = (page: Page) => page.evaluate(() => window.__format!.snapshot());
try {
  await run('未許可起動はStorage取得前に停止', async page => {
    assert.equal(await page.locator('#status').textContent(), 'boundary-stopped');
    assert.equal(await page.evaluate(() => (window as unknown as { __formatStorageReads: number }).__formatStorageReads), 0);
  }, false);
  await run('明示承認・取消・再診断・v3保守モード・旧コード停止', async page => {
    await page.evaluate(() => window.__format!.seed('v2')); const before = await snapshot(page);
    await diagnose(page, 'approval-required'); await page.locator('#cancel').click();
    assert.deepEqual(await snapshot(page), before);
    await diagnose(page, 'approval-required'); await page.locator('#approve').click();
    await page.locator('#outcome').filter({ hasText: 'updated' }).waitFor();
    const after = await snapshot(page); assert.equal(after.old, before.old);
    assert.deepEqual(JSON.parse(after.current!), { ...JSON.parse(before.current!), version: 3, deletedMemoIds: [] });
    assert.equal(await page.evaluate(async () => (await window.__format!.oldLoad()).kind), 'unavailable');
    assert.equal(await page.evaluate(async () => (await window.__format!.oldWrite()).kind), 'rejected');
    await diagnose(page, 'v3'); await page.evaluate(() => window.__format!.maintenance());
    assert.equal(await page.locator('#inspect').isDisabled(), true); assert.deepEqual(await snapshot(page), after);
    assert.equal(await page.evaluate(() => window.__format!.writes()), 1);
  });
  for (const mode of ['legacy', 'pending'] as const) await run(`${mode}は既存移行／復旧後に別承認で更新`, async page => {
    await page.evaluate(value => window.__format!.seed(value), mode); const before = await snapshot(page);
    await diagnose(page, mode === 'legacy' ? 'migration-required' : 'recovery-ready');
    await page.locator('#approve').click(); await page.locator('#outcome').filter({ hasText: mode === 'legacy' ? 'migrated' : 'recovered' }).waitFor();
    assert.equal(JSON.parse((await snapshot(page)).current!).version, 2);
    await diagnose(page, 'approval-required'); await page.locator('#approve').click(); await page.locator('#outcome').filter({ hasText: 'updated' }).waitFor();
    assert.equal((await snapshot(page)).old, before.old); assert.equal(JSON.parse((await snapshot(page)).current!).version, 3);
  });
  for (const fault of ['quota', 'after', 'readback']) await run(`${fault}後は古い承認を再利用せず再診断`, async page => {
    await page.evaluate(() => window.__format!.seed('v2')); await diagnose(page, 'approval-required');
    await page.evaluate(value => window.__format!.fault(value), fault); await page.locator('#approve').click();
    await page.locator('#outcome').filter({ hasText: 'unknown' }).waitFor(); assert.equal(await page.locator('#approve').isHidden(), true);
    await page.evaluate(() => window.__format!.fault(''));
    await diagnose(page, fault === 'quota' ? 'approval-required' : 'v3');
    assert.equal(await page.locator('#outcome').textContent(), 'unknown');
    if (fault === 'quota') { await page.locator('#approve').click(); await page.locator('#outcome').filter({ hasText: 'updated' }).waitFor(); }
  });
  await run('任意バックアップ相当のv2は更新不可', async page => {
    await page.evaluate(() => window.__format!.seed('backup')); const before = await snapshot(page);
    await diagnose(page, 'untrusted-v2'); assert.equal(await page.locator('#approve').isHidden(), true); assert.deepEqual(await snapshot(page), before);
  });
  await run('複数タブの古い承認は上書きしない', async (page, other) => {
    await page.evaluate(() => window.__format!.seed('v2')); await diagnose(page, 'approval-required');
    const second = await other(); await diagnose(second, 'untrusted-v2');
    // 同じ保存領域でも別ページへ許可を持ち越さない。
    await page.locator('#approve').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await page.locator('#outcome').filter({ hasText: 'updated' }).waitFor();
    await diagnose(second, 'v3'); assert.equal(await page.evaluate(() => window.__format!.writes()), 1);
  });
  await run('実Web Locks待機後の別タブ変更は旧承認で更新しない', async (page, other) => {
    await page.evaluate(() => window.__format!.seed('v2')); await diagnose(page, 'approval-required');
    const second = await other();
    const held = second.evaluate(() => navigator.locks.request('myhomepage.memo.data.v2.write', { mode: 'exclusive' }, async () => {
      const control = window as unknown as { holding: boolean; release: () => void };
      control.holding = true; await new Promise<void>(resolve => { control.release = resolve; });
    }));
    await second.waitForFunction(() => (window as unknown as { holding: boolean }).holding);
    await page.locator('#approve').click(); await page.locator('#status').filter({ hasText: 'running' }).waitFor();
    assert.equal(await page.evaluate(() => window.__format!.writes()), 0);
    await second.evaluate(() => {
      // ランナー所有の合成保存領域で、ロック保持中の別操作を再現する。
      const key = 'myhomepage.memo.data.v2', value = JSON.parse(localStorage.getItem(key)!);
      value.memos[0].title = '別タブの合成更新'; localStorage.setItem(key, JSON.stringify(value));
      (window as unknown as { release: () => void }).release();
    });
    await held; await page.locator('#outcome').filter({ hasText: 'rejected' }).waitFor();
    assert.equal(JSON.parse((await snapshot(page)).current!).version, 2);
    assert.equal(await page.evaluate(() => window.__format!.writes()), 0);
    await diagnose(page, 'untrusted-v2');
  });
  for (const mode of ['v3', 'v3-pending'] as const) await run(`${mode}保守は不変で書込停止`, async page => {
    await page.evaluate(value => window.__format!.seed(value), mode); const before = await snapshot(page);
    await diagnose(page, mode); await page.evaluate(() => window.__format!.maintenance());
    assert.equal(await page.locator('#status').textContent(), mode === 'v3' ? 'maintenance-v3' : 'maintenance-stopped');
    assert.deepEqual(await snapshot(page), before); assert.equal(await page.evaluate(() => window.__format!.writes()), 0);
  });
  for (const mode of ['invalid', 'unknown'] as const) await run(`${mode}は診断・保守の双方で非破壊停止`, async page => {
    await page.evaluate(value => window.__format!.seed(value), mode); const before = await snapshot(page);
    await diagnose(page, mode === 'invalid' ? 'invalid' : 'unknown-version');
    assert.equal(await page.locator('#approve').isHidden(), true);
    await page.evaluate(() => window.__format!.maintenance());
    assert.equal(await page.locator('#status').textContent(), 'maintenance-stopped');
    assert.deepEqual(await snapshot(page), before); assert.equal(await page.evaluate(() => window.__format!.writes()), 0);
  });
  process.stdout.write(`Format E2E: ${passed} passed\n`);
} finally { await new Promise<void>(resolve => server.close(() => resolve())); }

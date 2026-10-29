import { chromium } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createProfileOwner, prepareProfileBase } from '../persistence/profile-guard';
import { initializeContext, runOwnedCase } from '../persistence/lifecycle';
import type { PreservationReport } from '../persistence/lifecycle';
import { cacheOutcome, countOutcome, matchesStop } from './outcome';
import type { CaseOutcome, StopReason } from './outcome';
import type {} from './entry';

if (process.argv.length !== 2) throw new Error('Custom paths forbidden');
const owner = await createProfileOwner(await prepareProfileBase(fileURLToPath(new URL('../', import.meta.url))));
assert.equal((await readFile(new URL('./legacy.js', import.meta.url))).equals(await readFile(new URL('../js/memo.js', import.meta.url))), true);
let origin = '', active = 'legacy', fault = '';
let totals = { passed: 0, unverified: 0 };
const counts = new Map<string, number>();
const responses = new WeakMap<Page, Map<string, number>>();
// ブラウザのresponseイベントだけに依存せず、サーバーの欠落応答を確認する。
const missingResponses = new Set<string>();
const server = createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.headers.host !== origin.slice(7) || (req.headers.origin && req.headers.origin !== origin)) { res.writeHead(403).end(); return; }
  if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(405).end(); return; }
  const path = req.url ?? ''; counts.set(path, (counts.get(path) ?? 0) + 1);
  let file = '', type = '', cache = 'no-store';
  const mode = path === '/memo' ? active : path.slice(1);
  if (['seed', 'legacy', 'new', 'maintenance'].includes(mode)) {
    file = `${mode}-${mode === 'legacy' || mode === 'seed' ? 'sim-r1' : 'sim-r2'}.html`; type = 'text/html';
  } else if (path === '/assets/legacy.js') {
    if (fault === 'legacy-missing') { missingResponses.add(path); res.writeHead(404).end(); return; }
    file = 'legacy.js'; type = 'text/javascript'; cache = 'public, max-age=3600';
  } else {
    const match = /^\/assets\/(sim-r[12])\/(app.js|style.css)$/.exec(path);
    if (match) {
      const script = match[2] === 'app.js';
      if ((script && fault === 'js-missing') || (!script && fault === 'css-missing')) { missingResponses.add(path); res.writeHead(404).end(); return; }
      const id = ((script && fault === 'js-mix') || (!script && fault === 'css-mix')) ? (match[1] === 'sim-r1' ? 'sim-r2' : 'sim-r1') : match[1]!;
      file = `${id}.${script ? 'js' : 'css'}`; type = script ? 'text/javascript' : 'text/css'; cache = 'public, max-age=3600';
    }
  }
  if (!file) { res.writeHead(404).end(); return; }
  res.setHeader('Cache-Control', cache);
  try { const body = await readFile(new URL(`./${file}`, import.meta.url)); res.setHeader('Content-Type', `${type}; charset=utf-8`); res.writeHead(200).end(req.method === 'HEAD' ? undefined : body); }
  catch { res.writeHead(503).end(); }
});
await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const address = server.address();
if (!address || typeof address === 'string' || address.port === 4173) { await new Promise<void>(resolve => server.close(() => resolve())); throw new Error('Dedicated origin rejected'); }
origin = `http://127.0.0.1:${address.port}`;

async function launch(profile: string, cache = false, permit = true, badPermit = false, unexpected = false) {
  await owner.verify(profile);
  return initializeContext(() => chromium.launchPersistentContext(profile, {
    headless: true, serviceWorkers: 'block', acceptDownloads: false, proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1' },
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
  }), async context => {
    const errors: string[] = [], external: string[] = [];
    const watch = (page: Page) => {
      if (responses.has(page)) return;
      const statuses = new Map<string, number>(); responses.set(page, statuses);
      page.on('response', response => { const url = new URL(response.url()); if (url.origin === origin) statuses.set(url.pathname, response.status()); });
      page.on('pageerror', () => errors.push('pageerror')); page.on('dialog', dialog => { void dialog.accept(); });
    };
    context.on('page', watch); for (const page of context.pages()) watch(page);
    context.on('request', request => { if (new URL(request.url()).origin !== origin) external.push('external'); });
    // routingはブラウザHTTPキャッシュを無効化するため、実キャッシュ観測ケースだけは設定しない。
    if (!cache) await context.route('**/*', async route => { if (new URL(route.request().url()).origin !== origin) await route.abort(); else await route.continue(); });
    await context.addInitScript(value => {
      let reads = 0; const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
      Object.defineProperty(window, '__nativeStorageReads', { get: () => reads });
      Object.defineProperty(window, '__transitionBoot', { writable: true, value: { kind: 'not-started' } });
      if (value.unexpected) Object.defineProperty(window, '__transitionFault', { value: 'before-storage' });
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { reads++; return descriptor.get!.call(window); } });
      if (value.permit) Object.defineProperty(window, '__persistencePermit', { value: Object.freeze({ origin: value.origin, runId: value.runId }) });
    }, { origin: badPermit ? 'http://127.0.0.1:1' : origin, runId: owner.runId, permit, unexpected });
    return { context, async close() {
      try {
        assert.equal(errors.length, 0); assert.equal(external.length, 0); assert.equal((await context.cookies()).length, 0);
        for (const page of context.pages()) assert.equal(await page.evaluate(() => window.__transitionBoot?.kind === 'unexpected'), false, 'Unexpected boot failure');
      }
      finally { await context.close(); }
    } };
  });
}
async function run(name: string, operation: (context: BrowserContext) => Promise<void | CaseOutcome>, cache = false, permit = true, badPermit = false) {
  active = 'legacy'; fault = ''; missingResponses.clear();
  const profile = await owner.create();
  let outcome: CaseOutcome = 'pass';
  await runOwnedCase(owner, profile, async () => { const browser = await launch(profile, cache, permit, badPermit); try { outcome = (await operation(browser.context)) ?? 'pass'; } finally { await browser.close(); } }, value => process.stderr.write(`${JSON.stringify(value)}\n`));
  totals = countOutcome(totals, outcome); process.stdout.write(`${outcome === 'pass' ? 'PASS' : 'UNVERIFIED'} ${name}\n`);
}
async function open(context: BrowserContext, path: string, ready = true) {
  const page = await context.newPage(); await page.goto(origin + path);
  if (ready) await page.waitForFunction(() => !!window.__transition);
  return page;
}
const snapshot = (page: Page) => page.evaluate(async () => (await window.__transition!).snapshot());
async function assertStop(page: Page, reason: StopReason) {
  await page.waitForFunction(() => ['stopped', 'unexpected'].includes(window.__transitionBoot?.kind ?? ''));
  assert.equal(matchesStop(await page.evaluate(() => window.__transitionBoot), reason), true, 'Expected boot rejection reason');
}
async function seed(context: BrowserContext) { const page = await open(context, '/seed'); await page.evaluate(async () => (await window.__transition!).seed()); await page.close(); }
async function addOld(page: Page, title: string) { await page.locator('#title').fill(title); await page.locator('#memo-text').fill('合成旧本文'); await page.locator('#memo-submit-btn').click(); }
async function editOld(page: Page) { await page.locator('#memo-list li').first().getByRole('button', { name: '編集', exact: true }).click(); await page.locator('#title').fill('旧編集'); await page.locator('#memo-submit-btn').click(); }
async function deleteOld(page: Page) { await page.locator('#memo-list li').first().getByRole('button', { name: '削除', exact: true }).click(); }
async function approve(page: Page, count: number) { await page.locator('#migration-yes').click(); await page.locator('#count').filter({ hasText: `${count}件` }).waitFor(); }
async function addNew(page: Page) {
  await page.locator('#new').click(); await page.locator('#memo-title').fill('新版のみ'); await page.locator('#memo-body').fill('新版の合成本文'); await page.locator('#save').click();
  await page.locator('#detail-title').filter({ hasText: '新版のみ' }).waitFor(); await page.locator('#back').click();
}
try {
  await run('旧JSの追加・編集・削除・全削除と空旧配列移行', async context => {
    await seed(context); const old = await open(context, '/legacy'); const before = await snapshot(old); assert.equal(before.v2, null);
    await addOld(old, '旧追加'); assert.equal(await old.locator('#memo-list li').count(), 3);
    await editOld(old); assert.match(await old.locator('#memo-list').innerText(), /旧編集/);
    await deleteOld(old); assert.equal(await old.locator('#memo-list li').count(), 2);
    await old.locator('#memo-clear-all-btn').click(); assert.equal((await snapshot(old)).old, '[]');
    const next = await open(context, '/new'); await approve(next, 0); assert.equal((await snapshot(next)).old, '[]');
  });
  for (const action of ['add', 'edit', 'delete', 'clear']) await run(`移行確認後の旧タブ変更を拒否・再承認：${action}`, async context => {
    await seed(context); const old = await open(context, '/legacy'), next = await open(context, '/new'); await next.locator('#migration-yes').waitFor();
    if (action === 'add') await addOld(old, '承認後追加'); else if (action === 'edit') await editOld(old); else if (action === 'delete') await deleteOld(old); else await old.locator('#memo-clear-all-btn').click();
    await next.locator('#migration-yes').click(); await next.locator('#migration-status').filter({ hasText: 'approval-changed' }).waitFor(); assert.equal((await snapshot(next)).v2, null);
    await next.locator('#migration-inspect').click(); await approve(next, action === 'add' ? 3 : action === 'delete' ? 1 : action === 'clear' ? 0 : 2);
  });
  await run('旧タブを残す移行・新規更新の非反映・移行後旧CRUDのv2保全', async context => {
    await seed(context); const old = await open(context, '/legacy'), next = await open(context, '/new'); await approve(next, 2); await addNew(next);
    await next.getByRole('button', { name: '二件目', exact: true }).click(); await next.locator('#edit').click(); await next.locator('#memo-title').fill('新版更新'); await next.locator('#save').click(); await next.locator('#detail-title').filter({ hasText: '新版更新' }).waitFor();
    const changed = await snapshot(next); await old.reload(); await old.waitForFunction(() => !!window.__transition);
    assert.equal((await old.locator('#memo-list').innerText()).includes('新版'), false);
    await addOld(old, '移行後追加'); await editOld(old); await deleteOld(old); assert.equal((await snapshot(old)).v2 === changed.v2, true);
    await old.locator('#memo-clear-all-btn').click(); assert.equal((await snapshot(old)).old, '[]'); assert.equal((await snapshot(old)).v2 === changed.v2, true);
    await next.reload(); await next.locator('#count').filter({ hasText: '3件' }).waitFor();
    process.stdout.write('OBSERVED legacy drift before load is not permanently rejected by current v2 contract\n');
  });
  await run('旧版へのコード復帰・戻る・再読込でもv2を保持', async context => {
    await seed(context); const page = await open(context, '/memo'); active = 'new'; await page.goto(origin + '/new'); await approve(page, 2); await addNew(page); const before = await snapshot(page);
    active = 'legacy'; await page.goBack(); await page.waitForFunction(() => !!window.__transition); await addOld(page, '履歴旧版追加'); assert.equal((await snapshot(page)).v2 === before.v2, true);
    active = 'legacy'; await page.reload(); await page.waitForFunction(() => !!window.__transition); assert.equal((await page.locator('#memo-list').innerText()).includes('新版のみ'), false); assert.equal((await snapshot(page)).v2 === before.v2, true);
  });
  for (const pending of [true, false]) await run(`pending／不正v2の停止と保守版非破壊：${pending}`, async context => {
    await seed(context); const page = await open(context, '/new'); await page.evaluate(async p => { (await window.__transition!).fault(p ? 'after-pending' : 'invalid'); }, pending);
    if (pending) { await page.locator('#migration-yes').click(); await page.locator('#migration-status').filter({ hasText: '書込結果は未確認' }).waitFor(); }
    const before = await snapshot(page); await page.goto(origin + '/maintenance'); await page.waitForFunction(() => !!window.__transition); assert.match(await page.locator('#maintenance').innerText(), /通常利用を停止/); assert.equal((await snapshot(page)).v2 === before.v2, true);
    await page.goto(origin + '/new'); await page.waitForFunction(() => !!window.__transition); await page.locator('#migration-status').filter({ hasText: pending ? 'pendingを検出' : 'invalid-data' }).waitFor(); assert.equal(await page.locator('#memo-app').isHidden(), true);
    if (pending) await approve(page, 2);
  });
  await run('v2対応保守版は書込能力と逆変換を提供しない', async context => {
    await seed(context); const page = await open(context, '/new'); await approve(page, 2); await addNew(page); const before = await snapshot(page);
    active = 'maintenance'; await page.goto(origin + '/memo'); await page.waitForFunction(() => !!window.__transition); assert.match(await page.locator('#maintenance').innerText(), /検証済みv2 3件/);
    assert.equal(await page.evaluate(async () => (await window.__transition!).writes()), 0);
    assert.equal(await page.evaluate(async () => { try { (await window.__transition!).fault('invalid'); return false; } catch { return true; } }), true);
    const after = await snapshot(page); assert.equal(after.old === before.old && after.v2 === before.v2, true);
    await page.goto(origin + '/new'); await page.locator('#count').filter({ hasText: '3件' }).waitFor();
  });
  for (const scenario of ['js-mix', 'css-mix', 'js-missing', 'css-missing', 'legacy-missing']) await run(`意図的混在・資産欠落はStorage取得前に停止：${scenario}`, async context => {
    fault = scenario; const page = await open(context, scenario === 'legacy-missing' ? '/legacy' : '/new', false);
    if (scenario === 'js-missing') {
      assert.equal(responses.get(page)?.get('/assets/sim-r2/app.js'), 404);
      assert.equal(await page.evaluate(() => window.__transitionBoot?.kind), 'not-started');
    } else {
      const reason = ({ 'js-mix': 'release-mismatch', 'css-mix': 'css-mismatch', 'css-missing': 'css-unavailable', 'legacy-missing': 'legacy-asset-missing' } as const)[scenario as 'js-mix' | 'css-mix' | 'css-missing' | 'legacy-missing'];
      await assertStop(page, reason);
      if (scenario === 'css-missing') assert.equal(missingResponses.has('/assets/sim-r2/style.css'), true);
      if (scenario === 'legacy-missing') assert.equal(missingResponses.has('/assets/legacy.js'), true);
    }
    assert.equal(await page.evaluate(() => (window as unknown as { __nativeStorageReads: number }).__nativeStorageReads), 0);
    assert.equal(await page.evaluate(() => !!window.__transition), false);
  });
  await run('旧HTMLと新JSの混在も停止', async context => {
    fault = 'js-mix'; const page = await open(context, '/legacy', false); await assertStop(page, 'release-mismatch');
    assert.equal(await page.evaluate(() => (window as unknown as { __nativeStorageReads: number }).__nativeStorageReads), 0);
  });
  await run('許可なしは整合した資産でもStorage取得前に停止', async context => {
    const page = await open(context, '/new', false); await assertStop(page, 'permit-missing');
    assert.equal(await page.evaluate(() => (window as unknown as { __nativeStorageReads: number }).__nativeStorageReads), 0);
  }, false, false);
  await run('許可はあるがorigin不一致なら別理由で停止', async context => {
    const page = await open(context, '/new', false); await assertStop(page, 'environment-rejected');
    assert.equal(await page.evaluate(() => (window as unknown as { __nativeStorageReads: number }).__nativeStorageReads), 0);
  }, false, true, true);
  {
    // 予期しない例外は失敗・保全になること自体を確認し、意図した拒否にすり替えない。
    const profile = await owner.create(), reports: PreservationReport[] = []; let closed = false;
    await assert.rejects(runOwnedCase(owner, profile, async () => {
      const browser = await launch(profile, false, true, false, true); browser.context.on('close', () => { closed = true; });
      try {
        const page = await open(browser.context, '/new', false);
        await page.waitForFunction(() => window.__transitionBoot?.kind === 'unexpected');
        assert.equal(await page.evaluate(() => (window as unknown as { __nativeStorageReads: number }).__nativeStorageReads), 0);
        await assert.rejects(assertStop(page, 'release-mismatch'));
      } finally { await browser.close(); }
    }, value => reports.push(value)), /Unexpected boot failure/);
    assert.equal(closed, true); await owner.verify(profile);
    assert.deepEqual(reports, [{ event: 'PRESERVED', runId: owner.runId, profile, ownership: 'verified' }]);
    await owner.dispose(profile); totals = countOutcome(totals, 'pass'); process.stdout.write('PASS unexpected boot exception is rejected and profile preserved before verified cleanup\n');
  }
  await run('実HTTPキャッシュ再利用を別観測（意図的混在とは区別）', async context => {
    const first = await open(context, '/new'); await first.locator('#read-status').filter({ hasText: '完了' }).waitFor(); const before = counts.get('/assets/sim-r2/app.js') ?? 0;
    const second = await open(context, '/new'); await second.locator('#read-status').filter({ hasText: '完了' }).waitFor(); const delta = (counts.get('/assets/sim-r2/app.js') ?? 0) - before;
    const outcome = cacheOutcome(delta);
    process.stdout.write(outcome === 'pass' ? 'CACHE observed cached JS reuse; no real mixed-release event claimed\n' : 'UNVERIFIED actual HTTP cache reuse; harness mixing tested separately\n');
    return outcome;
  }, true);
  process.stdout.write(`Transition simulation: ${totals.passed} passed; ${totals.unverified} unverified\n`);
} finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }

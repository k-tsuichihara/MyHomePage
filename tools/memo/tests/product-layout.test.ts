import { beforeAll, afterAll, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { prepareProductPreview } from '../scripts/product-preview';

const root = new URL('../', import.meta.url);
let browser: Browser, fake: string;
beforeAll(async () => {
  execFileSync(process.execPath, ['scripts/build-product.mjs']);
  const layout = (await build({ entryPoints: [fileURLToPath(new URL('src/ui/product-layout.ts', root))], bundle: true, write: false, format: 'iife', globalName: 'ProductLayout' })).outputFiles[0]!.text;
  const fixture = (await build({ entryPoints: [fileURLToPath(new URL('tests/product-session-fixture.ts', root))], bundle: true, write: false, format: 'iife' })).outputFiles[0]!.text;
  fake = layout + '\nProductLayout.mountProductLayout(document);\n' + fixture;
  browser = await chromium.launch({ headless: true, proxy: { server: 'http://127.0.0.1:9' } });
}, 30000);
afterAll(async () => { await browser?.close(); });

async function fakeProduct(context: BrowserContext, mode: string) {
  await context.addInitScript(mode => Object.assign(window, { fixtureMode: mode }), mode);
  const url = await prepareProductPreview(context, root, false);
  const html = await readFile(new URL('.product/site/tools/memo/memo.html', root), 'utf8');
  await context.route('**/tools/memo/memo.html', route => route.fulfill({ contentType: 'text/html', body: html.replace(/<script type="module"[^>]*><\/script>/, '<script src="/layout-fixture.js"></script>') }));
  await context.route('**/layout-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fake }));
  const page = await context.newPage(); page.setDefaultTimeout(3000); await page.goto(url); return page;
}

it.each(['local', 'cloud'])('スマホ一覧のタグ検索幅・矢印余白とPC配置を維持する：%s', async mode => {
  for (const width of [320, 390, 650, 1200]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    try {
      const page = await fakeProduct(context, mode === 'cloud' ? 'cloud-assign-edit' : 'cloud-edit-signed-out');
      await page.locator(mode === 'cloud' ? '#product-cloud-items' : '#new').waitFor();
      await expect.poll(() => page.locator('.memo-product').getAttribute('data-page')).toBe('list');
      const controls = page.locator(mode === 'cloud' ? '#product-cloud-snapshot' : '#list-view');
      const search = controls.locator('.tag-search-row input'), reset = controls.locator('.tag-search-row button');
      const select = controls.locator('.sort-control select');
      const metrics = await controls.evaluate(node => {
        const rect = (selector: string) => { const r = node.querySelector(selector)!.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        const style = getComputedStyle(node.querySelector('.sort-control select')!);
        return { input: rect('.tag-search-row input'), manager: rect('.section-heading button'), reset: rect('.tag-search-row button'),
          sort: rect('.sort-control select'), appearance: style.appearance, padding: style.paddingRight,
          arrow: style.backgroundImage, position: style.backgroundPosition, repeat: style.backgroundRepeat };
      });
      expect(metrics.appearance).toBe('none'); expect(metrics.padding).toBe('42px');
      expect(metrics.arrow).toContain('data:image/svg+xml'); expect(metrics.position).toBe('calc(100% - 16px) 50%'); expect(metrics.repeat).toBe('no-repeat');
      if (width <= 650) {
        expect(Math.abs(metrics.reset.right - metrics.manager.right)).toBeLessThanOrEqual(1);
        expect(metrics.reset.top).toBe(metrics.input.top);
        expect(metrics.reset.left - metrics.input.right).toBeGreaterThanOrEqual(10);
        expect(metrics.sort.top).toBeGreaterThan(metrics.reset.bottom);
      } else {
        expect(metrics.reset.top).toBe(metrics.input.top);
        expect(metrics.sort.left).toBe(metrics.reset.left); expect(metrics.sort.right - metrics.sort.left).toBe(250);
      }
      const raw = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
      await search.fill('合成'); await search.fill(''); await reset.click(); await select.selectOption('created-asc');
      expect(await select.inputValue()).toBe('created-asc');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(raw);
      expect(await page.evaluate('fixture.calls.writes')).toBe(0);
      expect(await page.evaluate('fixture.rpcNames')).toEqual(mode === 'cloud' ? ['memo_load_snapshot'] : []);
      await page.screenshot({ path: fileURLToPath(new URL(`.product/final-tag-${mode}-${width}.png`, root)) });
    } finally { await context.close(); }
  }
}, 20000);

it.each(['local', 'cloud'])('一覧の新規作成は青・hoverは薄青で文字コントラストを保つ：%s', async mode => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
  try {
    let page;
    if (mode === 'cloud') page = await fakeProduct(context, 'cloud-assign-edit');
    else { const url = await prepareProductPreview(context, root, false); page = await context.newPage(); await page.goto(url); }
    const create = page.locator(mode === 'cloud' ? '.cloud-actions>button:first-child' : '#new'); await create.waitFor();
    await expect.poll(() => create.isEnabled()).toBe(true);
    await expect.poll(() => page.locator('.memo-product').getAttribute('data-page')).toBe('list');
    await page.mouse.move(0, 0);
    const normal = await create.evaluate(node => ({ bg: getComputedStyle(node).backgroundColor, fg: getComputedStyle(node).color }));
    await page.screenshot({ path: fileURLToPath(new URL(`.product/list-create-normal-${mode}.png`, root)) });
    await create.hover();
    const hover = await create.evaluate(node => ({ bg: getComputedStyle(node).backgroundColor, fg: getComputedStyle(node).color }));
    await page.screenshot({ path: fileURLToPath(new URL(`.product/list-create-hover-${mode}.png`, root)) });
    expect(normal).toEqual({ bg: 'rgb(39, 94, 157)', fg: 'rgb(255, 255, 255)' });
    expect(hover).toEqual({ bg: 'rgb(219, 234, 254)', fg: 'rgb(23, 63, 107)' });
    const luminance = (rgb: string) => rgb.match(/\d+/g)!.map(Number).map(value => { const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i]!, 0);
    for (const colors of [normal, hover]) {
      const a = luminance(colors.bg), b = luminance(colors.fg);
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  } finally { await context.close(); }
}, 15000);

it.each([[320, 568], [390, 667], [568, 320]])('縦に短いスマホでも操作領域をスクロールして一覧へ到達できる：%s×%s', async (width, height) => {
  const context = await browser.newContext({ viewport: { width: width!, height: height! }, serviceWorkers: 'block' });
  try {
    const url = await prepareProductPreview(context, root, false), page = await context.newPage();
    await page.goto(url); await page.locator('#new').waitFor();
    await page.locator('#new').click(); await page.locator('#memo-title').fill('短い画面の合成メモ');
    await page.locator('#save').click(); await page.locator('#detail-view').waitFor(); await page.locator('#back').click();
    const raw = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
    expect(await page.locator('#cards').evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(160);
    const main = page.locator('body > main'), box = await main.boundingBox();
    await page.mouse.move(box!.x + 20, box!.y + 30); await page.mouse.wheel(0, 2000);
    await expect.poll(() => main.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    const cards = await page.locator('#cards').boundingBox();
    expect(cards!.y).toBeGreaterThanOrEqual(box!.y);
    expect(cards!.y + cards!.height).toBeLessThanOrEqual(box!.y + box!.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/short-local-${width}-${height}.png`, root)) });
    await page.locator('#cards button.open-card').first().click(); await page.locator('#detail-title').filter({ hasText: '短い画面の合成メモ' }).waitFor();
    expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(raw);
  } finally { await context.close(); }
}, 15000);

it.each([[320, 568], [568, 320]])('短いスマホのcloud一覧へも縦スクロールで到達できる：%s×%s', async (width, height) => {
  const context = await browser.newContext({ viewport: { width: width!, height: height! }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-assign-edit'), rows = page.locator('#product-cloud-items');
    await rows.waitFor();
    expect(await rows.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(160);
    const main = page.locator('body > main'), box = await main.boundingBox();
    await page.mouse.move(box!.x + 20, box!.y + 30); await page.mouse.wheel(0, 2000);
    await expect.poll(() => main.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    const list = await rows.boundingBox();
    expect(list!.y).toBeGreaterThanOrEqual(box!.y);
    expect(list!.y + list!.height).toBeLessThanOrEqual(box!.y + box!.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/short-cloud-${width}-${height}.png`, root)) });
    await rows.locator('button.open-card').first().click();
    await page.getByText('クラウドメモ詳細（読取専用）', { exact: true }).waitFor();
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await page.evaluate('fixture.calls.writes')).toBe(0);
  } finally { await context.close(); }
}, 15000);

it.each([1200, 800, 650, 390, 320])('local切替領域とview別スクロールを保持しスマホ操作をまとめる：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const url = await prepareProductPreview(context, root, false), page = await context.newPage();
    await page.goto(url); await page.locator('#new').waitFor();
    await page.locator('#new').click(); await page.locator('#memo-title').fill('合成スクロール'); await page.locator('#save').click();
    await page.locator('#detail-view').waitFor();
    await page.evaluate(() => {
      const key = 'myhomepage.memo.data.v2', data = JSON.parse(localStorage.getItem(key)!);
      const seed = data.memos[0];
      data.memos = Array.from({ length: 60 }, (_, index) => ({ ...seed, id: crypto.randomUUID(), title: `合成 ${index}`, lastRequestId: null,
        deletedAt: index < 30 ? null : seed.updatedAt }));
      localStorage.setItem(key, JSON.stringify(data));
    });
    await page.reload(); await page.locator('#cards li').first().waitFor();
    expect(await page.locator('body > footer').isVisible()).toBe(true);
    expect(await page.locator('body > footer').count()).toBe(1);
    expect(await page.locator('body > footer .footer-title').textContent()).toBe('Kana Tsuichihara Portfolio');
    if (width <= 650) expect(await page.locator('body > footer').evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual(80);
    const raw = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
    const toggle = await page.locator('#trash-view').boundingBox(), top = await page.locator('#cards').evaluate(node => node.getBoundingClientRect().top);
    await page.locator('#cards').evaluate(node => { node.scrollTop = 420; });
    await page.locator('#trash-view').click(); await page.locator('#count').filter({ hasText: 'ゴミ箱' }).waitFor();
    expect(await page.locator('#normal-view').boundingBox()).toEqual(toggle);
    expect(await page.locator('#cards').evaluate(node => node.scrollTop)).toBe(0);
    expect(await page.locator('#cards').evaluate(node => node.getBoundingClientRect().top)).toBe(top);
    await page.locator('#cards').evaluate(node => { node.scrollTop = 230; });
    await page.locator('#normal-view').click(); await page.locator('#count').filter({ hasText: '通常メモ' }).waitFor();
    await expect.poll(() => page.locator('#cards').evaluate(node => node.scrollTop)).toBe(420);
    expect(await page.locator('#trash-view').boundingBox()).toEqual(toggle);
    await page.locator('#search').fill('合成'); await page.locator('#sort').selectOption('created-asc');
    await page.locator('#trash-view').click(); await page.locator('#count').filter({ hasText: 'ゴミ箱' }).waitFor();
    await expect.poll(() => page.locator('#cards').evaluate(node => node.scrollTop)).toBe(230);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(raw);
    const group = page.getByRole('group', { name: '一覧の操作', exact: true });
    expect(await group.getByRole('button', { name: '通常一覧', exact: true }).isVisible()).toBe(true);
    expect(await group.getByRole('button', { name: 'バックアップ・復元', exact: true }).isVisible()).toBe(true);
    expect(await group.getByRole('button', { name: '再読み込み', exact: true }).isVisible()).toBe(true);
    if (width <= 650) {
      expect(await page.locator('#list-voice-slot button').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(189, 40, 59)');
      expect(await page.locator('#list-voice-slot button').evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      const result = await page.evaluate(() => {
        const r = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        return { caption: getComputedStyle(document.querySelector('.sort-caption')!).fontWeight,
          heading: getComputedStyle(document.querySelector('.tag-controls h2')!).fontWeight,
          select: r('#sort').left, clear: r('#clear-tag-filters').left,
          tap: Array.from(document.querySelectorAll('.list-operation-group button:not([hidden])')).every(node => node.getBoundingClientRect().height >= 44),
          headerBottom: r('.tag-controls .section-heading').bottom, searchTop: r('.tag-search-row').top, searchBottom: r('.tag-search-row').bottom,
          tagsTop: r('.tag-chip-strip').top, tagsBottom: r('.tag-chip-strip').bottom, sortTop: r('.sort-caption').top };
      });
      expect(result.caption).toBe(result.heading); expect(result.tap).toBe(true);
      expect(await page.locator('#page-title').evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(40);
      expect(result.searchTop).toBeGreaterThanOrEqual(result.headerBottom);
      expect(result.tagsTop).toBeGreaterThanOrEqual(result.searchBottom);
      expect(result.sortTop).toBeGreaterThanOrEqual(result.tagsBottom);
    }
    await page.screenshot({ path: fileURLToPath(new URL(`.product/switch-local-${width}.png`, root)) });
  } finally { await context.close(); }
}, 15000);

it.each([1200, 390, 320])('cloud既存ListContextの切替位置・スクロールを維持する：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-list-scroll-views');
    const rows = page.locator('#product-cloud-items'); await rows.waitFor();
    const toggle = await page.getByRole('button', { name: 'クラウドゴミ箱', exact: true }).boundingBox();
    await rows.evaluate(node => { node.scrollTop = 420; });
    await page.getByRole('button', { name: 'クラウドゴミ箱', exact: true }).click();
    expect(await page.getByRole('button', { name: 'クラウド通常一覧', exact: true }).boundingBox()).toEqual(toggle);
    await rows.evaluate(node => { node.scrollTop = 230; });
    await page.getByRole('button', { name: 'クラウド通常一覧', exact: true }).click();
    await expect.poll(() => rows.evaluate(node => node.scrollTop)).toBe(420);
    await page.getByRole('button', { name: 'クラウドゴミ箱', exact: true }).click();
    await expect.poll(() => rows.evaluate(node => node.scrollTop)).toBe(230);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await page.evaluate('fixture.calls.writes')).toBe(0);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/switch-cloud-${width}.png`, root)) });
  } finally { await context.close(); }
}, 15000);

it('headed cloud製品画面も6幅で追従し、PC7項目とスマホ境界を維持する', async () => {
  const headed = await chromium.launch({ headless: false, proxy: { server: 'http://127.0.0.1:9' } });
  const context = await headed.newContext({ viewport: null, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-assign-edit');
    await page.locator('#product-cloud-items').waitFor();
    const cdp = await context.newCDPSession(page), { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    const samples = [];
    for (const width of [1200, 992, 900, 800, 651, 650, 390]) {
      const frame = await page.evaluate(() => outerWidth - innerWidth);
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: width + frame, height: 950 } });
      await page.waitForTimeout(150);
      const nativeWidth = await page.evaluate(() => innerWidth), emulated = nativeWidth !== width;
      if (emulated) {
        expect(width).toBe(390);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: false });
      }
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
      await page.screenshot({ path: fileURLToPath(new URL(`.product/width-cloud-${width}.png`, root)) });
      const sample = await page.evaluate(({ width, nativeWidth, emulated }) => {
        const rect = (selector: string) => { const node = document.querySelector(selector); if (!node) throw new Error(`Missing layout element: ${selector}`); const r = node.getBoundingClientRect(); return { width: r.width, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
        return { width, nativeWidth, emulated, scroll: document.documentElement.scrollWidth,
          roots: ['body', 'main', '.memo-page', '.memo-product'].map(rect),
          controls: ['.cloud-actions', '#product-cloud-snapshot .list-controls', '#product-cloud-snapshot .memo-search', '#product-cloud-snapshot .tag-search-row', '#product-cloud-snapshot .sort-control select'].map(rect),
          heading: rect('#product-cloud-snapshot .tag-controls h2'), manager: rect('#product-cloud-snapshot .tag-controls .section-heading button'),
          search: rect('#product-cloud-snapshot .tag-search-row'), clear: rect('#product-cloud-snapshot .tag-search-row button'), sort: rect('#product-cloud-snapshot .sort-control select'),
          caption: rect('#product-cloud-snapshot .pc-sort-caption'),
          bold: style('#product-cloud-snapshot .pc-sort-caption').fontWeight, headingBold: style('#product-cloud-snapshot .tag-controls h2').fontWeight,
          sortPadding: parseFloat(style('#product-cloud-snapshot .sort-control select').paddingRight), voiceColor: style('.cloud-actions .voice-memo-button').backgroundColor };
      }, { width, nativeWidth, emulated });
      expect(sample.scroll).toBeLessThanOrEqual(width);
      for (const box of [...sample.roots, ...sample.controls]) { expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width); }
      expect(await page.locator('#product-auth-open').textContent()).toBe('ログアウト / 保存先：クラウド');
      expect(await page.locator('.cloud-actions .voice-memo-button [aria-hidden=true]').textContent()).toBe('🎙');
      if (width > 650) {
        expect(sample.voiceColor).toBe('rgb(189, 40, 59)'); expect(sample.sortPadding).toBeGreaterThanOrEqual(40);
        expect(sample.manager.left).toBeGreaterThan(sample.heading.right);
        expect(sample.sort.left).toBe(sample.clear.left); expect(sample.caption.right).toBeLessThan(sample.sort.left); expect(sample.bold).toBe(sample.headingBold);
        expect(sample.search.top - sample.manager.bottom).toBeGreaterThanOrEqual(12);
      }
      samples.push(sample); await page.screenshot({ path: fileURLToPath(new URL(`.product/width-cloud-${width}.png`, root)) });
      if (emulated) await cdp.send('Emulation.clearDeviceMetricsOverride');
    }
    await writeFile(new URL('.product/width-cloud.json', root), JSON.stringify(samples, null, 2));
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await page.evaluate('fixture.calls.writes')).toBe(0);
  } finally { await context.close(); await headed.close(); }
}, 20000);

it.each(['local', 'cloud'])('スマホ一覧では成功通知だけを次の明示操作で閉じる：%s', async mode => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, mode === 'cloud' ? 'cloud-assign-edit' : 'cloud-edit-signed-out');
    await page.locator(mode === 'cloud' ? '#product-cloud-items' : '#new').waitFor();
    for (const operation of ['click', 'input']) {
      // 通知の結果分類は変更せず、layoutのdismiss対象だけを確認する。
      await page.evaluate(() => {
        document.getElementById('notice-probe')?.remove();
        const group = document.createElement('div'); group.id = 'notice-probe';
        for (const kind of ['succeeded', 'rejected', 'unknown']) {
          const p = document.createElement('p'); p.dataset.notice = kind; p.textContent = `通知：${kind}`; group.append(p);
        }
        document.querySelector('.memo-product')!.append(group);
      });
      const success = page.locator('#notice-probe [data-notice=succeeded]');
      expect(await success.isVisible()).toBe(true);
      if (operation === 'click') {
        await page.locator('#product-auth-open').click();
        await page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true }).getByRole('button', { name: '閉じる', exact: true }).click();
      } else await (mode === 'cloud' ? page.getByLabel('クラウドの検索', { exact: true }) : page.locator('#search')).fill('確認');
      expect(await success.isVisible()).toBe(false);
      expect(await page.locator('#notice-probe [data-notice=rejected]').isVisible()).toBe(true);
      expect(await page.locator('#notice-probe [data-notice=unknown]').isVisible()).toBe(true);
    }
    expect(await page.evaluate('fixture.calls.writes')).toBe(0);
  } finally { await context.close(); }
}, 15000);

it.each([1440, 390, 320])('定型通知を省略してもlocal/cloudのエラー・UNKNOWNは操作後も表示する：幅%s', async width => {
  for (const failure of ['unknown', 'rejected', 'cloud']) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    try {
      const page = await fakeProduct(context, failure === 'cloud' ? 'cloud-failure' : 'cloud-edit-signed-out');
      if (failure !== 'cloud') {
        await page.locator('#new').waitFor();
        expect(await page.locator('.statuses').isVisible()).toBe(false);
        await page.evaluate(failure === 'unknown' ? 'fixture.failWrites()' : 'fixture.failReads(true)'); await page.evaluate('fixture.saveTag()');
        await page.locator('#save-status').filter({ hasText: failure === 'unknown' ? '保存結果は不明' : '拒否' }).waitFor();
        await page.locator('#product-auth-open').click();
        await page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true }).getByRole('button', { name: '閉じる', exact: true }).click();
        expect(await page.locator('#save-status').isVisible()).toBe(true);
      } else {
        await page.locator('#product-cloud-state').filter({ hasText: 'UNKNOWN' }).waitFor();
        await page.locator('#product-auth-open').click();
        await page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true }).getByRole('button', { name: '閉じる', exact: true }).click();
        expect(await page.locator('#product-cloud-state').isVisible()).toBe(true);
        expect(await page.locator('#product-cloud-trash-state').isVisible()).toBe(false);
      }
    } finally { await context.close(); }
  }
}, 15000);

it('cloudの明示再読取では古い成功案内だけを片付ける', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-pin');
    await page.locator('#product-cloud-items button.open-card').first().click();
    await page.getByRole('button', { name: 'ピン留め', exact: true }).click();
    await page.locator('#product-cloud-trash-state').filter({ hasText: '要求の成功を確認' }).waitFor();
    await page.locator('#product-auth-open').click();
    await page.getByRole('button', { name: 'ローカルを選択', exact: true }).click();
    await page.locator('#product-auth-open').click();
    await page.getByRole('button', { name: 'クラウドを選択', exact: true }).click();
    await page.locator('#product-cloud-items').waitFor();
    expect(await page.locator('#product-cloud-trash-state').textContent()).toBe('');
    expect(await page.locator('#product-cloud-trash-state').isVisible()).toBe(false);
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_change_state', 'memo_load_snapshot']);
  } finally { await context.close(); }
}, 15000);

it.each(['local', 'cloud'])('全幅の編集画面で上部ナビと左右の停止/保存・前回表示を維持する：%s', async mode => {
  for (const width of [1200, 900, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    try {
      const page = await fakeProduct(context, mode === 'local' ? 'cloud-voice-existing-signed-out' : 'cloud-voice-existing');
      if (mode === 'local') { await page.locator('#new').waitFor(); await page.locator('#new').click(); }
      else { await page.locator('#product-cloud-items').waitFor(); await page.locator('#product-cloud-items button.open-card').first().click(); await page.getByRole('button', { name: 'このクラウドメモを編集', exact: true }).click(); }
      const editor = page.locator(mode === 'local' ? '#editor-view' : '#product-cloud-editor'); await editor.waitFor();
      const title = mode === 'local' ? page.locator('#memo-title') : page.getByLabel('クラウドのタイトル', { exact: true });
      const body = mode === 'local' ? page.locator('#memo-body') : page.getByLabel('クラウドの本文', { exact: true });
      await title.fill('配置確認'); await body.fill('保存する本文');
      const rect = async (selector: string) => editor.locator(selector).evaluate(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
      if (mode === 'local') {
        const previous = await rect('#editor-previous'), duplicate = await rect('#editor-duplicate'), next = await rect('#editor-next');
        expect(previous.left).toBeLessThan(duplicate.left); expect(duplicate.right).toBeLessThan(next.left);
        expect(previous.top).toBe(next.top); expect(next.right).toBe((await rect(':scope>.detail-actions')).right);
        expect((await rect('#memo-form>label')).top - next.bottom).toBeGreaterThanOrEqual(14);
        expect(await page.getByRole('button', { name: '< 一覧へ', exact: true }).isVisible()).toBe(true);
        expect(await page.locator('#lengths').isVisible()).toBe(false); expect(await editor.locator('.editor-footer>p').isVisible()).toBe(false);
      } else expect(await editor.getByRole('button', { name: '< 一覧へ', exact: true }).isVisible()).toBe(true);
      expect(await editor.locator('.editor-tag-hint').evaluate(node => getComputedStyle(node).fontSize)).toBe('12px');
      const voice = editor.getByRole('button', { name: '音声で本文へ追記', exact: true });
      await page.mouse.move(0, 0); expect(await voice.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(189, 40, 59)');
      const voiceBox = (await voice.boundingBox())!, note = await rect('.voice-service-notice');
      expect(voiceBox.height).toBeLessThanOrEqual(50);
      expect(note.top).toBeGreaterThanOrEqual(voiceBox.y + voiceBox.height);
      expect(note.bottom).toBeLessThanOrEqual((await body.boundingBox())!.y);
      const footer = editor.locator('.editor-footer');
      const stop = footer.getByRole('button', { name: '音声入力を停止', exact: true }), save = footer.getByRole('button', { name: '保存する', exact: true });
      const a = (await stop.boundingBox())!, b = (await save.boundingBox())!, f = (await footer.boundingBox())!;
      expect(a.y).toBe(b.y); expect(a.x).toBe(f.x); expect(b.x + b.width).toBe(f.x + f.width);
      expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(12);
      for (const button of [stop, save]) expect(await button.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await editor.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate('fixture.calls.writes')).toBe(0);
      expect(await page.evaluate('fixture.rpcNames')).toEqual(mode === 'cloud' ? ['memo_load_snapshot'] : []);
      await editor.evaluate(node => { node.scrollTop = 0; });
      await page.screenshot({ path: fileURLToPath(new URL(`.product/editor-actions-top-${mode}-${width}.png`, root)) });
      await voice.click(); await expect.poll(() => stop.isEnabled()).toBe(true);
      await stop.click(); expect(await page.evaluate('fixture.voiceCalls.start')).toBe(1); expect(await page.evaluate('fixture.voiceCalls.abort')).toBe(1);
      await save.scrollIntoViewIfNeeded(); await page.screenshot({ path: fileURLToPath(new URL(`.product/editor-actions-${mode}-${width}.png`, root)) });
      await save.click();
      if (mode === 'local') { await page.locator('#detail-view').waitFor(); expect(await page.evaluate('fixture.calls.writes')).toBe(1); }
      else { await editor.getByRole('status').filter({ hasText: '成功' }).waitFor(); expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save']); expect(await page.evaluate('fixture.calls.writes')).toBe(0); }
      expect(await page.evaluate('fixture.calls.fetch')).toBe(0);
    } finally { await context.close(); }
  }
}, 25000);

it.each([1200, 900, 651, 390])('長いlocal本文は操作へ重ならず詳細内をスクロールして読める：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 800 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out'); await page.locator('#new').waitFor();
    const content = Array.from({ length: 100 }, (_, index) => `長文${index}：${'折り返す本文'.repeat(10)}`).join('\n');
    await page.locator('#new').click(); await page.locator('#memo-title').fill('長文の合成メモ'); await page.locator('#memo-body').fill(content);
    await page.locator('#save').click(); await page.locator('#detail-view').waitFor();
    const before = await page.evaluate('fixture.calls.writes');
    const metrics = await page.locator('#detail-view').evaluate(node => {
      const body = node.querySelector('#detail-body')!;
      const rect = body.getBoundingClientRect();
      return { height: rect.height, bottom: rect.bottom, client: body.clientHeight, scroll: body.scrollHeight,
        editing: node.querySelector('#edit')!.getBoundingClientRect().top,
        voice: node.querySelector('#detail-voice-slot')!.getBoundingClientRect().top,
        nav: node.querySelector('#previous')!.getBoundingClientRect().top, viewport: node.clientHeight };
    });
    expect(metrics.height).toBeGreaterThan(metrics.viewport);
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.client + 1);
    expect(metrics.bottom).toBeLessThanOrEqual(metrics.editing);
    expect(metrics.bottom).toBeLessThanOrEqual(metrics.voice);
    if (width > 650) expect(metrics.bottom).toBeLessThanOrEqual(metrics.nav);
    expect(await page.locator('#detail-body').textContent()).toBe(content);
    await page.locator('#edit').scrollIntoViewIfNeeded();
    expect(await page.locator('#detail-view').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/long-detail-${width}.png`, root)) });
    await page.locator('#edit').click(); expect(await page.locator('#memo-body').inputValue()).toBe(content);
    expect(await page.evaluate('fixture.calls.writes')).toBe(before);
    expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
  } finally { await context.close(); }
}, 15000);

it.each([1200, 900, 390])('local詳細/編集のPC表示を調整しスマホ・保存契約を維持する：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out'); await page.locator('#new').waitFor();
    await page.locator('#new').click(); await page.locator('#memo-title').fill('PC表示のメモ'); await page.locator('#memo-body').fill('本文');
    await page.locator('#save').click(); await page.locator('#detail-view').waitFor();
    const before = await page.evaluate('fixture.calls.writes');
    expect(await page.getByRole('button', { name: '〈 前のメモ', exact: true }).count()).toBe(1);
    expect(await page.getByRole('button', { name: '次のメモ 〉', exact: true }).count()).toBe(1);
    const rect = async (selector: string) => page.locator(selector).evaluate(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    if (width > 650) {
      expect(await page.getByRole('button', { name: '< 一覧へ', exact: true }).isVisible()).toBe(true);
      const previous = await rect('#previous'), duplicate = await rect('#duplicate'), next = await rect('#next');
      expect(previous.left).toBeLessThan(duplicate.left); expect(duplicate.right).toBeLessThan(next.left);
      expect(next.right).toBe((await rect('#detail-view>.detail-actions:first-child')).right);
      expect(previous.top).toBeGreaterThanOrEqual((await rect('#detail-body')).bottom);
    } else expect(await page.getByRole('button', { name: '← 一覧へ', exact: true }).isVisible()).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/pc-detail-local-${width}.png`, root)) });
    await page.locator('#edit').click(); await page.locator('#editor-view').waitFor();
    const voice = page.locator('#editor-voice-slot button');
    await page.mouse.move(0, 0);
    expect(await voice.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(189, 40, 59)');
    expect(await page.locator('#lengths').isVisible()).toBe(false);
    expect(await page.locator('.editor-footer>p').isVisible()).toBe(false);
    if (width > 650) {
      const previous = await rect('#editor-previous'), duplicate = await rect('#editor-duplicate'), next = await rect('#editor-next');
      expect(previous.left).toBeLessThan(duplicate.left); expect(duplicate.right).toBeLessThan(next.left);
      expect(next.right).toBe((await rect('#editor-view>.detail-actions')).right);
      expect((await rect('#memo-form>label')).top - (await rect('#editor-view>.detail-actions')).bottom).toBeGreaterThanOrEqual(14);
      expect(await page.locator('#memo-form .editor-tag-hint').evaluate(node => getComputedStyle(node).fontSize)).toBe('12px');
      const note = await rect('#editor-voice-controls-slot .voice-service-notice');
      expect(note.top).toBeGreaterThanOrEqual((await rect('#editor-voice-slot')).bottom);
      expect(note.bottom).toBeLessThanOrEqual((await rect('#memo-body')).top);
      expect(await voice.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(await page.locator('#list-voice-slot button').evaluate(node => getComputedStyle(node).backgroundColor));
      expect(await voice.evaluate(node => ({ color: getComputedStyle(node).color, border: getComputedStyle(node).borderColor }))).toEqual(
        await page.locator('#list-voice-slot button').evaluate(node => ({ color: getComputedStyle(node).color, border: getComputedStyle(node).borderColor })));
      await voice.hover(); expect(await voice.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(159, 32, 49)');
      await page.mouse.move(0, 0);
    } else {
      expect(await page.locator('#editor-next').evaluate(node => getComputedStyle(node).order)).toBe('0');
      expect((await rect('#editor-voice-controls-slot .voice-service-notice')).bottom).toBeLessThanOrEqual((await rect('#memo-body')).top);
    }
    expect(await page.evaluate('fixture.calls.writes')).toBe(before);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/pc-editor-local-${width}.png`, root)) });
    if (width > 650) { await page.locator('#editor-next').scrollIntoViewIfNeeded(); await page.screenshot({ path: fileURLToPath(new URL(`.product/pc-editor-nav-local-${width}.png`, root)) }); }
    await page.locator('#memo-title').fill('あ'.repeat(101)); await page.locator('#save').click();
    await page.locator('#error').filter({ hasText: '入力を確認' }).waitFor();
    expect(await page.evaluate('fixture.calls.writes')).toBe(before);
    await page.locator('#memo-title').fill('未保存の変更'); await page.locator('#back').click();
    await page.locator('#confirmation').waitFor(); await page.locator('#confirm-no').click();
    expect(await page.locator('#memo-title').inputValue()).toBe('未保存の変更');
    expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
  } finally { await context.close(); }
}, 15000);

it.each([1200, 390])('cloud詳細/編集のPC表示と複製・スマホ表示を維持する：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-assign-edit-success'); await page.locator('#product-cloud-items').waitFor();
    await page.locator('#product-cloud-items button.open-card').first().click();
    const snapshotRoot = page.locator('#product-cloud-snapshot');
    if (width > 650) {
      const previous = await snapshotRoot.getByRole('button', { name: '〈 前のメモ', exact: true }).boundingBox();
      const duplicate = await snapshotRoot.getByRole('button', { name: '複製', exact: true }).boundingBox();
      const next = await snapshotRoot.getByRole('button', { name: '次のメモ 〉', exact: true }).boundingBox();
      expect(previous!.x).toBeLessThan(duplicate!.x); expect(duplicate!.x).toBeLessThan(next!.x);
      expect(Math.abs(previous!.y - next!.y)).toBeLessThanOrEqual(1);
      expect(await snapshotRoot.getByRole('button', { name: '< 一覧へ', exact: true }).isVisible()).toBe(true);
    } else expect(await snapshotRoot.getByRole('button', { name: 'クラウド一覧へ戻る', exact: true }).isVisible()).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/pc-detail-cloud-${width}.png`, root)) });
    await snapshotRoot.getByRole('button', { name: width > 650 ? '複製' : 'このクラウドメモを複製', exact: true }).click();
    const editor = page.locator('#product-cloud-editor'); await editor.waitFor();
    const voice = editor.getByRole('button', { name: '音声で本文へ追記', exact: true });
    await page.mouse.move(0, 0);
    expect(await voice.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(189, 40, 59)');
    if (width > 650) {
      expect(await editor.locator('.editor-tag-hint').evaluate(node => getComputedStyle(node).fontSize)).toBe('12px');
      expect(await editor.locator('.pc-title-field').evaluate(node => getComputedStyle(node).marginTop)).toBe('14px');
      const note = await editor.locator('.voice-service-notice').boundingBox();
      const body = await page.getByLabel('クラウドの本文', { exact: true }).boundingBox();
      expect(note!.y + note!.height).toBeLessThanOrEqual(body!.y);
      await editor.getByRole('button', { name: '< 一覧へ', exact: true }).click();
    } else await editor.getByRole('button', { name: '< 一覧へ', exact: true }).click();
    await editor.getByRole('button', { name: 'クラウド編集を続ける', exact: true }).click();
    expect(await page.getByLabel('クラウドのタイトル', { exact: true }).inputValue()).toContain('クラウド');
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/pc-editor-cloud-${width}.png`, root)) });
    await editor.evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: fileURLToPath(new URL(`.product/pc-editor-top-cloud-${width}.png`, root)) });
  } finally { await context.close(); }
}, 15000);

it.each(['local', 'cloud'])('スマホのタグ列タイトルと名前/件数を同じ行に揃えPC配置を維持する：%s', async mode => {
  for (const width of [1200, 650, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    try {
      const page = await fakeProduct(context, mode === 'cloud' ? 'cloud-tag-delete-success' : 'cloud-edit-signed-out');
      await page.locator(mode === 'cloud' ? '#product-cloud-items' : '#new').waitFor();
      await page.getByRole('button', { name: 'タグ管理', exact: true }).last().click();
      const dialog = page.getByRole('dialog', { name: mode === 'cloud' ? 'クラウドタグ管理' : 'タグ管理', exact: true });
      if (mode === 'local') {
        await dialog.getByLabel('新規タグ名').fill('長いタグ名'.repeat(6));
        await dialog.getByRole('button', { name: '＋追加', exact: true }).click();
      }
      const row = dialog.locator('.tag-manager-row').first(); await row.waitFor();
      expect(await dialog.locator('.tag-manager-columns').isVisible()).toBe(true);
      expect(await dialog.locator('.tag-manager-columns').allTextContents()).toEqual(['タグ名使用メモ数']);
      const metrics = await dialog.evaluate(node => {
        const rect = (selector: string) => { const r = node.querySelector(selector)!.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, center: (r.top + r.bottom) / 2 }; };
        const style = getComputedStyle(node.querySelector('.tag-manager-columns')!);
        return { headerName: rect('.tag-manager-columns>span:first-child'), headerCount: rect('.tag-manager-columns>span:nth-child(2)'),
          name: rect('.tag-manager-row>span:first-child'), count: rect('.tag-manager-row>span:nth-child(2)'),
          edit: rect('.tag-manager-row>button'), search: rect('input[type=search]'),
          font: style.fontSize, color: style.color, overflow: node.scrollWidth > node.clientWidth };
      });
      expect(metrics.font).toBe('13px'); expect(metrics.color).toBe('rgb(104, 118, 138)');
      expect(metrics.headerName.top).toBeGreaterThan(metrics.search.bottom);
      expect(Math.abs(metrics.name.left - metrics.headerName.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.count.left - metrics.headerCount.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.name.center - metrics.count.center)).toBeLessThanOrEqual(1);
      expect(metrics.overflow).toBe(false);
      if (width <= 650) expect(metrics.edit.top).toBeGreaterThanOrEqual(Math.max(metrics.name.bottom, metrics.count.bottom));
      else expect(Math.abs(metrics.edit.center - metrics.name.center)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: fileURLToPath(new URL(`.product/tag-columns-${mode}-${width}.png`, root)) });
      const before = await page.evaluate('fixture.rpcNames.slice()');
      const writes = await page.evaluate('fixture.calls.writes');
      await row.getByRole('button', { name: '編集', exact: true }).click();
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: fileURLToPath(new URL(`.product/tag-columns-edit-${mode}-${width}.png`, root)) });
      await row.getByRole('button', { name: 'キャンセル', exact: true }).click();
      expect(await page.evaluate('fixture.rpcNames.slice()')).toEqual(before);
      expect(await page.evaluate('fixture.calls.writes')).toBe(writes);
      expect(await page.evaluate('fixture.calls.fetch')).toBe(0);
    } finally { await context.close(); }
  }
}, 20000);

it.each(['local', 'cloud'])('タグ管理の見出し階層と2領域の余白・短い説明文を揃える：%s', async mode => {
  for (const width of [1200, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    try {
      const page = await fakeProduct(context, mode === 'cloud' ? 'cloud-tag-delete-success' : 'cloud-edit-signed-out');
      await page.locator(mode === 'cloud' ? '#product-cloud-items' : '#new').waitFor();
      await page.getByRole('button', { name: 'タグ管理', exact: true }).last().click();
      const dialog = page.getByRole('dialog', { name: mode === 'cloud' ? 'クラウドタグ管理' : 'タグ管理', exact: true });
      const metrics = await dialog.evaluate(node => {
        const sections = node.querySelectorAll('.tag-manager-content>section');
        const gap = (section: Element) => section.querySelector('input')!.getBoundingClientRect().top - section.querySelector('h3')!.getBoundingClientRect().bottom;
        return { title: getComputedStyle(node.querySelector('.dialog-heading h2')!).fontSize,
          sub: getComputedStyle(sections[0]!.querySelector('h3')!).fontSize,
          createGap: gap(sections[0]!), registeredGap: gap(sections[1]!), overflow: node.scrollWidth > node.clientWidth };
      });
      expect(metrics.title).toBe('22px'); expect(metrics.sub).toBe('17px');
      expect(metrics.createGap).toBeGreaterThanOrEqual(14);
      expect(Math.abs(metrics.createGap - metrics.registeredGap)).toBeLessThanOrEqual(1);
      expect(metrics.overflow).toBe(false);
      const notice = dialog.locator('.tag-manager-content>p');
      expect(await notice.textContent()).toBe('タグ削除時は関連する全メモ（ゴミ箱内を含む）からタグを外します。');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: fileURLToPath(new URL(`.product/tag-dialog-final-${mode}-${width}.png`, root)) });
      await dialog.getByRole('button', { name: 'タグ管理を閉じる', exact: true }).click();
      expect(await dialog.isVisible()).toBe(false);
      expect(await page.evaluate('fixture.rpcNames')).toEqual(mode === 'cloud' ? ['memo_load_snapshot'] : []);
      expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    } finally { await context.close(); }
  }
}, 15000);

it.each([1200, 390, 320])('localタグ管理は上部追加・行編集/取消・検索・既存削除確認を使う：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out'); await page.locator('#new').waitFor();
    await page.getByRole('button', { name: 'タグ管理', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'タグ管理', exact: true });
    expect(await dialog.getByRole('button', { name: '閉じる', exact: true }).count()).toBe(0);
    const create = dialog.getByRole('region', { name: 'タグの新規作成', exact: true });
    for (const name of ['仕事', '勉強']) {
      await create.getByLabel('新規タグ名').fill(name); await create.getByRole('button', { name: '＋追加', exact: true }).click();
      await dialog.getByRole('group', { name: `タグ「${name}」`, exact: true }).waitFor();
    }
    const row = dialog.getByRole('group', { name: 'タグ「仕事」', exact: true });
    expect(await row.getByText('0件', { exact: true }).isVisible()).toBe(true);
    const before = await page.evaluate('fixture.calls.writes');
    await dialog.getByLabel('管理タグを検索').fill('仕事');
    expect(await dialog.getByRole('group', { name: 'タグ「勉強」', exact: true }).isVisible()).toBe(false);
    await dialog.getByLabel('管理タグを検索').fill('');
    await row.getByRole('button', { name: '編集', exact: true }).click();
    expect(await dialog.getByRole('group', { name: 'タグ「勉強」', exact: true }).getByRole('button', { name: '編集', exact: true }).isVisible()).toBe(true);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/tag-manager-edit-${width}.png`, root)) });
    await row.getByLabel('変更後のタグ名').fill('破棄する入力'); await row.getByRole('button', { name: 'キャンセル', exact: true }).click();
    expect(await page.evaluate('fixture.calls.writes')).toBe(before);
    await row.getByRole('button', { name: '編集', exact: true }).click(); await row.getByLabel('変更後のタグ名').fill('業務');
    page.once('dialog', value => void value.accept()); await row.getByRole('button', { name: '保存', exact: true }).click();
    const renamed = dialog.getByRole('group', { name: 'タグ「業務」', exact: true }); await renamed.waitFor();
    await renamed.getByRole('button', { name: '削除', exact: true }).click();
    await page.locator('#confirm-no').click(); expect(await renamed.isVisible()).toBe(true);
    expect(await page.evaluate('fixture.calls.writes')).toBe(Number(before) + 1);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/tag-manager-local-${width}.png`, root)) });
    await renamed.getByRole('button', { name: '削除', exact: true }).click(); await page.locator('#confirm-yes').click();
    await expect.poll(() => dialog.getByRole('group', { name: 'タグ「業務」', exact: true }).count()).toBe(0);
    await dialog.getByRole('button', { name: 'タグ管理を閉じる', exact: true }).click(); expect(await dialog.isVisible()).toBe(false);
    await page.getByRole('button', { name: 'タグ管理', exact: true }).first().click(); await page.keyboard.press('Escape'); expect(await dialog.isVisible()).toBe(false);
    expect(await page.evaluate('fixture.calls.writes')).toBe(Number(before) + 2);
    expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
  } finally { await context.close(); }
}, 15000);

it.each(['new', 'edit', 'search'])('localタグ管理のIME中は%s入力とフォーカスを保持し操作だけを止める', async target => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out'); await page.locator('#new').waitFor();
    await page.getByRole('button', { name: 'タグ管理', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'タグ管理', exact: true });
    await dialog.getByLabel('新規タグ名').fill('仕事'); await dialog.getByRole('button', { name: '＋追加', exact: true }).click();
    const row = dialog.getByRole('group', { name: 'タグ「仕事」', exact: true }); await row.waitFor();
    if (target === 'edit') await row.getByRole('button', { name: '編集', exact: true }).click();
    const input = dialog.getByLabel(target === 'new' ? '新規タグ名' : target === 'edit' ? '変更後のタグ名' : '管理タグを検索', { exact: true });
    const before = await page.evaluate('fixture.calls.writes');
    await input.focus(); await input.evaluate(node => Object.assign(window, { tagIMEProbe: node }));
    await input.dispatchEvent('compositionstart', { data: '' });
    expect(await input.isEnabled()).toBe(true);
    expect(await input.evaluate(node => document.activeElement === node && Reflect.get(window, 'tagIMEProbe') === node)).toBe(true);
    await input.evaluate(node => { const input = node as HTMLInputElement; input.value = '仕事中'; input.setSelectionRange(3, 3); });
    await input.dispatchEvent('input', { data: '中', inputType: 'insertCompositionText', isComposing: true });
    expect(await input.inputValue()).toBe('仕事中');
    expect(await input.evaluate(node => document.activeElement === node && (node as HTMLInputElement).selectionStart === 3)).toBe(true);
    expect(await dialog.locator('.tag-manager-content button').evaluateAll(nodes => nodes.every(node => (node as HTMLButtonElement).disabled))).toBe(true);
    // disabledボタンを迂回したsubmitでも、変換途中の値を保存しない。
    if (target !== 'search') await input.evaluate(node => node.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(await page.evaluate('fixture.calls.writes')).toBe(before);
    await input.dispatchEvent('compositionend', { data: '仕事中' });
    expect(await input.isEnabled()).toBe(true);
    expect(await input.evaluate(node => document.activeElement === node)).toBe(true);
    expect(await dialog.getByRole('button', { name: '＋追加', exact: true }).isEnabled()).toBe(true);
    expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
  } finally { await context.close(); }
}, 15000);

it.each(['success', 'rejected', 'unknown', 'pending', 'cancel'])('cloudタグ入力エラー後の削除%sでも共有通知を保持する', async outcome => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, `cloud-tag-delete-${outcome === 'cancel' ? 'success' : outcome}`);
    await page.locator('#product-cloud-items').waitFor(); await page.getByRole('button', { name: 'タグ管理', exact: true }).last().click();
    const dialog = page.getByRole('dialog', { name: 'クラウドタグ管理', exact: true });
    await dialog.getByLabel('新規タグ名').fill('   '); await dialog.getByRole('button', { name: '＋追加', exact: true }).click();
    await dialog.getByRole('status').filter({ hasText: 'タグ名を確認してください。' }).waitFor();
    await dialog.getByRole('group', { name: 'タグ「既存クラウドタグ」', exact: true }).getByRole('button', { name: '削除', exact: true }).click();
    expect(await page.locator('#product-session > #product-cloud-trash-state').count()).toBe(1);
    if (outcome === 'cancel') {
      await page.getByRole('button', { name: 'タグ削除をキャンセル', exact: true }).click();
      expect(await page.locator('#product-session > #product-cloud-trash-state').count()).toBe(1);
      expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    } else {
      await page.getByRole('button', { name: '削除する', exact: true }).click();
      const status = page.locator('#product-session > #product-cloud-trash-state');
      if (outcome === 'pending') {
        await status.filter({ hasText: '処理中' }).waitFor(); await page.evaluate('fixture.releaseState()');
      }
      await status.filter({ hasText: outcome === 'unknown' ? 'UNKNOWN' : outcome === 'rejected' ? '拒否' : '要求の成功を確認' }).waitFor();
      expect(await status.isVisible()).toBe(true);
      expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_delete_tag']);
    }
    expect(await page.locator('#product-cloud-trash-state').count()).toBe(1);
    expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await context.close(); }
}, 15000);

it('localタグ保存busy中は既存closeガードで×/Escapeと二重操作を止める', async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out'); await page.locator('#new').waitFor();
    await page.getByRole('button', { name: 'タグ管理', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'タグ管理', exact: true });
    await dialog.getByLabel('新規タグ名').fill('待機するタグ'); await page.evaluate('fixture.holdWrite()');
    await dialog.getByRole('button', { name: '＋追加', exact: true }).click();
    await expect.poll(() => dialog.locator('[aria-busy=true]').count()).toBe(1);
    await dialog.getByRole('button', { name: 'タグ管理を閉じる', exact: true }).click(); expect(await dialog.isVisible()).toBe(true);
    await page.keyboard.press('Escape'); expect(await dialog.isVisible()).toBe(true);
    expect(await dialog.getByRole('button', { name: '＋追加', exact: true }).isDisabled()).toBe(true);
    await page.evaluate('fixture.releaseWrite()'); await dialog.getByRole('group', { name: 'タグ「待機するタグ」', exact: true }).waitFor();
    expect(await page.evaluate('fixture.calls.writes')).toBe(1);
    await dialog.getByRole('button', { name: 'タグ管理を閉じる', exact: true }).click(); expect(await dialog.isVisible()).toBe(false);
  } finally { await context.close(); }
}, 15000);

it.each(['create', 'rename', 'delete'])('cloudタグ管理の%sは既存C04要求だけを1回送りsnapshotを失効する', async operation => {
  const context = await browser.newContext({ viewport: { width: operation === 'rename' ? 1200 : 320, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, operation === 'delete' ? 'cloud-tag-delete-success' : 'cloud-tag-success');
    await page.locator('#product-cloud-items').waitFor(); await page.getByRole('button', { name: 'タグ管理', exact: true }).last().click();
    const dialog = page.getByRole('dialog', { name: 'クラウドタグ管理', exact: true });
    const row = dialog.getByRole('group', { name: 'タグ「既存クラウドタグ」', exact: true });
    expect(await row.getByText('1件', { exact: true }).isVisible()).toBe(true);
    await dialog.getByLabel('管理タグを検索').fill('一致しない'); expect(await row.isVisible()).toBe(false);
    await dialog.getByLabel('管理タグを検索').fill(''); expect(await row.isVisible()).toBe(true);
    expect(await dialog.getByRole('button', { name: '閉じる', exact: true }).count()).toBe(0);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/tag-manager-cloud-${operation}.png`, root)) });
    if (operation === 'create') {
      await dialog.getByLabel('新規タグ名').fill('新しいタグ'); await dialog.getByRole('button', { name: '＋追加', exact: true }).click();
    } else if (operation === 'rename') {
      await row.getByRole('button', { name: '編集', exact: true }).click(); await row.getByLabel('変更後のタグ名').fill('破棄する入力');
      await row.getByRole('button', { name: 'キャンセル', exact: true }).click();
      expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
      await row.getByRole('button', { name: '編集', exact: true }).click(); await row.getByLabel('変更後のタグ名').fill('改名タグ');
      page.once('dialog', value => void value.accept()); await row.getByRole('button', { name: '保存', exact: true }).click();
    } else {
      await row.getByRole('button', { name: '削除', exact: true }).click(); await page.getByRole('button', { name: 'タグ削除をキャンセル', exact: true }).click();
      expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
      await page.getByRole('button', { name: 'タグ管理', exact: true }).last().click();
      await dialog.getByRole('group', { name: 'タグ「既存クラウドタグ」', exact: true }).getByRole('button', { name: '削除', exact: true }).click();
      await page.getByRole('button', { name: '削除する', exact: true }).click();
    }
    await page.locator('#product-cloud-trash-state').filter({ hasText: '要求の成功を確認' }).waitFor();
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot', operation === 'delete' ? 'memo_delete_tag' : 'memo_save_tag']);
    expect(await page.locator('#product-cloud-snapshot').textContent()).toBe('');
    expect(await page.locator('#product-cloud-trash-state').textContent()).toContain('明示再読取');
    const args = await page.evaluate('fixture.stateArgs()') as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(operation === 'delete' ? ['p_expected_revision', 'p_id'] : ['p_expected_revision', 'p_id', 'p_name']);
    expect(args.p_expected_revision).toBe(operation === 'create' ? null : 1);
    expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await context.close(); }
}, 15000);

it.each(['stale', 'unknown'])('新しいcloudタグ管理UIでも%s後の旧追加ボタンから再送しない', async kind => {
  const context = await browser.newContext({ viewport: { width: 390, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, kind === 'unknown' ? 'cloud-tag-unknown' : 'cloud-tag-success');
    await page.locator('#product-cloud-items').waitFor(); await page.getByRole('button', { name: 'タグ管理', exact: true }).last().click();
    const dialog = page.getByRole('dialog', { name: 'クラウドタグ管理', exact: true });
    await dialog.getByLabel('新規タグ名').fill('元の要求');
    await dialog.getByRole('button', { name: '＋追加', exact: true }).evaluate(node => Object.assign(window, { oldTagAdd: node }));
    if (kind === 'unknown') {
      await dialog.getByRole('button', { name: '＋追加', exact: true }).click();
      await page.locator('#product-cloud-trash-state').filter({ hasText: 'UNKNOWN' }).waitFor();
    } else {
      await page.evaluate('fixture.refreshAuth()');
      await expect.poll(() => page.locator('#product-cloud-snapshot').textContent()).toBe('');
    }
    await page.evaluate('oldTagAdd.click()');
    expect(await page.evaluate('fixture.rpcNames')).toEqual(kind === 'unknown' ? ['memo_load_snapshot', 'memo_save_tag'] : ['memo_load_snapshot']);
    expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await context.close(); }
}, 15000);

it.each([1200, 390, 320])('バックアップモーダルの配置と×/Escape・読取中close防止を維持する：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out');
    await page.locator('#new').waitFor();
    const backup = page.getByRole('dialog', { name: 'バックアップ・復元', exact: true });
    const open = page.getByRole('button', { name: 'バックアップ・復元', exact: true });
    await open.click();
    expect(await backup.getByRole('button', { name: '閉じる', exact: true }).count()).toBe(0);
    expect(await backup.locator('[data-close-dialog]').count()).toBe(1);
    const diagnose = backup.getByRole('button', { name: '初期復元の保存状況を診断', exact: true });
    const normal = backup.getByRole('button', { name: '初期復元を終了して通常利用', exact: true });
    const a = (await diagnose.boundingBox())!, b = (await normal.boundingBox())!;
    if (width > 650) {
      expect(b.y).toBe(a.y); expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(24);
    } else expect(b.y - (a.y + a.height)).toBeGreaterThanOrEqual(20);
    expect(await backup.locator('.dialog-heading h2').evaluate(node => getComputedStyle(node).fontSize)).toBe('22px');
    expect(await backup.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/backup-dialog-${width}.png`, root)) });
    const close = backup.getByRole('button', { name: 'バックアップ・復元を閉じる', exact: true });
    await close.click(); expect(await backup.isVisible()).toBe(false);
    await open.click(); await page.keyboard.press('Escape'); expect(await backup.isVisible()).toBe(false);
    await open.click();
    // 実ファイルやStorageを使わず、既存の読取busy/inertガードへ入る。
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function () { return new Promise<ArrayBuffer>(resolve => {
        Object.assign(window, { finishBackupFile: () => { File.prototype.arrayBuffer = original; resolve(new TextEncoder().encode('{}').buffer); } });
      }); };
    });
    await backup.getByLabel('初期復元のバックアップJSON', { exact: true }).setInputFiles({ name: 'fake.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await expect.poll(() => close.evaluate(node => !!node.closest('[inert]'))).toBe(true);
    await close.dispatchEvent('click'); expect(await backup.isVisible()).toBe(true);
    await page.keyboard.press('Escape'); expect(await backup.isVisible()).toBe(true);
    await page.evaluate('finishBackupFile()');
    await expect.poll(() => close.evaluate(node => !!node.closest('[inert]'))).toBe(false);
    await close.click(); expect(await backup.isVisible()).toBe(false);
    expect(await page.evaluate('fixture.calls.writes')).toBe(0);
    expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
  } finally { await context.close(); }
}, 15000);

it('初期復元UNKNOWNから認証画面を閉じて回復操作へ戻れる', async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out');
    await page.locator('#new').waitFor();
    await page.getByRole('button', { name: 'バックアップ・復元', exact: true }).click();
    const backup = page.getByRole('dialog', { name: 'バックアップ・復元', exact: true });
    const data = { format: 'myhomepage.memo.local-backup', backupVersion: 1, sourceStorageVersion: 3,
      exportedAt: '2026-01-01T00:00:00Z', data: { memos: [], tags: [], memoTags: [], deletedMemoIds: [] } };
    await page.getByLabel('初期復元のバックアップJSON').setInputFiles({ name: 'fake.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await page.getByRole('button', { name: '初期復元の確認へ', exact: true }).click();
    await page.evaluate('fixture.failWrites()');
    await page.getByRole('button', { name: '確認して初期復元', exact: true }).click();
    await backup.getByText(/初期復元の結果は不明/).waitFor();
    await backup.getByRole('button', { name: 'バックアップ・復元を閉じる', exact: true }).click();
    const auth = page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true });
    for (const method of ['button', 'escape']) {
      await page.locator('#product-auth-open').click();
      expect(await auth.getByRole('button', { name: 'ローカルを選択', exact: true }).isDisabled()).toBe(true);
      if (method === 'button') await auth.getByRole('button', { name: '閉じる', exact: true }).click(); else await page.keyboard.press('Escape');
      expect(await auth.isVisible()).toBe(false);
    }
    await page.getByRole('button', { name: 'バックアップ・復元', exact: true }).click();
    expect(await backup.getByRole('button', { name: '初期復元の保存状況を診断', exact: true }).isEnabled()).toBe(true);
    expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
    expect(await page.evaluate('fixture.calls.writes')).toBe(1);
  } finally { await context.close(); }
}, 15000);

it('hidden属性だけの変更でもページタイトルが現在のviewへ追従する', async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const url = await prepareProductPreview(context, root, false), page = await context.newPage();
    await page.goto(url); await page.locator('#new').waitFor({ state: 'visible' });
    await expect.poll(() => page.locator('#page-title').textContent()).toBe('メモ一覧');
    await page.evaluate(() => {
      const notice = document.createElement('p'); notice.id = 'voice-scope-probe'; notice.dataset.voiceRoutine = 'true'; notice.textContent = '定型通知の表示範囲を確認';
      document.querySelector('.statuses')!.append(notice);
    });
    expect(await page.locator('#voice-scope-probe').isVisible()).toBe(false);
    // 子要素の追加・削除やinert変更に頼らず、既存viewの表示属性だけを変更する。
    for (const [id, title] of [['detail-view', 'メモ詳細'], ['editor-view', 'メモ編集'], ['list-view', 'メモ一覧']]) {
      await page.evaluate(id => {
        for (const view of ['list-view', 'detail-view', 'editor-view']) document.getElementById(view)!.hidden = view !== id;
      }, id!);
      await expect.poll(() => page.locator('#page-title').textContent()).toBe(title);
      expect(await page.locator('#voice-scope-probe').isVisible()).toBe(id !== 'list-view');
    }
  } finally { await context.close(); }
}, 15000);

it.each([1440, 390])('正本一覧・編集・モーダル：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 950 : 844 }, acceptDownloads: true, serviceWorkers: 'block' });
  try {
    await context.addInitScript(() => {
      Object.defineProperty(window, 'SpeechRecognition', { value: undefined });
      Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined });
    });
    const url = await prepareProductPreview(context, root, false), page = await context.newPage();
    await page.goto(url); await page.locator('#new').waitFor({ state: 'visible' });
    await expect.poll(() => page.locator('#page-title').textContent()).toBe('メモ一覧');
    expect(await page.locator('#product-auth-open').textContent()).toBe('ログイン / 保存先：ローカル');
    if (width === 1440) {
      expect(await page.locator('.statuses').isVisible()).toBe(false);
      const boxes = await page.evaluate(() => {
        const box = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { width: r.width, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        const select = getComputedStyle(document.querySelector('#sort')!);
        return { auth: box('#product-auth-open'), backup: box('[data-open-dialog="backup-dialog"]'), reload: box('#reload'),
          heading: box('.tag-controls h2'), manager: box('.tag-controls .section-heading button'),
          trash: box('#trash-view'), clear: box('#clear-tag-filters'), combo: box('#sort'),
          search: box('.tag-search-row'), all: box('#filters-all'), padding: parseFloat(select.paddingRight), appearance: select.appearance,
          voice: getComputedStyle(document.querySelector('#list-voice-slot button')!).backgroundColor };
      });
      expect(boxes.reload.right).toBe(boxes.auth.right); expect(boxes.backup.top).toBeGreaterThan(boxes.auth.bottom);
      expect(boxes.reload.top).toBe(boxes.backup.top); expect(boxes.trash.right).toBeLessThan(boxes.backup.left);
      expect(boxes.backup.right).toBeLessThan(boxes.reload.left); expect(boxes.backup.width).toBe(250); expect(boxes.reload.width).toBe(250);
      expect(boxes.combo.left).toBe(boxes.clear.left); expect(boxes.search.top - boxes.manager.bottom).toBeGreaterThanOrEqual(12);
      expect(Math.abs(boxes.heading.top - boxes.manager.top)).toBeLessThan(15);
      expect(boxes.all.top - boxes.search.bottom).toBeGreaterThanOrEqual(12);
      expect(boxes.padding).toBeGreaterThanOrEqual(40); expect(boxes.appearance).toBe('none');
      expect(boxes.voice).toBe('rgb(189, 40, 59)');
    }
    expect(await page.locator('#list-voice-slot button [aria-hidden=true]').textContent()).toBe('🎙');
    await page.getByRole('button', { name: '音声メモ', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'このブラウザは音声入力に対応していません。' }).waitFor();
    expect(await page.locator('#editor-view').isVisible()).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.getByRole('button', { name: 'バックアップ・復元', exact: true }).count()).toBe(1);
    expect(await page.getByRole('button', { name: 'JSONバックアップを作成' }).isVisible()).toBe(false);
    await page.getByRole('button', { name: 'バックアップ・復元', exact: true }).click();
    const backup = page.getByRole('dialog', { name: 'バックアップ・復元', exact: true });
    expect(await backup.isVisible()).toBe(true);
    expect(await backup.getByLabel('初期復元のバックアップJSON').count()).toBe(1);
    await backup.getByRole('button', { name: 'バックアップ・復元を閉じる', exact: true }).click();
    await page.locator('#new').click();
    await page.locator('#memo-title').fill('画面確認の合成メモ'); await page.locator('#memo-body').fill('日本語の本文を保存します。');
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-editor-${width}.png`, root)) });
    await page.locator('#save').click(); await page.locator('#detail-view').waitFor({ state: 'visible' });
    if (width === 1440) expect(await page.locator('#save-status').isVisible()).toBe(true);
    await page.getByRole('button', { name: '音声で本文へ追記', exact: true }).click();
    expect(await page.getByRole('status').filter({ hasText: 'このブラウザは音声入力に対応していません。' }).isVisible()).toBe(true);
    expect(await page.locator('#detail-view').isVisible()).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-detail-${width}.png`, root)) });
    await page.locator('#back').click();
    expect(await page.locator('#save-status').isVisible()).toBe(false);
    let raw = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
    expect(JSON.parse(raw!).memos[0].title).toBe('画面確認の合成メモ');
    await page.getByRole('button', { name: 'タグ管理', exact: true }).first().click();
    expect(await page.getByRole('dialog', { name: 'タグ管理', exact: true }).isVisible()).toBe(true);
    for (const invalid of ['   ', 'あ'.repeat(31), '禁止\u007f']) {
      await page.locator('#tag-name').fill(invalid); await page.locator('#tag-save').click();
      await expect.poll(() => page.locator('#tag-error').textContent()).toContain('入力を確認');
      expect(await page.getByRole('dialog', { name: 'タグ管理', exact: true }).getByRole('alert').isVisible()).toBe(true);
    }
    await page.locator('#tag-name').fill('仕事'); await page.locator('#tag-save').click();
    await page.locator('#tag-manager-rows').getByText('仕事', { exact: true }).waitFor();
    raw = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
    await page.locator('#tag-manager-rows').getByRole('button', { name: '編集', exact: true }).click();
    await page.getByLabel('変更後のタグ名', { exact: true }).fill('変更をキャンセルする名前');
    await page.locator('#tag-manager-rows').getByRole('button', { name: 'キャンセル', exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(raw);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-tags-${width}.png`, root)) });
    await page.getByRole('dialog', { name: 'タグ管理', exact: true }).getByRole('button', { name: 'タグ管理を閉じる', exact: true }).click();
    await page.getByRole('button', { name: 'バックアップ・復元', exact: true }).click();
    expect(await backup.getByLabel('バックアップJSONを選択').count()).toBe(1);
    expect(await backup.getByLabel('単件回復のバックアップJSON').count()).toBe(1);
    await backup.getByRole('button', { name: 'JSONバックアップを作成' }).click();
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-backup-${width}.png`, root)) });
    expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(raw);
    await backup.getByRole('button', { name: 'バックアップ・復元を閉じる', exact: true }).click();
    // 新旧データではなく、この専用Contextで作ったメモだけを複製して描画用件数を用意する。
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('myhomepage.memo.data.v2')!);
      const memo = data.memos[0];
      data.memos = Array.from({ length: 24 }, (_, index) => ({ ...memo, id: crypto.randomUUID(), title: `合成メモ ${index}`, lastRequestId: null }));
      localStorage.setItem('myhomepage.memo.data.v2', JSON.stringify(data));
    });
    await page.reload(); await page.locator('#cards li').first().waitFor();
    await page.locator('#sort').selectOption('created-asc');
    expect(await page.locator('#sort').inputValue()).toBe('created-asc');
    const top = await page.locator('#search').evaluate(node => node.getBoundingClientRect().top);
    await page.locator('#cards').evaluate(node => { node.scrollTop = 400; });
    expect(await page.locator('#cards').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    expect(await page.locator('#search').evaluate(node => node.getBoundingClientRect().top)).toBe(top);
    await page.locator('#cards button.open-card').first().click();
    await expect.poll(() => page.locator('#page-title').textContent()).toBe('メモ詳細');
    await page.locator('#edit').click();
    await expect.poll(() => page.locator('#page-title').textContent()).toBe('メモ編集');
    await page.locator('#memo-body').fill('未保存の入力'); await page.locator('#back').click();
    await page.getByRole('dialog', { name: '操作の確認', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    expect(await page.locator('#memo-body').inputValue()).toBe('未保存の入力');
    await page.locator('#save').click(); await page.locator('#back').click();
    await expect.poll(() => page.locator('#page-title').textContent()).toBe('メモ一覧');
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-list-${width}.png`, root)) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
}, 15000);

it.each([1440, 390])('同じ製品HTMLのfake cloud配置：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    // 同じ製品HTML/CSSを使い、SDK/通信だけを既存fake compositionへ差し替える。
    const page = await fakeProduct(context, 'cloud-assign-edit');
    await page.locator('#product-cloud-items').waitFor();
    expect(await page.locator('#product-auth-open').textContent()).toBe('ログアウト / 保存先：クラウド');
    const beforeVoice = await page.evaluate('fixture.rpcNames.slice()');
    await page.getByRole('button', { name: '音声メモ', exact: true }).click();
    await page.locator('#product-session > [role="status"]').filter({ hasText: 'このブラウザは音声入力に対応していません。' }).waitFor();
    expect(await page.locator('#product-cloud-editor').isVisible()).toBe(false);
    expect(await page.locator('#product-cloud-items').isVisible()).toBe(true);
    expect(await page.evaluate('fixture.rpcNames.slice()')).toEqual(beforeVoice);
    expect(await page.evaluate('fixture.calls.writes')).toBe(0);
    expect(await page.locator('#product-cloud-items .card-meta').first().textContent()).toContain('既存クラウドタグ');
    await page.getByLabel('クラウドの検索', { exact: true }).fill('クラウド');
    expect(await page.locator('#product-cloud-items .card-meta').first().textContent()).toContain('既存クラウドタグ');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-cloud-${width}.png`, root)) });
    await page.getByRole('button', { name: 'タグ管理', exact: true }).last().click();
    expect(await page.getByRole('dialog', { name: 'クラウドタグ管理', exact: true }).isVisible()).toBe(true);
    const tagDialog = page.getByRole('dialog', { name: 'クラウドタグ管理', exact: true });
    const beforeTag = await page.evaluate('fixture.rpcNames.slice()');
    for (const invalid of ['   ', 'あ'.repeat(31), '禁止\u007f']) {
      await tagDialog.getByLabel('新規タグ名').fill(invalid);
      await tagDialog.getByRole('button', { name: '＋追加', exact: true }).click();
      await tagDialog.getByRole('status').filter({ hasText: 'タグ名を確認してください。' }).waitFor();
    }
    expect(await page.evaluate('fixture.rpcNames.slice()')).toEqual(beforeTag);
    await tagDialog.getByRole('button', { name: 'タグ管理を閉じる', exact: true }).click();
    if (width === 1440) {
      await page.getByLabel('クラウドの並び順', { exact: true }).selectOption('created-asc');
      expect(await page.getByLabel('クラウドの並び順', { exact: true }).inputValue()).toBe('created-asc');
      const beforeFilter = await page.evaluate('fixture.rpcNames.slice()');
      await page.getByLabel('クラウド絞込タグ：既存クラウドタグ', { exact: true }).check();
      expect(await page.locator('#product-cloud-items button.open-card').count()).toBe(1);
      expect(await page.evaluate('fixture.rpcNames.slice()')).toEqual(beforeFilter);
    }
    if (width === 390) {
      const before = await page.evaluate('fixture.rpcNames.slice()');
      await page.locator('#product-cloud-items details summary').first().click();
      await page.locator('#product-cloud-items details').first().getByRole('button', { name: '複製', exact: true }).click();
      expect(await page.evaluate('fixture.rpcNames.slice()')).toEqual(before);
      expect(await page.evaluate('fixture.calls.writes')).toBe(0);
    } else {
      await page.locator('#product-cloud-items button.open-card').first().click();
      await page.getByRole('button', { name: 'このクラウドメモを編集', exact: true }).click();
    }
    expect(await page.getByLabel('クラウドのタイトル', { exact: true }).isVisible()).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-cloud-editor-${width}.png`, root)) });
  } finally { await context.close(); }
}, 15000);

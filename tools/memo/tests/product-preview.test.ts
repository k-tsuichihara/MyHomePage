import { beforeAll, expect, it, vi } from 'vitest';
import { chromium, type BrowserContext, type Route } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { prepareProductPreview, productPreviewOptions, PRODUCT_PREVIEW_ORIGIN } from '../scripts/product-preview';
import { createProfileOwner, prepareProfileBase } from './persistence/profile-guard';
import { runOwnedCase } from './persistence/lifecycle';
import { MEMO_RPC_ORIGIN } from '../src/cloud-rpc-sender';

const root = new URL('../', import.meta.url);
beforeAll(() => {
  for (const args of [[], ['--cloud']]) execFileSync(process.execPath, ['scripts/build-product.mjs', ...args], { cwd: fileURLToPath(root) });
}, 30000);

it('1コマンドがlocal成果物をbuildして固定headed起動する構成', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  expect(pkg.scripts['preview:product']).toBe('npm run build:product && node .product/local/preview.mjs');
  expect(pkg.scripts['preview:product-cloud']).toBe('npm run build:product-cloud && node .product/cloud/preview.mjs');
  for (const mode of ['local', 'cloud']) expect(await readFile(new URL(`.product/${mode}/preview.mjs`, root), 'utf8')).toContain('launchPersistentContext');
  expect(productPreviewOptions(false)).toMatchObject({ headless: false, viewport: null, serviceWorkers: 'block', proxy: { server: 'http://127.0.0.1:9' } });
  expect(productPreviewOptions(true)).not.toHaveProperty('proxy');
  expect(productPreviewOptions(true)).not.toHaveProperty('viewport');
  const code = await readFile(new URL('.product/memo-app.js', root), 'utf8');
  expect(code).not.toMatch(/createMemoSdkAuth|sb_publishable_|\/auth\/v1\/|memo_load_snapshot/);
});

it.each([false, true])('既存route方針を維持する：cloud=%s', async cloud => {
  let handler!: (route: Route) => unknown;
  const context = { route: vi.fn(async (_pattern, callback) => { handler = callback; }) } as unknown as BrowserContext;
  await prepareProductPreview(context, root, cloud);
  const request = (url: string, method = 'GET') => {
    const route = { request: () => ({ url: () => url, method: () => method }), abort: vi.fn(), continue: vi.fn(), fulfill: vi.fn() };
    handler(route as unknown as Route); return route;
  };
  const supabase = request(`${MEMO_RPC_ORIGIN}/rest/v1/rpc/memo_load_snapshot`, 'POST');
  expect(cloud ? supabase.continue : supabase.abort).toHaveBeenCalledOnce();
  expect(request('https://outside.invalid/').abort).toHaveBeenCalledOnce();
  expect(request(`${PRODUCT_PREVIEW_ORIGIN}/missing`).abort).toHaveBeenCalledOnce();
  expect(request(`${PRODUCT_PREVIEW_ORIGIN}/tools/memo/memo.html`, 'POST').abort).toHaveBeenCalledOnce();
  const page = request(`${PRODUCT_PREVIEW_ORIGIN}/tools/memo/memo.html`);
  const headers = page.fulfill.mock.calls[0]![0].headers;
  expect(headers['Content-Security-Policy']).toBe(cloud ? undefined : "connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'");
});

it('local製品previewはウィンドウ6幅の内部領域まで追従する（390pxはOS制限時に補完）', async () => {
  const owner = await createProfileOwner(await prepareProfileBase(fileURLToPath(root)));
  const profile = await owner.create();
  await runOwnedCase(owner, profile, async () => {
    // UATと同じheaded設定でウィンドウ自体を変更する。viewportのエミュレーションは使わない。
    const context = await chromium.launchPersistentContext(profile, productPreviewOptions(false));
    try {
      const url = await prepareProductPreview(context, root, false), page = await context.newPage();
      await page.goto(url); await page.locator('#new').waitFor({ state: 'visible' });
      expect(page.viewportSize()).toBeNull();
      const cdp = await context.newCDPSession(page);
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: 1200, height: 900 } });
      await expect.poll(() => page.evaluate(() => outerWidth)).toBe(1200);
      const large = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: 900, height: 700 } });
      await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(large.width);
      await expect.poll(() => page.evaluate(() => innerHeight)).toBeLessThan(large.height);
      expect(await page.locator('#new').isVisible()).toBe(true);
      expect(await page.locator('#product-session').count()).toBe(0);
      await page.getByRole('button', { name: 'タグ管理', exact: true }).click();
      for (const name of ['あ'.repeat(30), 'い'.repeat(30), 'う'.repeat(30)]) {
        await page.locator('#tag-name').fill(name); await page.locator('#tag-save').click();
      }
      await page.getByRole('dialog', { name: 'タグ管理', exact: true }).getByRole('button', { name: '閉じる', exact: true }).click();
      await page.locator('#new').click();
      await page.locator('#memo-title').fill('横幅を確認する長いタイトル'.repeat(6));
      await page.locator('#memo-body').fill('long-unbroken-body-'.repeat(50));
      await page.locator('#editor-tags input').first().check();
      await page.locator('#save').click(); await page.locator('#detail-view').waitFor(); await page.locator('#back').click();
      const samples = [];
      for (const width of [1200, 992, 900, 800, 651, 650, 390]) {
        const frame = await page.evaluate(() => outerWidth - innerWidth);
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: width + frame, height: 950 } });
        await page.waitForTimeout(150);
        const nativeWidth = await page.evaluate(() => innerWidth);
        // Windowsの通常タブ付きwindowは内幅500px未満へ縮まない。制限値を記録し390pxだけ補完する。
        const emulated = nativeWidth !== width;
        if (emulated) {
          expect(width).toBe(390);
          await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: false });
        }
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
        const sample = await page.evaluate(({ requested, nativeWidth, emulated }) => ({ requested, nativeWidth, emulated, inner: innerWidth, outer: outerWidth, screen: matchMedia('screen').matches, print: matchMedia('print').matches,
          document: document.documentElement.scrollWidth,
          elements: ['body', 'main', '.memo-page', '.memo-product', '.list-toolbar', '.tag-search-row', '.list-options', '#sort'].map(selector => {
            const node = document.querySelector(selector)! as HTMLElement, s = getComputedStyle(node), r = node.getBoundingClientRect();
            return { selector, width: r.width, right: r.right, scroll: node.scrollWidth, min: s.minWidth, max: s.maxWidth };
          }) }), { requested: width, nativeWidth, emulated });
        samples.push(sample);
        expect(sample.screen).toBe(true); expect(sample.print).toBe(false);
        expect(sample.elements[0]!.min).toBe('0px');
        expect(await page.locator('#product-auth-open').textContent()).toBe('ログイン / 保存先：ローカル');
        expect(await page.locator('#list-voice-slot button').getAttribute('aria-label')).toBe('音声メモ');
        expect(await page.locator('#list-voice-slot button [aria-hidden=true]').textContent()).toBe('🎙');
        const layout = await page.evaluate(() => {
          const rect = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { width: r.width, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
          return { auth: rect('#product-auth-open'), backup: rect('[data-open-dialog=backup-dialog]'), reload: rect('#reload'),
            description: rect('.product-heading p'),
            heading: rect('.tag-controls h2'), manager: rect('.tag-controls .section-heading button'),
            search: rect('.tag-search-row'), all: rect('#filters-all'),
            trash: rect('#trash-view'), clear: rect('#clear-tag-filters'), sort: rect('#sort'), caption: rect('.sort-caption'),
            bold: getComputedStyle(document.querySelector('.sort-caption')!).fontWeight, headingBold: getComputedStyle(document.querySelector('.tag-controls h2')!).fontWeight,
            arrowPadding: parseFloat(getComputedStyle(document.querySelector('#sort')!).paddingRight),
            voice: getComputedStyle(document.querySelector('#list-voice-slot button')!).backgroundColor };
        });
        if (width > 650) {
          expect(layout.reload.right).toBe(layout.auth.right); expect(layout.backup.top).toBeGreaterThan(layout.auth.bottom);
          expect(layout.reload.top).toBe(layout.backup.top); expect(layout.trash.top).toBe(layout.backup.top);
          expect(layout.trash.top).toBeGreaterThan(layout.description.bottom);
          expect(layout.trash.right).toBeLessThan(layout.backup.left); expect(layout.backup.right).toBeLessThan(layout.reload.left);
          expect(layout.backup.width).toBe(250); expect(layout.reload.width).toBe(250);
          expect(layout.manager.left).toBeGreaterThan(layout.heading.right); expect(layout.search.top - layout.manager.bottom).toBeGreaterThanOrEqual(12);
          expect(layout.sort.left).toBe(layout.clear.left); expect(layout.caption.right).toBeLessThan(layout.sort.left); expect(layout.bold).toBe(layout.headingBold);
          expect(layout.all.top - layout.search.bottom).toBeGreaterThanOrEqual(12);
          expect(layout.arrowPadding).toBeGreaterThanOrEqual(40); expect(layout.voice).toBe('rgb(189, 40, 59)');
          expect(await page.locator('.statuses').isVisible()).toBe(false);
        }
        await page.screenshot({ path: fileURLToPath(new URL(`.product/width-local-${width}.png`, root)) });
        if (emulated) await cdp.send('Emulation.clearDeviceMetricsOverride');
      }
      await writeFile(new URL('.product/width-local.json', root), JSON.stringify(samples, null, 2));
      for (const sample of samples) {
        expect(sample.document).toBeLessThanOrEqual(sample.inner);
        expect(sample.elements.slice(0, 4).every(row => row.width <= sample.inner)).toBe(true);
      }
    } finally { await context.close(); }
  }, () => {});
}, 20000);

it('同じ製品配信・専用profileで実localStorage保存と再読込ができ、外部通信とAuth UIはない', async () => {
  const owner = await createProfileOwner(await prepareProfileBase(fileURLToPath(root)));
  const profile = await owner.create();
  await runOwnedCase(owner, profile, async () => {
    // UATと同じprofile/options/routeを使い、表示だけを自動試験用にheadlessへ変更する。
    const context = await chromium.launchPersistentContext(profile, { ...productPreviewOptions(false), headless: true });
    try {
      const url = await prepareProductPreview(context, root, false);
      const page = await context.newPage();
      await page.goto(url);
      await page.locator('#new').waitFor({ state: 'visible' });
      expect(await page.locator('#product-session').count()).toBe(0);
      expect(await page.getByLabel('開発用publishable key', { exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBeNull();
      await page.locator('#new').click();
      await page.locator('#memo-title').fill('local UAT合成メモ');
      await page.locator('#memo-body').fill('専用profileに保存する合成本文');
      await page.locator('#save').click();
      await page.locator('#detail-view').waitFor({ state: 'visible' });
      const raw = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
      expect(JSON.parse(raw!).version).toBe(3);
      expect(JSON.parse(raw!).memos[0].body).toBe('専用profileに保存する合成本文');
      await page.reload(); await page.locator('#new').waitFor({ state: 'visible' });
      expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(raw);
      expect(await page.evaluate(async () => { try { await fetch('https://outside.invalid/'); return 'allowed'; } catch { return 'blocked'; } })).toBe('blocked');
      const other = await context.newPage();
      await expect(other.goto(`${MEMO_RPC_ORIGIN}/`)).rejects.toThrow();
      await other.close();
    } finally { await context.close(); }
  }, () => {});
});

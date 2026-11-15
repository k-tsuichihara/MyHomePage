import { beforeAll, expect, it, vi } from 'vitest';
import { chromium, type BrowserContext, type Route } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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
  expect(productPreviewOptions(false)).toMatchObject({ headless: false, serviceWorkers: 'block', proxy: { server: 'http://127.0.0.1:9' } });
  expect(productPreviewOptions(true)).not.toHaveProperty('proxy');
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

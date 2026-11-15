import { beforeAll, afterAll, expect, it } from 'vitest';
import { chromium, type Browser } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
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

it.each([1440, 390])('正本一覧・編集・モーダル：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 950 : 844 }, acceptDownloads: true, serviceWorkers: 'block' });
  try {
    const url = await prepareProductPreview(context, root, false), page = await context.newPage();
    await page.goto(url); await page.locator('#new').waitFor({ state: 'visible' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.getByRole('button', { name: 'バックアップ・復元', exact: true }).count()).toBe(1);
    expect(await page.getByRole('button', { name: 'JSONバックアップを作成' }).isVisible()).toBe(false);
    await page.getByRole('button', { name: 'バックアップ・復元', exact: true }).click();
    const backup = page.getByRole('dialog', { name: 'バックアップ・復元', exact: true });
    expect(await backup.isVisible()).toBe(true);
    expect(await backup.getByLabel('初期復元のバックアップJSON').count()).toBe(1);
    await backup.getByRole('button', { name: '閉じる', exact: true }).click();
    await page.locator('#new').click();
    await page.locator('#memo-title').fill('画面確認の合成メモ'); await page.locator('#memo-body').fill('日本語の本文を保存します。');
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-editor-${width}.png`, root)) });
    await page.locator('#save').click(); await page.locator('#detail-view').waitFor({ state: 'visible' });
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-detail-${width}.png`, root)) });
    await page.locator('#back').click();
    let raw = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
    expect(JSON.parse(raw!).memos[0].title).toBe('画面確認の合成メモ');
    await page.getByRole('button', { name: 'タグ管理', exact: true }).first().click();
    expect(await page.getByRole('dialog', { name: 'タグ管理', exact: true }).isVisible()).toBe(true);
    await page.locator('#tag-name').fill('仕事'); await page.locator('#tag-save').click();
    await page.locator('#tag-manager-rows').getByText('仕事', { exact: true }).waitFor();
    raw = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
    await page.locator('#tag-manager-rows').getByRole('button', { name: '名前を変更', exact: true }).click();
    await page.locator('#tag-name').fill('変更をキャンセルする名前');
    page.once('dialog', dialog => void dialog.dismiss()); await page.locator('#tag-save').click();
    expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(raw);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-tags-${width}.png`, root)) });
    await page.getByRole('dialog', { name: 'タグ管理', exact: true }).getByRole('button', { name: '閉じる', exact: true }).click();
    await page.getByRole('button', { name: 'バックアップ・復元', exact: true }).click();
    expect(await backup.getByLabel('バックアップJSONを選択').count()).toBe(1);
    expect(await backup.getByLabel('単件回復のバックアップJSON').count()).toBe(1);
    await backup.getByRole('button', { name: 'JSONバックアップを作成' }).click();
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-backup-${width}.png`, root)) });
    expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(raw);
    await backup.getByRole('button', { name: '閉じる', exact: true }).click();
    // 新旧データではなく、この専用Contextで作ったメモだけを複製して描画用件数を用意する。
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('myhomepage.memo.data.v2')!);
      const memo = data.memos[0];
      data.memos = Array.from({ length: 24 }, (_, index) => ({ ...memo, id: crypto.randomUUID(), title: `合成メモ ${index}`, lastRequestId: null }));
      localStorage.setItem('myhomepage.memo.data.v2', JSON.stringify(data));
    });
    await page.reload(); await page.locator('#cards li').first().waitFor();
    const top = await page.locator('#search').evaluate(node => node.getBoundingClientRect().top);
    await page.locator('#cards').evaluate(node => { node.scrollTop = 400; });
    expect(await page.locator('#cards').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    expect(await page.locator('#search').evaluate(node => node.getBoundingClientRect().top)).toBe(top);
    await page.locator('#cards button.open-card').first().click(); await page.locator('#edit').click();
    await page.locator('#memo-body').fill('未保存の入力'); await page.locator('#back').click();
    await page.getByRole('dialog', { name: '操作の確認', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    expect(await page.locator('#memo-body').inputValue()).toBe('未保存の入力');
    await page.locator('#save').click(); await page.locator('#back').click();
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-list-${width}.png`, root)) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
}, 15000);

it.each([1440, 390])('同じ製品HTMLのfake cloud配置：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    await context.addInitScript(() => Object.assign(window, { fixtureMode: 'cloud-assign-edit' }));
    const url = await prepareProductPreview(context, root, false);
    const html = await readFile(new URL('.product/site/tools/memo/memo.html', root), 'utf8');
    // 同じ製品HTML/CSSを使い、SDK/通信だけを既存fake compositionへ差し替える。
    await context.route('**/tools/memo/memo.html', route => route.fulfill({ contentType: 'text/html', body: html.replace(/<script type="module"[^>]*><\/script>/, '<script src="/layout-fixture.js"></script>') }));
    await context.route('**/layout-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fake }));
    const page = await context.newPage(); page.setDefaultTimeout(3000); await page.goto(url);
    await page.locator('#product-cloud-items').waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-cloud-${width}.png`, root)) });
    await page.getByRole('button', { name: 'タグ管理', exact: true }).last().click();
    expect(await page.getByRole('dialog', { name: 'クラウドタグ管理', exact: true }).isVisible()).toBe(true);
    await page.getByRole('dialog', { name: 'クラウドタグ管理', exact: true }).getByRole('button', { name: '閉じる', exact: true }).click();
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

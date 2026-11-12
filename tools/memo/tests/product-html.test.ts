import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';

it('製品候補は公開外枠と相対URLを保持し、旧JSを実行しない', async () => {
  const root = new URL('../', import.meta.url);
  execFileSync(process.execPath, ['scripts/build-product.mjs'], { cwd: fileURLToPath(root) });
  const shell = await readFile(new URL('memo.html', root), 'utf8');
  const html = await readFile(new URL('.product/site/tools/memo/memo.html', root), 'utf8');
  expect(html.match(/<header>[\s\S]*?<\/header>/)?.[0]).toBe(shell.match(/<header>[\s\S]*?<\/header>/)?.[0]);
  expect(html.match(/<footer>[\s\S]*?<\/footer>/)?.[0]).toBe(shell.match(/<footer>[\s\S]*?<\/footer>/)?.[0]);
  expect(html).toMatch(/src="js\/memo-app\.[a-f0-9]{64}\.js" integrity="sha256-/);
  expect(html).not.toContain('src="js/memo.js"');
  expect(html).toContain('href="../../css/style.css"');
  expect(html).toContain('id="migration-view"');
  expect(html).toContain('id="memo-app" hidden');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  expect(await readFile(new URL('memo.html', root), 'utf8')).toBe(shell);
});

it.each(['normal', 'missing-css', 'corrupt-js', 'corrupt-css'])('製品資産の整合性とStorage接続：%s', async mode => {
  const root = new URL('../', import.meta.url);
  execFileSync(process.execPath, ['scripts/build-product.mjs'], { cwd: fileURLToPath(root) });
  const html = await readFile(new URL('.product/site/tools/memo/memo.html', root), 'utf8');
  const bundle = await readFile(new URL('.product/memo-app.js', root), 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
    await context.addInitScript(() => {
      Object.defineProperty(window, '__storageReads', { value: { count: 0 } });
      const values = new Map<string, string>();
      Object.defineProperty(window, 'localStorage', { value: {
        getItem: (key: string) => { (window as unknown as { __storageReads: { count: number } }).__storageReads.count++; return values.get(key) ?? null; },
        setItem: (key: string, value: string) => { values.set(key, value); },
      } });
      Object.defineProperty(navigator, 'locks', { value: {
        request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback(),
      } });
    });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://product.test') return route.abort();
      const css = /\/css\/memo(?:-product)?\.[a-f0-9]+\.css$/.test(url.pathname);
      if (css && mode === 'missing-css') return route.fulfill({ status: 404, body: '' });
      const js = /\/memo-app\.[a-f0-9]+\.js$/.test(url.pathname);
      const body = url.pathname.endsWith('.html') ? html : js ? bundle + (mode === 'corrupt-js' ? '\n// changed' : '')
        : css ? await readFile(new URL(`.product/site${url.pathname}`, root), 'utf8') + (mode === 'corrupt-css' ? '\n/* changed */' : '') : '';
      return route.fulfill({ contentType: url.pathname.endsWith('.html') ? 'text/html' : css || url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body });
    });
    const page = await context.newPage();
    await page.goto('https://product.test/tools/memo/memo.html');
    if (mode !== 'normal') {
      expect(await page.evaluate(() => (window as unknown as { __storageReads: { count: number } }).__storageReads.count)).toBe(0);
      expect(await page.locator('#product-status').textContent()).toContain(mode === 'corrupt-js' ? '起動前' : '安全条件');
      await context.close(); return;
    }
    expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBeNull();
    await page.locator('#new').click();
    await page.locator('#memo-title').fill('合成製品メモ');
    await page.locator('#memo-body').fill('合成本文');
    await page.locator('#save').click();
    await page.locator('#detail-view').waitFor({ state: 'visible' });
    expect(await page.locator('#detail-title').textContent()).toBe('合成製品メモ');
    const beforeBackup = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
    expect(JSON.parse(beforeBackup!).version).toBe(3);
    expect(JSON.parse(beforeBackup!).deletedMemoIds).toEqual([]);
    await page.getByRole('button', { name: 'JSONバックアップを作成' }).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('link', { name: '準備済みJSONをダウンロード' }).click();
    const download = await downloadEvent;
    const backup = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(backup.format).toBe('myhomepage.memo.local-backup');
    expect(backup.data.memos[0].title).toBe('合成製品メモ');
    expect(backup).not.toHaveProperty('migration');
    expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(beforeBackup);
    await context.close();
  } finally { await browser.close(); }
}, 20000);

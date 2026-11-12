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
  expect(html).toContain('src="js/memo-app.js"');
  expect(html).not.toContain('src="js/memo.js"');
  expect(html).toContain('href="../../css/style.css"');
  expect(html).toContain('id="migration-view"');
  expect(html).toContain('id="memo-app" hidden');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  expect(await readFile(new URL('memo.html', root), 'utf8')).toBe(shell);
});

it('生成HTMLと製品entryは合成Storageで一覧・新規保存へ接続する', async () => {
  const root = new URL('../', import.meta.url);
  execFileSync(process.execPath, ['scripts/build-product.mjs'], { cwd: fileURLToPath(root) });
  const html = await readFile(new URL('.product/site/tools/memo/memo.html', root), 'utf8');
  const bundle = await readFile(new URL('.product/memo-app.js', root), 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript(() => {
      const values = new Map<string, string>();
      Object.defineProperty(window, 'localStorage', { value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
      } });
      Object.defineProperty(navigator, 'locks', { value: {
        request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback(),
      } });
    });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://product.test') return route.abort();
      return route.fulfill({ contentType: url.pathname.endsWith('.html') ? 'text/html' : 'text/javascript',
        body: url.pathname.endsWith('.html') ? html : url.pathname.endsWith('/memo-app.js') ? bundle : '' });
    });
    const page = await context.newPage();
    await page.goto('https://product.test/tools/memo/memo.html');
    await page.locator('#new').click();
    await page.locator('#memo-title').fill('合成製品メモ');
    await page.locator('#memo-body').fill('合成本文');
    await page.locator('#save').click();
    await page.locator('#detail-view').waitFor({ state: 'visible' });
    expect(await page.locator('#detail-title').textContent()).toBe('合成製品メモ');
    await context.close();
  } finally { await browser.close(); }
}, 20000);

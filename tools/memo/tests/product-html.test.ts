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

it.each(['normal', 'v2-original', 'missing-css', 'corrupt-js', 'corrupt-css'])('製品資産の整合性とStorage接続：%s', async mode => {
  const root = new URL('../', import.meta.url);
  execFileSync(process.execPath, ['scripts/build-product.mjs'], { cwd: fileURLToPath(root) });
  const html = await readFile(new URL('.product/site/tools/memo/memo.html', root), 'utf8');
  const bundle = await readFile(new URL('.product/memo-app.js', root), 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
    await context.addInitScript(mode => {
      let emit: (() => void) | undefined;
      const speech = { calls: 0, defer: false, emit: () => emit?.() };
      Object.defineProperty(window, '__speechProbe', { value: speech });
      Object.defineProperty(window, 'SpeechRecognition', { value: class {
        lang = ''; continuous = false; interimResults = false;
        onresult: ((event: unknown) => void) | null = null;
        onerror = null; onend = null;
        start() { speech.calls++; emit = () => this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: '合成音声追記' } }] }); if (!speech.defer) queueMicrotask(emit); }
        abort() {}
      } });
      Object.defineProperty(window, '__storageReads', { value: { count: 0 } });
      const values = new Map<string, string>();
      if (mode === 'v2-original') values.set('myhomepage.memo.data.v2', JSON.stringify({ version: 2, migration: { status: 'not-required' }, memos: [], tags: [], memoTags: [] }));
      Object.defineProperty(window, 'localStorage', { value: {
        getItem: (key: string) => { (window as unknown as { __storageReads: { count: number } }).__storageReads.count++; return values.get(key) ?? null; },
        setItem: (key: string, value: string) => { values.set(key, value); },
      } });
      Object.defineProperty(navigator, 'locks', { value: {
        request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback(),
      } });
    }, mode);
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
    page.setDefaultTimeout(4000);
    await page.goto('https://product.test/tools/memo/memo.html');
    if (mode !== 'normal' && mode !== 'v2-original') {
      expect(await page.evaluate(() => (window as unknown as { __storageReads: { count: number } }).__storageReads.count)).toBe(0);
      expect(await page.locator('#product-status').textContent()).toContain(mode === 'corrupt-js' ? '起動前' : '安全条件');
      await context.close(); return;
    }
    if (mode === 'v2-original') {
      const raw = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
      await page.getByRole('button', { name: 'v2移行前の原値ファイルを準備' }).click();
      const event = page.waitForEvent('download');
      await page.getByRole('link', { name: '準備済みJSONをダウンロード' }).click();
      const file = await event;
      const exported = JSON.parse(await readFile((await file.path())!, 'utf8'));
      expect(exported.format).toBe('myhomepage.memo.v2-original');
      expect(exported.values['myhomepage.memo.data.v2']).toBe(raw);
      expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(raw);
      const acknowledgement = page.getByLabel('退避ファイルを保存・確認し、旧タブを閉じました。v3へ更新します。');
      await acknowledgement.check();
      await page.getByRole('button', { name: 'v2移行前の原値ファイルを準備' }).click();
      expect(await acknowledgement.isChecked()).toBe(false);
      await page.getByRole('link', { name: '準備済みJSONをダウンロード' }).waitFor();
      await page.getByLabel('退避ファイルを保存・確認し、旧タブを閉じました。v3へ更新します。').check();
      await page.getByRole('button', { name: '確認してv3へ更新' }).click();
      await page.getByText('v3更新の読戻しを確認しました。', { exact: true }).waitFor();
      expect(JSON.parse((await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2')))!).version).toBe(3);
      await context.close(); return;
    }
    expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBeNull();
    await page.locator('#new').click();
    await page.locator('#memo-title').fill('合成製品メモ');
    await page.locator('#memo-body').fill('合成本文');
    await page.locator('#save').click();
    await page.locator('#detail-view').waitFor({ state: 'visible' });
    expect(await page.locator('#detail-title').textContent()).toBe('合成製品メモ');
    expect(await page.evaluate(() => (window as unknown as { __speechProbe: { calls: number } }).__speechProbe.calls)).toBe(0);
    const beforeVoice = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
    await page.locator('#detail-view').getByRole('button', { name: '音声で本文へ追記' }).click();
    await page.waitForFunction(() => (document.getElementById('memo-body') as HTMLTextAreaElement).value === '合成本文合成音声追記');
    expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(beforeVoice);
    await page.locator('#save').click(); await page.locator('#detail-view').waitFor({ state: 'visible' });
    await page.evaluate(() => { (window as unknown as { __speechProbe: { defer: boolean } }).__speechProbe.defer = true; });
    await page.locator('#detail-view').getByRole('button', { name: '音声で本文へ追記' }).click();
    const editorBody = page.locator('#memo-body');
    await editorBody.fill('手入力'); await editorBody.focus();
    await editorBody.evaluate(node => {
      const input = node as HTMLTextAreaElement;
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      input.value = '手入力変換中'; input.setSelectionRange(2, 2);
      (window as unknown as { __speechProbe: { emit(): void } }).__speechProbe.emit();
    });
    expect(await editorBody.inputValue()).toBe('手入力変換中');
    await editorBody.dispatchEvent('compositionend');
    await page.waitForFunction(() => (document.getElementById('memo-body') as HTMLTextAreaElement).value === '手入力変換中合成音声追記');
    expect(await editorBody.evaluate(node => (node as HTMLTextAreaElement).selectionStart)).toBe(2);
    await editorBody.press('End'); await editorBody.pressSequentially('さらに入力');
    await page.locator('#save').click(); await page.locator('#detail-view').waitFor({ state: 'visible' });
    expect(await page.locator('#detail-body').textContent()).toBe('手入力変換中合成音声追記さらに入力');
    await page.locator('#detail-view').getByRole('button', { name: '音声で本文へ追記' }).click();
    await editorBody.focus();
    await editorBody.dispatchEvent('compositionstart');
    const beforeStoppedVoice = await editorBody.inputValue();
    await page.evaluate(() => { (window as unknown as { __speechProbe: { emit(): void } }).__speechProbe.emit(); });
    await page.getByRole('button', { name: '音声入力を停止', exact: true }).click();
    await editorBody.dispatchEvent('compositionend');
    expect(await editorBody.inputValue()).toBe(beforeStoppedVoice);
    await page.locator('#save').click(); await page.locator('#detail-view').waitFor({ state: 'visible' });
    expect(await page.locator('#detail-body').textContent()).toBe(beforeStoppedVoice);
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
    // 保存済みeditorを保持する詳細画面からも、両復元のファイル診断を開始できる。
    await page.getByLabel('単件回復のバックアップJSON').setInputFiles({ name: 'detail-recovery.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.getByRole('region', { name: '完全削除後の回復', exact: true }).getByRole('button', { name: /をプレビュー/ }).first().waitFor();
    await page.getByLabel('バックアップJSONを選択', { exact: true }).setInputFiles({ name: 'detail-restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.getByRole('region', { name: '追加型復元', exact: true }).getByRole('checkbox').first().waitFor();
    expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(beforeBackup);
    // 実製品compositionの同一storeで削除→読取専用プレビュー→単件回復を確認する。
    await page.locator('#back').click();
    await page.locator('#cards summary').first().click();
    await page.getByRole('button', { name: 'ゴミ箱へ', exact: true }).click();
    await page.locator('#confirm-yes').click();
    await page.locator('#trash-view').click();
    await page.locator('#cards .open-card').first().click();
    await page.locator('#permanent-delete').click(); await page.locator('#confirm-yes').click();
    const afterDelete = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
    await page.getByLabel('単件回復のバックアップJSON').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    const recovery = page.getByRole('region', { name: '完全削除後の回復', exact: true });
    await recovery.getByRole('button', { name: /をプレビュー/ }).first().click();
    expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(afterDelete);
    await recovery.getByRole('button', { name: '新しいメモとして復元', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('detail-title')?.textContent === '合成製品メモ' && !document.getElementById('detail-view')?.hidden);
    const recovered = JSON.parse((await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2')))!);
    const restoredMemo = recovered.memos[0];
    expect(restoredMemo.id).not.toBe(backup.data.memos[0].id);
    expect(restoredMemo.revision).toBe(1); expect(restoredMemo.lastRequestId).toBeNull();
    expect(restoredMemo.pinnedAt).toBeNull(); expect(restoredMemo.deletedAt).toBeNull();
    await recovery.getByRole('button', { name: 'バックアッププレビューに戻る', exact: true }).click();
    await recovery.getByRole('button', { name: 'バックアップ一覧へ戻る', exact: true }).click();
    const snapshot = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
    await page.getByLabel('バックアップJSONを選択', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{') });
    await page.waitForFunction(() => !(document.querySelector('input[aria-label="バックアップJSONを選択"]') as HTMLInputElement).disabled);
    expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(snapshot);
    await page.getByLabel('バックアップJSONを選択', { exact: true }).setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    const restoreArea = page.getByRole('region', { name: '追加型復元', exact: true });
    await restoreArea.getByRole('checkbox').first().check();
    await restoreArea.getByRole('button', { name: '追加内容を確認', exact: true }).click();
    await restoreArea.getByRole('button', { name: '確認して復元', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('myhomepage.memo.data.v2')!).memos.length === 2);
    await page.locator('#back').click();
    await page.evaluate(() => { (window as unknown as { __speechProbe: { defer: boolean } }).__speechProbe.defer = false; });
    await page.getByRole('button', { name: '新規音声メモ', exact: true }).click();
    await page.waitForFunction(() => (document.getElementById('memo-body') as HTMLTextAreaElement).value === '合成音声追記');
    expect(await page.locator('#memo-title').inputValue()).toMatch(/^音声メモ-\d{8}-\d{4}$/);
    expect(await page.locator('#memo-body').inputValue()).toBe('合成音声追記');
    await context.close();
  } finally { await browser.close(); }
}, 20000);

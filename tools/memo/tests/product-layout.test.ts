import { beforeAll, afterAll, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext } from '@playwright/test';
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

async function fakeProduct(context: BrowserContext, mode: string) {
  await context.addInitScript(mode => Object.assign(window, { fixtureMode: mode }), mode);
  const url = await prepareProductPreview(context, root, false);
  const html = await readFile(new URL('.product/site/tools/memo/memo.html', root), 'utf8');
  await context.route('**/tools/memo/memo.html', route => route.fulfill({ contentType: 'text/html', body: html.replace(/<script type="module"[^>]*><\/script>/, '<script src="/layout-fixture.js"></script>') }));
  await context.route('**/layout-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fake }));
  const page = await context.newPage(); page.setDefaultTimeout(3000); await page.goto(url); return page;
}

it('PCの定型通知を省略してもlocal/cloudのUNKNOWNは操作後も表示する', async () => {
  for (const mode of ['cloud-edit-signed-out', 'cloud-failure']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers: 'block' });
    try {
      const page = await fakeProduct(context, mode);
      if (mode === 'cloud-edit-signed-out') {
        await page.locator('#new').waitFor();
        expect(await page.locator('.statuses').isVisible()).toBe(false);
        await page.evaluate('fixture.failWrites()'); await page.evaluate('fixture.saveTag()');
        await page.locator('#save-status').filter({ hasText: '保存結果は不明' }).waitFor();
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
    await backup.getByRole('button', { name: '閉じる', exact: true }).click();
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
    // 子要素の追加・削除やinert変更に頼らず、既存viewの表示属性だけを変更する。
    for (const [id, title] of [['detail-view', 'メモ詳細'], ['editor-view', 'メモ編集'], ['list-view', 'メモ一覧']]) {
      await page.evaluate(id => {
        for (const view of ['list-view', 'detail-view', 'editor-view']) document.getElementById(view)!.hidden = view !== id;
      }, id!);
      await expect.poll(() => page.locator('#page-title').textContent()).toBe(title);
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
    expect(await page.locator('#product-auth-open').textContent()).toBe('ログイン/保存先：ローカル');
    if (width === 1440) {
      expect(await page.locator('.statuses').isVisible()).toBe(false);
      const boxes = await page.evaluate(() => {
        const box = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { right: r.right, top: r.top, bottom: r.bottom }; };
        const select = getComputedStyle(document.querySelector('#sort')!);
        return { auth: box('#product-auth-open'), backup: box('[data-open-dialog="backup-dialog"]'), reload: box('#reload'),
          heading: box('.tag-controls h2'), manager: box('.tag-controls .section-heading button'),
          search: box('.tag-search-row'), all: box('#filters-all'), padding: parseFloat(select.paddingRight), appearance: select.appearance,
          voice: getComputedStyle(document.querySelector('#list-voice-slot button')!).backgroundColor };
      });
      expect(boxes.backup.right).toBe(boxes.auth.right); expect(boxes.backup.top).toBeGreaterThan(boxes.auth.bottom);
      expect(boxes.reload.top).toBeGreaterThan(boxes.backup.bottom);
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
    await backup.getByRole('button', { name: '閉じる', exact: true }).click();
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
    if (width === 1440) expect(await page.locator('#save-status').isVisible()).toBe(false);
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
    expect(await page.locator('#product-auth-open').textContent()).toBe('ログアウト/保存先：クラウド');
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
    await page.getByRole('button', { name: 'タグを作成', exact: true }).click();
    const tagDialog = page.getByRole('dialog', { name: 'クラウドタグの編集', exact: true });
    const beforeTag = await page.evaluate('fixture.rpcNames.slice()');
    for (const invalid of ['   ', 'あ'.repeat(31), '禁止\u007f']) {
      await tagDialog.getByLabel('クラウドのタグ名').fill(invalid);
      await tagDialog.getByRole('button', { name: '作成', exact: true }).click();
      await tagDialog.getByRole('status').filter({ hasText: 'タグ名を確認してください。' }).waitFor();
    }
    expect(await page.evaluate('fixture.rpcNames.slice()')).toEqual(beforeTag);
    await tagDialog.getByRole('button', { name: 'タグ編集をキャンセル', exact: true }).click();
    expect(await page.locator('#product-session > #product-cloud-trash-state').count()).toBe(1);
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

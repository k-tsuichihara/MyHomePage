import { expect, test } from '@playwright/test';

// 保存ファイルはPlaywright所有の一時領域だけへ置き、Context終了時に破棄する。
test.use({ acceptDownloads: true });
test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4173'
    ? route.continue() : route.abort());
});

test('v3全体のダウンロード、UTF-8原文、除外範囲、公開API非接続', async ({ page, context }) => {
  await page.goto('/?scenario=backup');
  await expect(page.getByRole('region', { name: 'JSONバックアップ' })).toContainText('平文JSON');
  await expect(page.getByRole('region', { name: 'JSONバックアップ' })).toContainText('未保存ドラフト');
  await page.locator('#search').fill('存在しない検索');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSONバックアップを作成' }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/^memo-backup-[\dTZ-]+\.json$/);
  const stream = await file.createReadStream();
  if (!stream) throw new Error('download');
  const parts: Buffer[] = []; for await (const part of stream) parts.push(Buffer.from(part));
  const bytes = Buffer.concat(parts), data = JSON.parse(bytes.toString('utf8'));
  expect(bytes[0]).toBe(123); expect(Object.keys(data)).toEqual(['format', 'backupVersion', 'sourceStorageVersion', 'exportedAt', 'data']);
  expect(data.format).toBe('myhomepage.memo.local-backup'); expect(data.backupVersion).toBe(1); expect(data.sourceStorageVersion).toBe(3);
  expect(data.data.memos).toHaveLength(12); expect(data.data.memos.filter((m: { deletedAt: string | null }) => m.deletedAt !== null)).toHaveLength(2);
  expect(data.data.memos[0].title).toBe('仕事メモ'); expect(data.data.tags).toHaveLength(2);
  expect(data.data.memoTags).toHaveLength(1); expect(data.data.deletedMemoIds).toHaveLength(1);
  expect(Object.keys(data.data)).toEqual(['memos', 'tags', 'memoTags', 'deletedMemoIds']);
  await expect(page.getByRole('region', { name: 'JSONバックアップ' })).toContainText('保存完了は保証できません');
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __previewDeniedAPIs: string[] }).__previewDeniedAPIs)).toEqual([]);
});

test('v2はダウンロードせず停止する', async ({ page }) => {
  let count = 0; page.on('download', () => count++);
  await page.goto('/'); await page.getByRole('button', { name: 'JSONバックアップを作成' }).click();
  await expect(page.getByRole('region', { name: 'JSONバックアップ' })).toContainText('v3-required');
  expect(count).toBe(0); await expect(page.locator('#count')).toContainText('12件');
});

test('未保存ドラフトを含めず保持する', async ({ page }) => {
  await page.goto('/?scenario=backup'); await page.locator('#new').click();
  await page.getByLabel('タイトル', { exact: true }).fill('未保存の秘密');
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'JSONバックアップを作成' }).click();
  const stream = await (await event).createReadStream(); if (!stream) throw new Error('download');
  let content = ''; for await (const part of stream) content += part.toString();
  expect(content).not.toContain('未保存の秘密'); await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('未保存の秘密');
});

test('同一操作の二重クリックを抑止し、繰り返しの明示出力は可能', async ({ page }) => {
  await page.goto('/?scenario=backup'); let count = 0; page.on('download', () => count++);
  const button = page.getByRole('button', { name: 'JSONバックアップを作成' });
  const first = page.waitForEvent('download');
  await button.evaluate((node: HTMLButtonElement) => { node.click(); node.click(); }); await first;
  await expect(button).toBeEnabled(); expect(count).toBe(1);
  const second = page.waitForEvent('download'); await button.click(); await second; expect(count).toBe(2);
});

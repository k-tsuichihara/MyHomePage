import { test as base, expect } from '@playwright/test';

const test = base.extend({ page: async ({ page, context }, use) => {
  const external: string[] = [], errors: string[] = [];
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4173') { external.push(route.request().url()); await route.abort(); }
    else await route.continue();
  });
  page.on('pageerror', error => errors.push(error.message)); await use(page);
  expect(external).toEqual([]); expect(errors).toEqual([]); expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __previewDeniedAPIs: string[] }).__previewDeniedAPIs)).toEqual([]);
} });

test('移行診断・キャンセル・再承認後にだけ通常一覧へ進む', async ({ page }) => {
  await page.goto('/?scenario=legacy'); await expect(page.locator('#migration-status')).toContainText('移行可能');
  await expect(page.locator('#memo-app')).toBeHidden();
  expect(await page.locator('body').textContent()).not.toContain('legacySnapshot');
  await page.locator('#migration-no').click(); await expect(page.locator('#migration-status')).toContainText('キャンセル');
  await expect(page.locator('#migration-confirmation')).toBeHidden(); await expect(page.locator('#memo-app')).toBeHidden();
  await page.locator('#migration-inspect').click(); await expect(page.locator('#migration-confirmation')).toBeVisible();
  await page.locator('#migration-yes').dblclick(); await expect(page.locator('#count')).toContainText('2件');
  await expect(page.locator('#cards')).toContainText('二件目');
});
test('pendingは明示承認後だけ復旧し通常一覧へ進む', async ({ page }) => {
  await page.goto('/?scenario=pending'); await expect(page.locator('#migration-status')).toContainText('pending');
  await expect(page.locator('#memo-app')).toBeHidden(); await page.locator('#migration-yes').click(); await expect(page.locator('#count')).toContainText('2件');
});
test('旧値なしは空一覧へ進む', async ({ page }) => {
  await page.goto('/?scenario=empty'); await expect(page.locator('#count')).toContainText('0件'); await expect(page.locator('#migration-view')).toBeHidden();
});
for (const scenario of ['invalid', 'broken-pending', 'no-locks']) test(`非破壊停止して通常画面へ進めない：${scenario}`, async ({ page }) => {
  await page.goto(`/?scenario=${scenario}`); await expect(page.locator('#migration-status')).toContainText('停止');
  await expect(page.locator('#memo-app')).toBeHidden(); await expect(page.locator('#migration-confirmation')).toBeHidden();
  await page.locator('#migration-inspect').click(); await expect(page.locator('#migration-status')).toContainText('停止');
});
test('書込中断は成功扱いせず、再診断後に新たな復旧承認が必要', async ({ page }) => {
  await page.goto('/?scenario=interrupted'); await page.locator('#migration-yes').click();
  await expect(page.locator('#migration-status')).toContainText('書込結果は未確認'); await expect(page.locator('#migration-status')).toContainText('pending');
  await expect(page.locator('#memo-app')).toBeHidden(); await page.locator('#migration-inspect').click();
  await expect(page.locator('#migration-status')).toContainText('pendingを検出'); await expect(page.locator('#memo-app')).toBeHidden();
  await page.locator('#migration-yes').click(); await expect(page.locator('#count')).toContainText('2件');
});
test('読戻し不一致は復旧不能として停止し自動補修しない', async ({ page }) => {
  await page.goto('/?scenario=readback-failure'); await page.locator('#migration-yes').click();
  await expect(page.locator('#migration-status')).toContainText('書込結果は未確認'); await expect(page.locator('#migration-status')).toContainText('invalid');
  await page.locator('#migration-inspect').click(); await expect(page.locator('#migration-status')).toContainText('invalid-data');
  await expect(page.locator('#memo-app')).toBeHidden();
});

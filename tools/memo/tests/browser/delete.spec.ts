import { expect, test } from '@playwright/test';
async function trash(page: import('@playwright/test').Page, scenario = 'delete') {
  await page.goto(`/?scenario=${scenario}`); await page.locator('#trash-view').click();
  await expect(page.locator('#count')).toContainText('2件');
}
test('個別削除は詳細で1件・不可逆を確認し、取消なら残し、成功だけ一覧へ戻る', async ({ page }) => {
  await trash(page); await page.getByRole('button', { name: '合成メモ 2', exact: true }).click();
  await page.locator('#permanent-delete').click();
  await expect(page.locator('#confirm-description')).toContainText('1件');
  await expect(page.locator('#confirm-description')).toContainText('元に戻せない');
  await page.locator('#confirm-no').click(); await expect(page.locator('#detail-title')).toHaveText('合成メモ 2');
  await page.locator('#permanent-delete').click(); await page.locator('#confirm-yes').click();
  await expect(page.locator('#save-status')).toContainText('1件の完全削除が成功');
  await expect(page.locator('#count')).toContainText('1件');
  await expect(page.locator('#cards').getByRole('button', { name: '合成メモ 2', exact: true })).toHaveCount(0);
});
test('検索で1件しか見えなくても一括確認はゴミ箱全件、0件時は未書込', async ({ page }) => {
  await trash(page); await page.locator('#search').fill('合成メモ 2'); await expect(page.locator('#count')).toContainText('1件');
  await page.locator('#empty-trash').click(); await expect(page.locator('#confirm-description')).toContainText('ゴミ箱全体の2件');
  await expect(page.locator('#confirm-description')).toContainText('検索条件外も対象');
  await page.locator('#confirm-yes').click(); await expect(page.locator('#save-status')).toContainText('2件の完全削除が成功');
  await page.locator('#search').fill(''); await expect(page.locator('#count')).toContainText('0件');
  await page.locator('#empty-trash').click(); await page.locator('#confirm-yes').click();
  await expect(page.locator('#save-status')).toContainText('0件'); await expect(page.locator('#save-status')).toContainText('書込は行っていません');
  await page.locator('#normal-view').click(); await expect(page.locator('#count')).toContainText('10件');
});
test('確認後の再読込で古い確認を実行しない', async ({ page }) => {
  await trash(page); await page.locator('#empty-trash').click(); await page.locator('#reload').click();
  await expect(page.locator('#confirmation')).toBeHidden();
  await expect(page.locator('#count')).toContainText('2件');
  await expect(page.locator('#save-status')).not.toContainText('完全削除が成功');
});
test('遅延削除中の二重確認は1回だけ、完了前に削除成功と表示しない', async ({ page }) => {
  await trash(page, 'delete-slow'); await page.locator('#empty-trash').click();
  await page.locator('#confirm-yes').evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  await expect(page.locator('#save-status')).toContainText('保存処理中');
  await expect(page.locator('#empty-trash')).toBeDisabled();
  await expect(page.locator('#save-status')).toContainText('2件の完全削除が成功');
  await expect(page.locator('#count')).toContainText('0件');
});
for (const scenario of ['delete-quota', 'delete-unknown', 'delete-readback']) test(`${scenario}は削除済みと断定せず、再読込と新確認を要求`, async ({ page }) => {
  await trash(page, scenario); await page.locator('#empty-trash').click(); await page.locator('#confirm-yes').click();
  await expect(page.locator('#save-status')).toContainText('不明');
  await expect(page.locator('#save-status')).not.toContainText('完全削除が成功');
  await expect(page.locator('#empty-trash')).toBeDisabled();
  await page.locator('#reload').click();
  await expect(page.locator('#save-status')).toContainText('不明');
  if (scenario === 'delete-quota') {
    await expect(page.locator('#count')).toContainText('2件'); await page.locator('#empty-trash').click();
    await expect(page.locator('#confirmation')).toBeVisible();
  }
});

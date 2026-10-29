import { expect, test } from '@playwright/test';

test('詳細からコピーし離脱をキャンセル、明示保存で非ピンの新規メモを作る', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '📌 仕事メモ', exact: true }).click();
  await page.locator('#duplicate').click();
  await expect(page.locator('#memo-title')).toHaveValue('仕事メモ');
  await expect(page.locator('#memo-body')).toHaveValue('入力・保存・ドラフト保護を検証します。');
  await expect(page.locator('#editor-tags').getByLabel('仕事', { exact: true })).toBeChecked();
  await expect(page.locator('#draft-status')).toContainText('未保存');
  await page.locator('#back').click(); await expect(page.locator('#confirmation')).toBeVisible();
  await page.locator('#confirm-no').click(); await expect(page.locator('#editor-view')).toBeVisible();
  await page.locator('#memo-title').fill('複製保存'); await page.locator('#save').click();
  await expect(page.locator('#detail-title')).toHaveText('複製保存');
  await page.locator('#back').click(); await expect(page.locator('#count')).toContainText('13件');
  await expect(page.getByRole('button', { name: '複製保存', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '📌 仕事メモ', exact: true })).toBeVisible();
});

test('一覧の︙から複製し破棄を承認しても元の件数・本文を保持', async ({ page }) => {
  await page.goto('/'); const first = page.locator('#cards li').first();
  await first.locator('summary').click(); await first.getByRole('button', { name: '複製', exact: true }).click();
  await page.locator('#memo-body').fill('未保存のコピー');
  await page.locator('#back').click(); await page.locator('#confirm-yes').click();
  await expect(page.locator('#count')).toContainText('12件');
  await page.getByRole('button', { name: '📌 仕事メモ', exact: true }).click();
  await expect(page.locator('#detail-body')).toHaveText('入力・保存・ドラフト保護を検証します。');
});

test('ゴミ箱では一覧・詳細とも複製不可', async ({ page }) => {
  await page.goto('/'); const first = page.locator('#cards li').first();
  await first.locator('summary').click(); await first.getByRole('button', { name: 'ゴミ箱へ', exact: true }).click();
  await page.locator('#confirm-yes').click(); await page.locator('#trash-view').click();
  await expect(page.locator('#count')).toContainText('1件');
  await expect(page.locator('#cards').getByRole('button', { name: '複製', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '📌 仕事メモ', exact: true }).click();
  await expect(page.locator('#duplicate')).toBeDisabled();
});

test('遅延保存の二重クリックと追加入力でもコピーを一度だけ保存', async ({ page }) => {
  await page.goto('/?scenario=slow');
  await page.getByRole('button', { name: '📌 仕事メモ', exact: true }).click(); await page.locator('#duplicate').click();
  await page.locator('#memo-title').fill('送信コピー');
  await page.locator('#save').evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  await expect(page.locator('#save-status')).toContainText('保存処理中');
  await page.locator('#memo-body').fill('保存中の追加');
  await expect(page.locator('#save-status')).toContainText('保存は成功');
  await expect(page.locator('#editor-view')).toBeVisible();
  await expect(page.locator('#memo-body')).toHaveValue('保存中の追加');
  await expect(page.locator('#draft-status')).toContainText('未保存');
  await page.locator('#back').click(); await page.locator('#confirm-yes').click();
  await expect(page.locator('#count')).toContainText('13件');
});

for (const scenario of ['rejected', 'unknown']) test(`${scenario}でも複製ドラフトを保持し自動再送しない`, async ({ page }) => {
  await page.goto(`/?scenario=${scenario}`);
  await page.getByRole('button', { name: '📌 仕事メモ', exact: true }).click(); await page.locator('#duplicate').click();
  await page.locator('#save').click();
  await expect(page.locator('#save-status')).toContainText(scenario === 'rejected' ? '拒否' : '不明');
  await expect(page.locator('#memo-title')).toHaveValue('仕事メモ');
  await expect(page.locator('#editor-view')).toBeVisible();
  if (scenario === 'unknown') await expect(page.locator('#save')).toBeDisabled();
});

import { test, expect } from '@playwright/test';
const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2024-01-01T00:00:00Z';
function backup(count = 2) {
  return Buffer.from(JSON.stringify({ format: 'myhomepage.memo.local-backup', backupVersion: 1, sourceStorageVersion: 3, exportedAt: now,
    data: { memos: Array.from({ length: count }, (_, i) => ({ id: i === 0 || i === 50 ? id(99).toUpperCase() : id(i + 1), title: `過去メモ${i + 1}`, body: '<script>合成本文</script>',
      createdAt: now, updatedAt: now, pinnedAt: now, deletedAt: now, revision: 8, lastRequestId: id(88) })),
      tags: [{ id: id(50), name: '過去の仕事', createdAt: now, revision: 1 }, { id: id(60), name: '消えたタグ', createdAt: now, revision: 1 }],
      memoTags: [{ memoId: id(99), tagId: id(50) }, { memoId: id(99), tagId: id(60) }], deletedMemoIds: [] } }));
}
test.beforeEach(async ({ context }) => { await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4173' ? route.continue() : route.abort()); });
async function upload(page: import('@playwright/test').Page, count = 2) {
  await page.getByLabel('単件回復のバックアップJSON').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: backup(count) });
  await expect(page.getByRole('region', { name: '完全削除後の回復', exact: true })).toContainText('初期未選択');
}
test('50件ページ・履歴による選択可否・単件読取プレビュー・戻るは0書込', async ({ page }) => {
  await page.goto('/?scenario=recovery'); await upload(page, 51);
  const area = page.getByRole('region', { name: '完全削除後の回復', exact: true });
  await expect(area.getByRole('button', { name: /をプレビュー/ })).toHaveCount(50);
  await expect(area.getByRole('button', { name: '2: 過去メモ2をプレビュー' })).toBeDisabled();
  await expect(area.getByRole('button', { name: '新しいメモとして復元' })).toHaveCount(0);
  await area.getByRole('button', { name: '単件回復の次ページ' }).click(); await expect(area.getByRole('button', { name: /をプレビュー/ })).toHaveCount(1);
  await area.getByRole('button', { name: '51: 過去メモ51をプレビュー' }).click();
  const preview = area.getByRole('article'); await expect(preview).toContainText('仕事'); await expect(preview).toContainText('消えたタグ');
  await expect(preview).toContainText('現在存在しないため復元されません'); await expect(preview.locator('input,textarea')).toHaveCount(0);
  await expect(preview).toContainText('<script>合成本文</script>'); await expect(preview.locator('script')).toHaveCount(0);
  await area.getByRole('button', { name: 'バックアップ一覧へ戻る' }).click(); await expect(page.locator('#count')).toContainText('10件');
});
test('直接保存・二重操作拒否・通常詳細・元プレビューの一時導線', async ({ page }) => {
  await page.goto('/?scenario=recovery-slow'); await upload(page);
  const area = page.getByRole('region', { name: '完全削除後の回復', exact: true });
  await area.getByRole('button', { name: '1: 過去メモ1をプレビュー' }).click();
  await area.getByRole('button', { name: '新しいメモとして復元' }).evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  await expect(area).toContainText('復元しています'); await expect(page.locator('#editor-view')).toBeHidden();
  await expect(area).toContainText('メモの作成を確認しました'); await expect(page.locator('#detail-title')).toHaveText('過去メモ1');
  await expect(page.locator('#detail-tags')).toHaveText('仕事'); await expect(page.locator('#count')).toContainText('11件');
  await expect(page.locator('#confirmation')).toBeHidden();
  await area.getByRole('button', { name: 'バックアッププレビューに戻る' }).click(); await expect(area.getByRole('article')).toBeVisible();
  await area.getByRole('button', { name: 'バックアップ一覧へ戻る' }).click();
  await upload(page); await expect(page.getByLabel('単件回復のバックアップJSON')).toHaveValue(''); await expect(page.locator('#count')).toContainText('11件');
});
test('書込後例外から一回だけ自動診断し、作成を確認して詳細へ進む', async ({ page }) => {
  await page.goto('/?scenario=recovery-unknown'); await upload(page);
  const area = page.getByRole('region', { name: '完全削除後の回復', exact: true });
  await area.getByRole('button', { name: '1: 過去メモ1をプレビュー' }).click(); await area.getByRole('button', { name: '新しいメモとして復元' }).click();
  await expect(area).toContainText('メモの作成を確認しました'); await expect(page.locator('#detail-title')).toHaveText('過去メモ1'); await expect(page.locator('#count')).toContainText('11件');
});
test('再診断失敗は結果不明、手動再診断と戻るだけでは追加書込しない', async ({ page }) => {
  await page.goto('/?scenario=recovery-unreadable'); await upload(page);
  const area = page.getByRole('region', { name: '完全削除後の回復', exact: true });
  await area.getByRole('button', { name: '1: 過去メモ1をプレビュー' }).click(); await area.getByRole('button', { name: '新しいメモとして復元' }).click();
  await expect(area).toContainText('復元結果は不明'); await expect(area).toContainText('重複する場合');
  await area.getByRole('button', { name: '単件回復の保存状況を再確認' }).click(); await expect(area).toContainText('復元結果は不明');
  await area.getByRole('button', { name: 'もう一度復元する' }).click(); await expect(area).toContainText('復元結果は不明');
  await area.getByRole('button', { name: '復元せずに戻る' }).click(); await expect(area).toContainText('初期未選択');
  await expect(area).not.toContainText('メモの作成を確認しました');
});

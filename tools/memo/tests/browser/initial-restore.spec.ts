import { test, expect } from '@playwright/test';
test.use({ acceptDownloads: true });
const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2024-02-29T00:00:00.123456+09:00';
function backup() {
  return { format: 'myhomepage.memo.local-backup', backupVersion: 1, sourceStorageVersion: 3, exportedAt: now,
    data: { memos: [0, 1].map(i => ({ id: id(i + 1), title: `初期復元${i + 1}`, body: ' 原本文\n', createdAt: now, updatedAt: now,
      revision: 7 + i, lastRequestId: id(80 + i), pinnedAt: i === 0 ? now : null, deletedAt: i === 1 ? now : null })),
      tags: [{ id: id(50), name: '初期タグ', createdAt: now, revision: 3 }], memoTags: [{ memoId: id(1), tagId: id(50) }], deletedMemoIds: [id(99), id(98)] } };
}
test.beforeEach(async ({ context }) => { await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4173' ? route.continue() : route.abort()); });
async function upload(page: import('@playwright/test').Page, value: unknown = backup()) {
  await page.getByLabel('初期復元のバックアップJSON').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
}
const area = (page: import('@playwright/test').Page) => page.getByRole('region', { name: '保存領域喪失時の初期復元' });
async function prepare(page: import('@playwright/test').Page) {
  await upload(page); await area(page).getByRole('button', { name: '初期復元の確認へ' }).click();
  await expect(area(page).getByRole('dialog')).toBeVisible();
}
test('初回起動から全件復元、通常/ゴミ箱/タグ表示と出力で全属性・履歴を確認', async ({ page }) => {
  await page.goto('/?scenario=initial'); await expect(page.locator('#count')).toContainText('0件'); await prepare(page);
  await expect(area(page)).toContainText('メモ2件・タグ1件・関連1件・削除履歴2件');
  await expect(area(page)).toContainText('平文'); await expect(area(page)).toContainText('真正性保証'); await expect(area(page)).toContainText('バックアップ作成後');
  await area(page).getByRole('button', { name: '確認して初期復元' }).click(); await expect(area(page)).toContainText('書込と読戻しを確認');
  await expect(page.locator('#count')).toContainText('1件'); await expect(page.locator('#cards')).toContainText('初期復元1');
  await expect(page.locator('#filters')).toContainText('初期タグ'); await page.getByRole('button', { name: 'ゴミ箱', exact: true }).click();
  await expect(page.locator('#cards')).toContainText('初期復元2');
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'JSONバックアップを作成' }).click();
  await page.getByRole('link', { name: '準備済みJSONをダウンロード' }).click(); const download = await downloading;
  const stream = await download.createReadStream(); if (!stream) throw Error('download');
  const parts: Buffer[] = []; for await (const part of stream) parts.push(Buffer.from(part));
  expect(JSON.parse(Buffer.concat(parts).toString('utf8')).data).toEqual(backup().data);
});
test('専用確認取消・ファイル差替え・遅延中の連打を保護', async ({ page }) => {
  await page.goto('/?scenario=initial-slow'); await prepare(page);
  await area(page).getByRole('button', { name: '初期復元をキャンセル' }).click(); await expect(page.locator('#count')).toContainText('0件');
  await prepare(page); await upload(page); await expect(area(page).getByRole('dialog')).toHaveCount(0);
  await area(page).getByRole('button', { name: '初期復元の確認へ' }).click();
  await area(page).getByRole('button', { name: '確認して初期復元' }).evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  await expect(page.getByLabel('初期復元のバックアップJSON')).toBeDisabled();
  await expect(area(page)).toContainText('書込と読戻しを確認'); await expect(page.locator('#count')).toContainText('1件');
});
test('通常新規利用を妨げず、最初の保存後は初期復元を拒否', async ({ page }) => {
  await page.goto('/?scenario=initial'); await page.locator('#new').click();
  await page.getByLabel('タイトル', { exact: true }).fill('通常の初回メモ'); await page.locator('#save').click();
  await expect(page.locator('#save-status')).toContainText('保存は成功'); await upload(page);
  await area(page).getByRole('button', { name: '初期復元の確認へ' }).click(); await expect(area(page)).toContainText('停止');
  await expect(area(page).getByRole('dialog')).toHaveCount(0); await expect(page.locator('#detail-title')).toHaveText('通常の初回メモ');
});
test('不正行を含むファイルは全体拒否し、部分復元しない', async ({ page }) => {
  await page.goto('/?scenario=initial'); const value = backup(); value.data.memos[1]!.title = '';
  await upload(page, value); await expect(area(page)).toContainText('停止'); await expect(area(page).getByRole('button', { name: '初期復元の確認へ' })).toHaveCount(0);
  await expect(page.locator('#count')).toContainText('0件');
});
test('確認中のファイル差替えは非同期読取の開始前に旧確認を失効する', async ({ page }) => {
  await page.goto('/?scenario=initial'); await prepare(page);
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const old = Array.from(document.querySelectorAll('button')).find(node => node.textContent === '確認して初期復元')!;
    Object.assign(window, { oldInitialConfirm: () => old.click(), releaseInitialFile: release });
    File.prototype.arrayBuffer = async function () { await gate; return original.call(this); };
  });
  await page.getByLabel('初期復元のバックアップJSON').setInputFiles({ name: 'replacement.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup())) });
  await expect(area(page).getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { oldInitialConfirm: () => void }).oldInitialConfirm());
  await expect(page.locator('#count')).toContainText('0件');
  await page.evaluate(() => (window as unknown as { releaseInitialFile: () => void }).releaseInitialFile());
  await expect(area(page)).toContainText('全件の内容・件数'); await expect(area(page).getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#count')).toContainText('0件');
});
test('quotaのunknownは自動診断せず、手動不在確認後も新準備・確認が必要', async ({ page }) => {
  await page.goto('/?scenario=initial-quota'); await prepare(page); await area(page).getByRole('button', { name: '確認して初期復元' }).click();
  await expect(area(page)).toContainText('結果は不明'); await expect(area(page).getByRole('button', { name: '初期復元の確認へ' })).toBeDisabled();
  await area(page).getByRole('button', { name: '初期復元の保存状況を診断' }).click(); await expect(area(page)).toContainText('過去の未保存を証明するものではありません');
  await area(page).getByRole('button', { name: '初期復元の確認へ' }).click(); await expect(area(page).getByRole('dialog')).toBeVisible();
  await area(page).getByRole('button', { name: '初期復元をキャンセル' }).click(); await expect(area(page)).toContainText('以前の初期復元結果が不明');
  await area(page).getByRole('button', { name: '初期復元を終了して通常利用' }).click(); await expect(area(page)).toContainText('以前の初期復元結果が不明');
  await expect(page.locator('#count')).toContainText('0件');
});
test('書込後例外の正常v3観測も過去成功に昇格せず、通常表示は明示再読込', async ({ page }) => {
  await page.goto('/?scenario=initial-after-write'); await prepare(page); await area(page).getByRole('button', { name: '確認して初期復元' }).click();
  await expect(area(page)).toContainText('結果は不明'); await area(page).getByRole('button', { name: '初期復元の保存状況を診断' }).click();
  await expect(area(page)).toContainText('過去の初期復元成功を証明するものではありません'); await expect(area(page).getByRole('button', { name: '初期復元の確認へ' })).toBeDisabled();
  await page.locator('#reload').click(); await expect(page.locator('#cards')).toContainText('初期復元1'); await expect(area(page)).toContainText('以前の初期復元結果が不明');
});
test('復元成功と後続通常画面の読込失敗を分離', async ({ page }) => {
  await page.goto('/?scenario=initial-reload-failure'); await prepare(page); await area(page).getByRole('button', { name: '確認して初期復元' }).click();
  await expect(area(page)).toContainText('書込と読戻しを確認'); await expect(area(page)).toContainText('通常画面の読込に失敗');
  await expect(area(page)).not.toContainText('初期復元の結果は不明');
});

test('成功後は再選択・再準備を禁止し、強制changeでも成功表示と保存データを保持', async ({ page }) => {
  await page.goto('/?scenario=initial'); await prepare(page); await area(page).getByRole('button', { name: '確認して初期復元' }).click();
  await expect(area(page)).toContainText('書込と読戻しを確認');
  await expect(page.getByLabel('初期復元のバックアップJSON')).toBeDisabled();
  await expect(area(page).getByRole('button', { name: '初期復元の確認へ' })).toBeDisabled();
  await expect(area(page)).toContainText('この画面から再実行はできません');
  // disabledを無視するchangeを注入しても、controllerは確定成功から動かない。
  await page.getByLabel('初期復元のバックアップJSON').evaluate((node: HTMLInputElement) => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['{'], 'invalid.json')); node.files = transfer.files;
    node.dispatchEvent(new Event('change'));
  });
  await expect(page.getByLabel('初期復元のバックアップJSON')).toBeDisabled();
  await expect(area(page)).toContainText('書込と読戻しを確認'); await expect(area(page)).not.toContainText('停止しました');
  await expect(area(page).getByRole('dialog')).toHaveCount(0); await page.locator('#reload').click();
  await expect(page.locator('#cards')).toContainText('初期復元1'); await expect(page.locator('#count')).toContainText('1件');
});

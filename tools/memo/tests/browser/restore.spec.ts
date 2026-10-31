import { expect, test } from '@playwright/test';
const id = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const now = '2025-01-01T00:00:00Z';
function file(count = 2, invalid = false) {
  return Buffer.from(JSON.stringify({ format: 'myhomepage.memo.local-backup', backupVersion: 1, sourceStorageVersion: 3, exportedAt: now,
    data: { memos: Array.from({ length: count }, (_, i) => ({ id: id(i + 1), title: invalid && i === count - 1 ? '' : `回復${i + 1}`, body: '<script>safe</script>', createdAt: now, updatedAt: now,
      pinnedAt: null, deletedAt: null, revision: 8, lastRequestId: null })),
    tags: [{ id: id(100), name: '仕事', createdAt: now, revision: 1 }, { id: id(101), name: '未使用輸入タグ', createdAt: now, revision: 1 }],
    memoTags: [{ memoId: id(1), tagId: id(100) }], deletedMemoIds: [id(999)] } }));
}
test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4173' ? route.continue() : route.abort());
});
async function upload(page: import('@playwright/test').Page, buffer = file()) {
  await page.getByLabel('バックアップJSONを選択').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer });
  await expect(page.getByRole('region', { name: '追加型復元' })).toContainText('正常行を選択');
}
test('初期未選択・50件ページ・頁選択と不正行除外・取消は0書込', async ({ page }) => {
  await page.goto('/?scenario=backup'); await upload(page, file(52, true));
  const area = page.getByRole('region', { name: '追加型復元' });
  await expect(area).toContainText('選択0件'); await expect(area.getByRole('button', { name: '追加内容を確認' })).toBeDisabled();
  await expect(area.getByRole('checkbox')).toHaveCount(50);
  await area.getByRole('button', { name: 'このページを選択' }).click(); await expect(area).toContainText('選択50件');
  await area.getByRole('button', { name: '次のページ' }).click(); await expect(area.getByRole('checkbox')).toHaveCount(2);
  await expect(area.getByRole('checkbox').nth(1)).toBeDisabled(); await area.getByRole('button', { name: 'このページを選択' }).click();
  await expect(area).toContainText('選択51件'); await area.getByRole('button', { name: '前のページ' }).click();
  await expect(area.getByRole('checkbox').first()).toBeChecked();
  await area.getByRole('button', { name: '追加内容を確認' }).click(); await expect(area.getByRole('dialog')).toContainText('新規メモ51件');
  await area.getByRole('button', { name: '復元をキャンセル' }).click(); await expect(page.locator('#count')).toContainText('10件');
});
test('確認後だけ単一追加し、全タグ統合・履歴保護・二重confirm抑止', async ({ page }) => {
  await page.goto('/?scenario=backup'); await upload(page);
  const area = page.getByRole('region', { name: '追加型復元' });
  await area.getByRole('checkbox').first().check(); await area.getByRole('button', { name: '追加内容を確認' }).click();
  await expect(area.getByRole('dialog')).toContainText('新規タグ1件');
  await area.getByRole('button', { name: '確認して復元' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(area).toContainText('追加型復元が成功'); await page.locator('#reload').click();
  await expect(page.locator('#count')).toContainText('11件'); await expect(page.locator('#cards')).toContainText('回復1');
  // 実保存APIを使わず、出力機能から合成保存先の全体を確認する。
  await expect(page.locator('#filters')).toContainText('未使用輸入タグ');
});
test('不正JSON・重複キー・BOMで停止し、旧選択と確認を流用しない', async ({ page }) => {
  await page.goto('/?scenario=backup'); await upload(page);
  const area = page.getByRole('region', { name: '追加型復元' }); await area.getByRole('checkbox').first().check();
  for (const buffer of [Buffer.from('{"x":0,"x":1}'), Buffer.from([0xef, 0xbb, 0xbf, 123, 125]), Buffer.from('{')]) {
    await page.getByLabel('バックアップJSONを選択').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer });
    await expect(area).toContainText('操作を停止'); await expect(area.getByRole('dialog')).toHaveCount(0); await expect(page.locator('#count')).toContainText('10件');
    await expect(area).toContainText('ファイルを選び直し、再診断・対象選択・確認を最初から');
  }
});
test('書込例外は結果不明・自動再送なし、明示再診断も過去成功へ昇格しない', async ({ page }) => {
  await page.goto('/?scenario=delete-unknown'); await upload(page);
  const area = page.getByRole('region', { name: '追加型復元' }); await area.getByRole('checkbox').first().check();
  await area.getByRole('button', { name: '追加内容を確認' }).click(); await area.getByRole('button', { name: '確認して復元' }).click();
  await expect(area).toContainText('復元結果は不明'); await expect(area.getByRole('button', { name: '追加内容を確認' })).toBeDisabled();
  await expect(area).toContainText('重複して追加される可能性');
  await area.getByRole('button', { name: '保存状況を再確認' }).click(); await expect(area).toContainText('過去の書込成功は確定しません');
  await page.locator('#reload').click(); await expect(page.locator('#count')).toContainText('11件');
});
test('確認後のファイル差替えは古い確認を失効する', async ({ page }) => {
  await page.goto('/?scenario=backup'); await upload(page);
  const area = page.getByRole('region', { name: '追加型復元' }); await area.getByRole('checkbox').first().check();
  await area.getByRole('button', { name: '追加内容を確認' }).click();
  await upload(page, file(3)); await expect(area.getByRole('dialog')).toHaveCount(0); await expect(area).toContainText('選択0件');
  await expect(page.locator('#count')).toContainText('10件');
});

test('同じファイルで失敗後に再診断でき、成功後の再復元も新しい選択と確認が必要', async ({ page }) => {
  await page.goto('/?scenario=backup');
  const area = page.getByRole('region', { name: '追加型復元' }), input = page.getByLabel('バックアップJSONを選択');
  const bad = { name: 'same-bad.json', mimeType: 'application/json', buffer: Buffer.from('{') };
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    let reads = 0;
    File.prototype.arrayBuffer = async function () {
      document.documentElement.setAttribute('data-file-reads', String(++reads));
      return original.call(this);
    };
  });
  await input.setInputFiles(bad); await expect(area).toContainText('操作を停止');
  await expect(input).toHaveValue('');
  // ファイル内容は変えずに再選択。読み取りが再実行されたことも確認する。
  await input.setInputFiles(bad); await expect(page.locator('html')).toHaveAttribute('data-file-reads', '2'); await expect(input).toHaveValue('');
  for (const expectedCount of [11, 12]) {
    await upload(page); await expect(input).toHaveValue(''); await expect(area).toContainText('選択0件');
    await expect(area.getByRole('dialog')).toHaveCount(0);
    await area.getByRole('checkbox').first().check(); await area.getByRole('button', { name: '追加内容を確認' }).click();
    await area.getByRole('button', { name: '確認して復元' }).click(); await expect(area).toContainText('追加型復元が成功');
    await page.locator('#reload').click(); await expect(page.locator('#count')).toContainText(`${expectedCount}件`);
  }
});

test('遅延ファイル読取中の差替え・通常操作は抑止し、最初のファイルだけ診断する', async ({ page }) => {
  await page.goto('/?scenario=backup');
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    Object.assign(window, { releaseFileRead: release });
    File.prototype.arrayBuffer = async function () { await gate; return original.call(this); };
  });
  const input = page.getByLabel('バックアップJSONを選択'), area = page.getByRole('region', { name: '追加型復元' });
  await input.setInputFiles({ name: 'first.json', mimeType: 'application/json', buffer: file(2) });
  await expect(input).toBeDisabled();
  await expect(page.locator('#reload')).toBeVisible();
  expect(await page.locator('#reload').evaluate(node => !!node.closest('[inert]'))).toBe(true);
  await input.evaluate((node: HTMLInputElement, raw) => {
    const replacement = new DataTransfer(); replacement.items.add(new File([raw], 'replacement.json')); node.files = replacement.files;
    node.dispatchEvent(new Event('change')); node.dispatchEvent(new Event('change'));
  }, file(3).toString('utf8'));
  await page.evaluate(() => (window as unknown as { releaseFileRead: () => void }).releaseFileRead());
  await expect(area.getByRole('checkbox')).toHaveCount(2); await expect(area).toContainText('選択0件');
  await expect(page.locator('#count')).toContainText('10件');
});

test('遅延準備・書込中の強制ファイル変更と連打は旧確認の再利用や二重書込を起こさない', async ({ page }) => {
  await page.goto('/?scenario=restore-slow'); await upload(page);
  const area = page.getByRole('region', { name: '追加型復元' }), input = page.getByLabel('バックアップJSONを選択');
  await area.getByRole('checkbox').first().check(); await area.getByRole('button', { name: '追加内容を確認' }).click();
  await expect(input).toBeDisabled();
  // disabledを無視したイベント注入でも、リセット拒否後のidle確認で読取を止める。
  await input.evaluate((node: HTMLInputElement, raw) => {
    const replacement = new DataTransfer(); replacement.items.add(new File([raw], 'replacement.json')); node.files = replacement.files;
    node.dispatchEvent(new Event('change')); node.dispatchEvent(new Event('change'));
  }, file(3).toString('utf8'));
  await expect(area.getByRole('dialog')).toContainText('新規メモ1件');
  await area.getByRole('button', { name: '確認して復元' }).evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  await expect(input).toBeDisabled(); await input.evaluate(node => node.dispatchEvent(new Event('change')));
  await expect(area).toContainText('追加型復元が成功'); await expect(area).toContainText('通常一覧は再読込');
  await page.locator('#reload').click(); await expect(page.locator('#count')).toContainText('11件');
});

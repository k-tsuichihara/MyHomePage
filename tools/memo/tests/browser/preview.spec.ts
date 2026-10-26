import { test as base, expect } from '@playwright/test';

// 各テストはPlaywright既定の新規BrowserContext。ユーザープロファイルやstorageStateは渡さない。
const test = base.extend({ page: async ({ page, context }, use, info) => {
  const external: string[] = [], errors: string[] = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') { external.push(url.origin); await route.abort(); }
    else await route.continue();
  });
  page.on('pageerror', error => errors.push(error.message));
  await use(page);
  expect(external).toEqual([]); expect(errors).toEqual([]); expect(await context.cookies()).toEqual([]);
  const denied = await page.evaluate(() => (window as unknown as { __previewDeniedAPIs?: string[] }).__previewDeniedAPIs ?? []);
  expect(denied).toEqual(info.annotations.some(item => item.type === 'expected-api-probes')
    ? ['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookie'] : []);
} });
const openEditor = async (page: import('@playwright/test').Page, scenario = '') => {
  await page.goto(`/${scenario ? `?scenario=${scenario}` : ''}`);
  await expect(page.locator('#read-status')).toContainText('読込が完了');
  await page.getByRole('button', { name: '📌 仕事メモ', exact: true }).click();
  await page.getByRole('button', { name: '編集する', exact: true }).click();
  await expect(page.locator('#editor-view')).toBeVisible();
};

test('新規保存・検索・タグ・前後移動とスクロールを接続する', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '新規作成', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill(' UI新規 ');
  await page.getByLabel('本文', { exact: true }).fill(' 本文を保持\n ');
  await page.locator('#editor-tags').getByLabel('仕事', { exact: true }).check();
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('保存は成功');
  await expect(page.locator('#detail-title')).toHaveText('UI新規'); expect(await page.locator('#detail-body').textContent()).toBe(' 本文を保持\n ');
  await page.getByRole('button', { name: '一覧へ戻る' }).click();
  await page.getByLabel('検索', { exact: true }).fill('UI新規'); await expect(page.locator('#count')).toContainText('1件');
  await page.getByLabel('検索', { exact: true }).fill(''); await page.getByLabel('並び替え').selectOption('created-asc');
  await page.locator('#cards').evaluate(node => { node.scrollTop = 250; node.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(50);
  const scroll = await page.locator('#cards').evaluate(node => node.scrollTop);
  await page.getByRole('button', { name: '📌 仕事メモ', exact: true }).click();
  await page.getByRole('button', { name: '次のメモ', exact: true }).click(); await expect(page.locator('#detail-title')).toHaveText('合成メモ 2');
  await page.getByRole('button', { name: '一覧へ戻る' }).click();
  await expect(page.getByLabel('並び替え')).toHaveValue('created-asc');
  expect(await page.locator('#cards').evaluate(node => node.scrollTop)).toBe(scroll);
});

test('ゴミ箱・復元は確認を経由し、完全削除を提供しない', async ({ page }) => {
  await page.goto('/'); const row = page.locator('#cards li').first(); await row.locator('summary').click();
  await row.getByRole('button', { name: 'ゴミ箱へ', exact: true }).click();
  await expect(page.locator('#confirmation')).toBeVisible(); await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(page.locator('#count')).toContainText('12件');
  await row.getByRole('button', { name: 'ゴミ箱へ', exact: true }).click(); await page.getByRole('button', { name: '確認して実行' }).click();
  await expect(page.locator('#count')).toContainText('11件'); await page.getByRole('button', { name: 'ゴミ箱', exact: true }).click();
  await expect(page.locator('#count')).toContainText('1件'); await page.locator('#cards summary').click();
  await page.getByRole('button', { name: '復元する' }).click(); await page.getByRole('button', { name: '確認して実行' }).click();
  await expect(page.locator('#count')).toContainText('0件'); expect(await page.getByRole('button', { name: '完全削除' }).count()).toBe(0);
});

test('タグ管理・使用件数・ピン操作をcontrollerへ接続する', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#count')).toContainText('12件');
  await page.locator('#tag-manager summary').click(); await page.getByLabel('タグ名', { exact: true }).fill('新タグ');
  await page.getByRole('button', { name: 'タグを保存' }).click(); await expect(page.locator('#filters')).toContainText('新タグ');
  await page.getByLabel('管理するタグ').selectOption({ label: '新タグ' }); await page.getByRole('button', { name: 'タグを削除' }).click();
  await page.getByRole('button', { name: '確認して実行' }).click(); await expect(page.locator('#filters')).not.toContainText('新タグ');
  const second = page.locator('#cards li').filter({ hasText: '合成メモ 2' }); await second.locator('summary').click();
  await second.getByRole('button', { name: 'ピン留め', exact: true }).click();
  await expect(second.locator('.open-card')).toContainText('📌');
});

test('未保存確認のキャンセルと、確認後の編集による失効を表示する', async ({ page }) => {
  await openEditor(page); await page.getByLabel('タイトル', { exact: true }).fill('未保存');
  await page.getByRole('button', { name: '一覧へ戻る' }).click(); await expect(page.locator('#confirmation')).toBeVisible();
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click(); await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('未保存');
  await page.getByRole('button', { name: '一覧へ戻る' }).click(); await page.getByLabel('タイトル', { exact: true }).fill('確認後の編集');
  await expect(page.locator('#confirmation')).toBeHidden(); await expect(page.locator('#editor-view')).toBeVisible();
  await page.getByRole('button', { name: '一覧へ戻る' }).click(); await page.getByRole('button', { name: '確認して実行' }).click();
  await expect(page.locator('#list-view')).toBeVisible();
});

test('遅延保存中も追加入力を保ち、二重送信で書込を増やさない', async ({ page }) => {
  await openEditor(page, 'slow'); await page.getByLabel('タイトル', { exact: true }).fill('送信内容');
  await page.locator('#memo-form').evaluate(form => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#save-status')).toContainText('保存処理中'); await expect(page.locator('#save')).toBeDisabled();
  await page.getByLabel('本文', { exact: true }).fill('送信後の追加編集');
  await expect(page.locator('#save-status')).toContainText('保存は成功'); await expect(page.locator('#editor-view')).toBeVisible();
  await expect(page.getByLabel('本文', { exact: true })).toHaveValue('送信後の追加編集'); await expect(page.locator('#draft-status')).toContainText('未保存の追加');
  await page.getByRole('button', { name: '一覧へ戻る' }).click(); await page.getByRole('button', { name: '確認して実行' }).click();
  const saved = page.locator('#cards li').filter({ hasText: '送信内容' });
  await expect(saved).toHaveAttribute('data-revision', '2');
});

test('拒否されたclean保存でも失敗表示と離脱確認を維持する', async ({ page }) => {
  await openEditor(page, 'rejected'); await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('拒否'); await expect(page.locator('#editor-view')).toBeVisible();
  await page.getByRole('button', { name: '一覧へ戻る' }).click(); await expect(page.locator('#confirm-description')).toContainText('保存が拒否');
});

test('結果不明は成功と区別し、明示再読込でも成功へ昇格しない', async ({ page }) => {
  await openEditor(page, 'unknown'); await page.getByLabel('本文', { exact: true }).fill('結果不明の入力');
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('結果は不明'); await expect(page.locator('#read-status')).toContainText('失敗');
  await page.getByRole('button', { name: '再読込', exact: true }).click();
  await expect(page.locator('#read-status')).toContainText('完了'); await expect(page.locator('#save-status')).toContainText('結果は不明');
  await expect(page.getByLabel('本文', { exact: true })).toHaveValue('結果不明の入力'); await expect(page.locator('#error')).toContainText('不整合');
});

test('保存成功と後続の再読込失敗を同時に表示する', async ({ page }) => {
  await openEditor(page, 'reload-failure'); await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('保存は成功'); await expect(page.locator('#read-status')).toContainText('失敗');
  await expect(page.locator('#draft-status')).toContainText('未保存の変更はありません');
});

test('IME変換中に保存が完了してもDOM・フォーカス・カーソルを保持する', async ({ page }) => {
  await openEditor(page, 'slow'); await page.getByRole('button', { name: '保存する', exact: true }).click();
  const body = page.getByLabel('本文', { exact: true }); await body.focus();
  await body.evaluate(node => {
    const input = node as HTMLTextAreaElement; input.dataset.identity = 'same-node';
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = '変換途中'; input.setSelectionRange(2, 2);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: '途中' }));
  });
  await expect(page.locator('#save-status')).toContainText('保存は成功');
  await expect(body).toBeFocused(); await expect(body).toHaveValue('変換途中'); await expect(body).toHaveAttribute('data-identity', 'same-node');
  expect(await body.evaluate(node => [(node as HTMLTextAreaElement).selectionStart, (node as HTMLTextAreaElement).selectionEnd])).toEqual([2, 2]);
  await body.dispatchEvent('compositionend', { data: '変換途中' });
  await expect(page.locator('#editor-view')).toBeVisible(); await expect(page.locator('#draft-status')).toContainText('未保存の追加');
  await expect(body).toBeFocused();
});

test('狭い画面幅でキーボード編集・入力エラーを表示する', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); await openEditor(page);
  await page.getByLabel('タイトル', { exact: true }).fill('😀'.repeat(101)); await page.getByLabel('タイトル', { exact: true }).press('Tab');
  await expect(page.getByLabel('本文', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: '保存する', exact: true }).click(); await expect(page.locator('#error')).toContainText('入力を確認');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('footer')).toBeVisible(); await page.screenshot({ path: 'test-results/narrow-memory.png', fullPage: true });
});

test('永続APIは未使用で、明示的な試行も実APIへ到達しない', async ({ page }) => {
  await openEditor(page); await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('保存は成功');
  expect(await page.evaluate(() => (window as unknown as { __previewDeniedAPIs: string[] }).__previewDeniedAPIs)).toEqual([]);
  test.info().annotations.push({ type: 'expected-api-probes', description: '禁止ガードを検証。実保存APIは呼ばない。' });
  const blocked = await page.evaluate(() => {
    const checks = [() => window.localStorage, () => window.sessionStorage, () => window.indexedDB,
      () => window.caches, () => { document.cookie = 'synthetic=blocked'; }];
    return checks.map(check => { try { check(); return false; } catch { return true; } });
  });
  expect(blocked).toEqual([true, true, true, true, true]);
});

test('専用サーバーは検証資産以外を配信せずCSPを設定する', async ({ request }) => {
  for (const path of ['/memo.html', '/src/input.ts', '/.env.local', '/AGENTS.md', '/preview.js.map', '/%2e%2e/package.json']) {
    expect((await request.get(path)).status()).toBe(404);
  }
  expect((await request.post('/')).status()).toBe(405);
  expect((await request.get('/', { headers: { Host: 'localhost:4173' } })).status()).toBe(403);
  const response = await request.get('/'); expect(response.headers()['content-security-policy']).toContain("connect-src 'none'");
  expect(response.headers()['set-cookie']).toBeUndefined();
});

test('入力文字列をHTMLとして実行せず、確認画面に対象と操作を表示する', async ({ page }) => {
  await openEditor(page); const payload = '<img src="https://example.invalid/leak">';
  await page.getByLabel('タイトル', { exact: true }).fill(payload); await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expect(page.locator('#detail-title')).toHaveText(payload); expect(await page.locator('img').count()).toBe(0);
  await page.getByRole('button', { name: '一覧へ戻る' }).click(); const row = page.locator('#cards li').filter({ hasText: payload });
  await row.locator('summary').click(); await row.getByRole('button', { name: 'ゴミ箱へ', exact: true }).click();
  await expect(page.locator('#confirm-description')).toContainText(payload); await expect(page.locator('#confirm-description')).toContainText('ゴミ箱へ移動');
});

const frames = async (page: import('@playwright/test').Page) => page.evaluate(() =>
  new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

test('確認のキャンセル・再表示・遅延読込による失効を区別する', async ({ page }) => {
  await openEditor(page, 'slow-load'); await page.getByLabel('タイトル', { exact: true }).fill('確認対象');
  await page.getByRole('button', { name: '一覧へ戻る' }).click(); await frames(page); await expect(page.locator('#confirmation')).toBeVisible();
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click(); await frames(page); await expect(page.locator('#confirmation')).toBeHidden();
  await page.getByRole('button', { name: '一覧へ戻る' }).click(); await frames(page); await expect(page.locator('#confirmation')).toBeVisible();
  await page.getByRole('button', { name: '再読込', exact: true }).click(); await expect(page.locator('#read-status')).toContainText('再読込中');
  await expect(page.locator('#confirmation')).toBeHidden(); await page.getByLabel('本文', { exact: true }).fill('読込中の追加編集');
  await expect(page.locator('#read-status')).toContainText('完了'); await frames(page);
  await expect(page.locator('#confirmation')).toBeHidden(); await expect(page.locator('#editor-view')).toBeVisible();
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('確認対象');
  await page.getByRole('button', { name: '一覧へ戻る' }).click(); await frames(page); await expect(page.locator('#confirmation')).toBeVisible();
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(page.getByLabel('本文', { exact: true })).toHaveValue('読込中の追加編集');
});

test('保存応答後にフォーカスと別入力欄を切り替えても古い値を再投入しない', async ({ page }) => {
  await openEditor(page, 'slow');
  await page.getByLabel('タイトル', { exact: true }).fill('送信タイトル'); await page.getByLabel('本文', { exact: true }).fill('送信本文');
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill('追加タイトル');
  const body = page.getByLabel('本文', { exact: true }); await body.fill('追加本文');
  await body.evaluate(node => { (node as HTMLTextAreaElement).setSelectionRange(2, 2); });
  await expect(page.locator('#save-status')).toContainText('保存は成功'); await frames(page);
  await expect(body).toBeFocused(); expect(await body.evaluate(node => (node as HTMLTextAreaElement).selectionStart)).toBe(2);
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('追加タイトル'); await expect(body).toHaveValue('追加本文');
  await page.getByLabel('タイトル', { exact: true }).fill('応答後タイトル'); await body.fill('応答後本文');
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('応答後タイトル');
  await page.getByRole('button', { name: '保存する', exact: true }).click(); await expect(page.locator('#detail-view')).toBeVisible();
  await expect(page.locator('#detail-title')).toHaveText('応答後タイトル'); await expect(page.locator('#detail-body')).toHaveText('応答後本文');
});

test('遅延再読込中の別入力欄の編集をフォーカス移動後も保持する', async ({ page }) => {
  await openEditor(page, 'slow-load'); await page.getByLabel('タイトル', { exact: true }).fill('読込前のタイトル');
  await page.getByRole('button', { name: '再読込', exact: true }).click(); await page.getByLabel('本文', { exact: true }).fill('読込待ちの本文');
  await expect(page.locator('#read-status')).toContainText('完了');
  await page.getByLabel('タイトル', { exact: true }).fill('読込後のタイトル'); await page.getByLabel('本文', { exact: true }).press('End');
  await page.getByLabel('本文', { exact: true }).pressSequentially('追記');
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('読込後のタイトル');
  await expect(page.getByLabel('本文', { exact: true })).toHaveValue('読込待ちの本文追記');
});

test('一覧のready切替でカードDOMが再生成されてもスクロールと条件を保持する', async ({ page }) => {
  await page.goto('/?scenario=slow-load'); await expect(page.locator('#read-status')).toContainText('完了');
  await page.getByLabel('並び替え').selectOption('created-asc');
  await page.locator('#cards').evaluate(node => { node.scrollTop = 300; node.dispatchEvent(new Event('scroll')); }); await frames(page);
  const scroll = await page.locator('#cards').evaluate(node => node.scrollTop);
  await page.getByRole('button', { name: '再読込', exact: true }).click();
  await expect(page.locator('#cards .open-card').first()).toBeDisabled(); await expect(page.locator('#read-status')).toContainText('完了');
  await expect(page.locator('#cards .open-card').first()).toBeEnabled();
  expect(await page.locator('#cards').evaluate(node => node.scrollTop)).toBe(scroll);
  await expect(page.getByLabel('並び替え')).toHaveValue('created-asc'); await expect(page.locator('#confirmation')).toBeHidden();
});

test('一覧メニューからの確認はスクロールで消えずbusy再描画でも二重操作しない', async ({ page }) => {
  await page.goto('/?scenario=slow-mutation'); await expect(page.locator('#read-status')).toContainText('完了');
  const row = page.locator('#cards li').filter({ hasText: '合成メモ 6' }); await row.locator('summary').click(); await frames(page);
  await row.getByRole('button', { name: 'ゴミ箱へ', exact: true }).click(); await frames(page);
  await expect(page.locator('#confirmation')).toBeVisible(); await expect(page.locator('#confirm-description')).toContainText('合成メモ 6');
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click(); await row.getByRole('button', { name: 'ゴミ箱へ', exact: true }).click();
  await frames(page); await expect(page.locator('#confirmation')).toBeVisible();
  await page.getByRole('button', { name: '確認して実行' }).click(); await expect(page.locator('#save-status')).toContainText('保存処理中');
  await expect(page.locator('#confirmation')).toBeHidden(); await expect(page.locator('#cards .open-card').first()).toBeDisabled();
  await expect(page.locator('#read-status')).toContainText('完了'); await expect(page.locator('#save-status')).toContainText('保存は成功');
  await expect(page.locator('#count')).toContainText('11件');
});

test('無関係なタグ追加・削除・使用件数変更で選択中タグを解除しない', async ({ page }) => {
  await page.goto('/?scenario=slow-mutation'); const work = page.locator('#filters').getByLabel('仕事（使用 1件）', { exact: true }); await work.check();
  await expect(page.locator('#count')).toContainText('1件'); await page.locator('#tag-manager summary').click();
  await page.getByLabel('タグ名', { exact: true }).fill('無関係なタグ'); await page.getByRole('button', { name: 'タグを保存' }).click();
  await expect(page.locator('#save-status')).toContainText('保存は成功'); await expect(work).toBeChecked();
  await page.getByLabel('管理するタグ').selectOption({ label: '無関係なタグ' }); await page.getByRole('button', { name: 'タグを削除' }).click();
  await page.getByRole('button', { name: '確認して実行' }).click(); await expect(page.locator('#filters')).not.toContainText('無関係なタグ'); await expect(work).toBeChecked();
  await page.locator('#cards summary').click(); await page.getByRole('button', { name: 'ゴミ箱へ', exact: true }).click();
  await page.getByRole('button', { name: '確認して実行' }).click();
  await expect(page.locator('#filters').getByLabel('仕事（使用 0件）', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'ゴミ箱', exact: true }).click(); await expect(page.locator('#count')).toContainText('1件');
  await page.locator('#cards summary').click(); await page.getByRole('button', { name: '復元する', exact: true }).click();
  await page.getByRole('button', { name: '確認して実行' }).click(); await expect(work).toBeChecked();
});

test('選択タグ削除後の検索・並び替えでも不在タグIDを黙って解除しない', async ({ page }) => {
  await page.goto('/'); await page.locator('#filters').getByLabel('仕事（使用 1件）', { exact: true }).check();
  await page.locator('#tag-manager summary').click(); await page.getByLabel('管理するタグ').selectOption({ label: '仕事' });
  await page.getByRole('button', { name: 'タグを削除' }).click(); await page.getByRole('button', { name: '確認して実行' }).click();
  await expect(page.locator('#missing-tags')).toContainText('削除されています'); await expect(page.locator('#count')).toContainText('0件');
  await page.getByLabel('検索', { exact: true }).fill('合成');
  await expect(page.locator('#missing-tags')).toContainText('削除されています'); await expect(page.locator('#count')).toContainText('0件');
  await page.getByLabel('並び替え').selectOption('created-asc'); await expect(page.locator('#missing-tags')).toContainText('削除されています');
  await page.getByRole('button', { name: 'タグ絞り込みを解除', exact: true }).click();
  await expect(page.locator('#missing-tags')).toBeEmpty(); await expect(page.locator('#count')).toContainText('11件');
});

test('busy中にタグ選択をクリックしても表示だけが未選択へ変わらない', async ({ page }) => {
  await page.goto('/?scenario=slow-mutation'); const work = page.locator('#filters').getByLabel('仕事（使用 1件）', { exact: true }); await work.check();
  await page.locator('#cards summary').click(); await page.getByRole('button', { name: 'ピン解除', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('保存処理中');
  await work.evaluate(node => { (node as HTMLInputElement).click(); });
  await expect(work).toBeChecked(); await expect(page.locator('#read-status')).toContainText('完了');
  await expect(page.locator('#save-status')).toContainText('保存は成功'); await expect(work).toBeChecked();
  await expect(page.locator('#count')).toContainText('1件');
});

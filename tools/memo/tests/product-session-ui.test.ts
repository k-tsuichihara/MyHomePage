import { beforeAll, afterAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

let browser: Browser, code: string, html: string;
beforeAll(async () => {
  code = (await build({ entryPoints: [fileURLToPath(new URL('./product-session-fixture.ts', import.meta.url))],
    bundle: true, write: false, format: 'iife', platform: 'browser' })).outputFiles[0]!.text;
  execFileSync(process.execPath, ['scripts/build-product.mjs'], { cwd: fileURLToPath(new URL('../', import.meta.url)) });
  html = (await readFile(new URL('../.product/site/tools/memo/memo.html', import.meta.url), 'utf8'))
    .replace(/<script type="module"[^>]*><\/script>/, '<script src="/fixture.js"></script>');
  expect(html).toContain('<script src="/fixture.js"></script>');
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });
async function pageFor(mode = 'normal') {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(mode => { Object.assign(window, { fixtureMode: mode }); }, mode);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://product.test') return route.abort();
    if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: code });
    if (url.pathname === '/tools/memo/memo.html') return route.fulfill({ contentType: 'text/html', body: html });
    return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(3000);
  await page.goto('https://product.test/tools/memo/memo.html');
  if (!mode.startsWith('migration')) await page.locator('#memo-app:not([hidden])').waitFor();
  return page;
}
const probe = (page: Page, code: string) => page.evaluate(code);
async function login(page: Page) {
  await page.getByLabel('ログイン用メールアドレス').fill('synthetic-email@example.invalid');
  await page.getByLabel('ログイン用パスワード').fill('synthetic-password');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
}
async function selectCloud(page: Page) {
  await page.getByRole('button', { name: 'クラウドを選択', exact: true }).click();
}
async function editCloud(page: Page) {
  await selectCloud(page);
  await page.getByRole('button', { name: 'クラウドの合成メモ', exact: true }).click();
  await page.getByRole('button', { name: 'このクラウドメモを編集', exact: true }).click();
  await page.getByLabel('クラウドのタイトル', { exact: true }).fill('変更したクラウドタイトル');
  await page.getByLabel('クラウドの本文', { exact: true }).fill('変更したクラウド本文');
}
it('cloud既存1件を編集/保存し、localへ書かず要求の成功だけを表示する', async () => {
  const page = await pageFor('cloud-edit-success'); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    const local = await probe(page, 'fixture.state()');
    await editCloud(page); await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
    await page.getByText(/保存要求の成功を確認/).waitFor();
    expect(await probe(page, 'fixture.savedArgs().p_expected_revision')).toBe(1);
    expect(await probe(page, 'fixture.savedArgs().p_title')).toBe('変更したクラウドタイトル');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    expect(await probe(page, 'fixture.state()')).toEqual(local);
    expect(await page.locator('#product-cloud-snapshot').isHidden()).toBe(true);
    const output = (await page.locator('body').innerHTML()) + JSON.stringify(logs) + page.url();
    for (const secret of ['synthetic-password', 'synthetic-token-private', 'synthetic-email@example.invalid', 'raw-provider-token']) expect(output).not.toContain(secret);
    const request = await probe(page, 'fixture.savedArgs().p_request_id'); expect(output).not.toContain(request);
    expect(output).not.toMatch(/00000000-0000-4000-8000-000000000(?:002|101|102|103)/);
  } finally { await page.context().close(); }
});
it.each(['conflict', 'rejected', 'unknown'])('cloud save %sは成功扱いせず編集を保持し、自動再送しない', async outcome => {
  const page = await pageFor(`cloud-edit-${outcome}`); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    await editCloud(page); await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
    await page.locator('#product-cloud-editor').getByText(outcome === 'unknown' ? /保存できたか不明/ : outcome === 'conflict' ? /競合/ : /保存は拒否/).waitFor();
    expect(await page.getByLabel('クラウドのタイトル', { exact: true }).inputValue()).toBe('変更したクラウドタイトル');
    expect(await page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('変更したクラウド本文');
    expect(await page.getByText(/保存要求の成功/).count()).toBe(0);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    const output = (await page.locator('body').innerHTML()) + JSON.stringify(logs) + page.url();
    for (const secret of ['synthetic-password', 'synthetic-token-private', 'synthetic-email@example.invalid', 'raw-provider-token']) expect(output).not.toContain(secret);
    expect(output).not.toContain(await probe(page, 'fixture.savedArgs().p_request_id'));
    if (outcome === 'unknown') {
      expect(await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).isDisabled()).toBe(true);
      expect(await probe(page, 'fixture.dispose()')).toBe('pending');
      expect(await page.locator('#product-session').count()).toBe(1);
    }
  } finally { await page.context().close(); }
});
it.each(['unknown', 'no-record', 'deleted'])('結果不明後の明示resolve %sを元要求に結び付けて扱う', async outcome => {
  const page = await pageFor(`cloud-edit-${outcome}`);
  try {
    await editCloud(page); await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
    await page.getByText(/保存できたか不明/).waitFor();
    await page.getByRole('button', { name: 'クラウドの保存結果を照合', exact: true }).click();
    if (outcome === 'unknown') await page.getByText(/保存要求の成功を確認/).waitFor();
    if (outcome === 'no-record') await page.getByText(/未実行の証明ではありません/).waitFor();
    if (outcome === 'deleted') await page.locator('#product-cloud-editor').getByText(/メモは削除済み/).waitFor();
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save', 'memo_resolve_request']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    if (outcome !== 'unknown') expect(await page.getByText(/保存要求の成功/).count()).toBe(0);
  } finally { await page.context().close(); }
});
it('save中は二重save/保存先変更/logout/disposeを拒否し、追加編集を成功応答で消さない', async () => {
  const page = await pageFor('cloud-edit-pending');
  try {
    await editCloud(page); await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
    await page.waitForFunction('fixture.rpcNames.length === 2');
    await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).dispatchEvent('click');
    await page.getByRole('button', { name: 'ローカルを選択', exact: true }).dispatchEvent('click');
    await page.getByRole('button', { name: 'ログアウト', exact: true }).dispatchEvent('click');
    expect(await probe(page, 'fixture.dispose()')).toBe('busy');
    expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    await page.getByLabel('クラウドの本文', { exact: true }).fill('送信後の追加編集');
    await probe(page, 'fixture.releaseSave()');
    await page.getByText(/追加の未保存変更があります/).waitFor();
    expect(await page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('送信後の追加編集');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['expired', 'generation', 'target'])('save中の%s変更で旧成功応答を現在の保存成功にしない', async change => {
  const page = await pageFor('cloud-edit-pending');
  try {
    await editCloud(page); await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
    await page.waitForFunction('fixture.rpcNames.length === 2');
    if (change === 'expired') await probe(page, 'fixture.expired()');
    if (change === 'generation') await probe(page, 'fixture.refreshAuth()');
    if (change === 'target') await probe(page, 'fixture.forceLocal()');
    await probe(page, 'fixture.releaseSave()');
    await page.waitForFunction('fixture.calls.saveCompleted === 1');
    expect(await page.getByText(/保存要求の成功/).count()).toBe(0);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('古いsnapshotの編集ボタンから編集を開始できず、ゴミ箱メモには編集を提供しない', async () => {
  const page = await pageFor('cloud-edit-success');
  try {
    await selectCloud(page); await page.getByRole('button', { name: 'ゴミ箱の合成メモ', exact: true }).click();
    expect(await page.getByRole('button', { name: 'このクラウドメモを編集', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'クラウド一覧へ戻る', exact: true }).click();
    await page.getByRole('button', { name: 'クラウドの合成メモ', exact: true }).click();
    await page.getByRole('button', { name: 'このクラウドメモを編集', exact: true }).evaluate(node => Object.assign(window, { oldEditButton: node }));
    await probe(page, 'fixture.refreshAuth()'); await page.getByText(/認証が更新されました/).waitFor();
    await probe(page, 'window.oldEditButton.click()');
    expect(await page.locator('#product-cloud-editor').isHidden()).toBe(true);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
  } finally { await page.context().close(); }
});
it('cloud dirty logoutのcancelはdraftとtargetを保持し、確認後の編集は古い確認を失効させる', async () => {
  const page = await pageFor('cloud-edit-success');
  try {
    await editCloud(page);
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.getByRole('button', { name: 'ログアウトをキャンセル', exact: true }).click();
    expect(await page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('変更したクラウド本文');
    expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.getByLabel('クラウドの本文', { exact: true }).fill('確認後のcloud編集');
    await page.getByRole('button', { name: '確認してログアウト', exact: true }).click();
    expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
  } finally { await page.context().close(); }
});
it('UNKNOWNのdraftは同一user再認証後も保持し、明示resolveだけで元要求を照合する', async () => {
  const page = await pageFor('cloud-edit-unknown');
  try {
    await editCloud(page); await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
    await page.getByText(/保存できたか不明/).waitFor();
    await probe(page, 'fixture.refreshAuth()'); await page.getByText(/認証が更新されました/).waitFor();
    expect(await page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('変更したクラウド本文');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save']);
    await page.getByRole('button', { name: 'クラウドの保存結果を照合', exact: true }).click();
    await page.getByText(/保存要求の成功を確認/).waitFor();
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save', 'memo_resolve_request']);
  } finally { await page.context().close(); }
});
it('実際にdisposeした後は取り外された編集/saveボタンから通信・UIを再開しない', async () => {
  const page = await pageFor('cloud-edit-success');
  try {
    await editCloud(page);
    await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).evaluate(node => Object.assign(window, { oldSaveButton: node }));
    expect(await probe(page, 'fixture.dispose()')).toBe('applied');
    await probe(page, 'window.oldSaveButton.click()');
    expect(await page.locator('#product-session').count()).toBe(0);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('検証済みsnapshotだけを一覧/詳細/タグとして安全に読み、local draftや保存領域へ流し込まない', async () => {
  const page = await pageFor('cloud-snapshot'); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    const view = page.locator('#product-cloud-snapshot');
    expect(await view.isHidden()).toBe(true);
    await page.locator('#new').click(); await page.locator('#memo-title').fill('保持するlocal draft');
    const before = await probe(page, 'fixture.state()');
    await selectCloud(page); await page.getByRole('button', { name: '確認して保存先を変更' }).click();
    await view.getByRole('heading', { name: 'クラウドメモ一覧（読取専用）', exact: true }).waitFor();
    expect(await view.getByRole('button').count()).toBe(2);
    await view.getByRole('button', { name: 'クラウドの合成メモ', exact: true }).click();
    expect(await view.locator('pre').textContent()).toBe('<b>読取専用の本文</b>');
    expect(await view.locator('b').count()).toBe(0);
    expect(await view.getByText('タグ：既存クラウドタグ', { exact: true }).count()).toBe(1);
    expect(await view.locator('input,textarea,select,form,a').count()).toBe(0);
    await view.getByRole('button', { name: 'クラウド一覧へ戻る', exact: true }).click();
    await view.getByRole('button', { name: 'ゴミ箱の合成メモ', exact: true }).click();
    expect(await view.getByText('ゴミ箱内のメモ（読取専用）', { exact: true }).count()).toBe(1);
    expect(await view.getByText('タグなし', { exact: true }).count()).toBe(1);
    await page.locator('#save').dispatchEvent('click');
    expect(await probe(page, 'fixture.state()')).toEqual(before);
    expect(await probe(page, 'fixture.stored()')).toEqual([]);
    const output = (await page.locator('body').innerHTML()) + JSON.stringify(logs) + page.url();
    expect(output).not.toMatch(/00000000-0000-4000-8000-000000000(?:002|101|102|103)/);
    for (const secret of ['synthetic-email@example.invalid', 'synthetic-password', 'synthetic-token-private', 'raw-provider-token', 'user_id', 'last_request_id']) expect(output).not.toContain(secret);
    await page.getByRole('button', { name: 'ローカルを選択', exact: true }).click();
    await page.getByRole('button', { name: '確認して保存先を変更' }).click();
    expect(await view.isHidden()).toBe(true); expect(await view.textContent()).toBe('');
    expect(await page.locator('#memo-title').inputValue()).toBe('保持するlocal draft');
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
  } finally { await page.context().close(); }
});
it.each(['expired', 'generation', 'logout', 'dispose'])('snapshot表示後の%sで一覧/詳細と旧ボタンを失効させる', async change => {
  const page = await pageFor('cloud-snapshot');
  try {
    await selectCloud(page);
    await page.getByRole('button', { name: 'クラウドの合成メモ', exact: true }).waitFor();
    await probe(page, 'window.oldCloudButton = document.querySelector("#product-cloud-snapshot button")');
    if (change === 'expired') await probe(page, 'fixture.expired()');
    if (change === 'generation') await probe(page, 'fixture.refreshAuth()');
    if (change === 'logout') await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    if (change === 'dispose') await probe(page, 'fixture.dispose()');
    await page.waitForFunction('!document.querySelector("#product-cloud-snapshot") || document.querySelector("#product-cloud-snapshot").hidden');
    await probe(page, 'window.oldCloudButton.click()');
    expect(await page.getByText(/クラウドメモ詳細/).count()).toBe(0);
    expect(await page.getByText('クラウドの合成メモ', { exact: true }).count()).toBe(0);
    if (change === 'expired' || change === 'generation') expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('通知前の期限到達も一覧選択時に既存isCurrentで検出し詳細を開かない', async () => {
  const page = await pageFor('cloud-snapshot');
  try {
    await selectCloud(page); await page.getByRole('button', { name: 'クラウドの合成メモ', exact: true }).waitFor();
    await probe(page, 'fixture.expireSilently(); document.querySelector("#product-cloud-snapshot button").click()');
    expect(await page.locator('#product-cloud-snapshot').isHidden()).toBe(true);
    expect(await page.getByText(/クラウドメモ詳細/).count()).toBe(0);
    expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
  } finally { await page.context().close(); }
});
it.each(['failure', 'unverified', 'permission', 'invalid'])('成功snapshotの再loadが%sでも旧一覧/詳細を残さず再試行しない', async outcome => {
  const page = await pageFor('cloud-snapshot'); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    await selectCloud(page); await page.getByRole('button', { name: 'クラウドの合成メモ', exact: true }).click();
    await page.getByRole('button', { name: 'ローカルを選択', exact: true }).click();
    await probe(page, `fixture.snapshotMode('${outcome}')`);
    await selectCloud(page);
    await page.locator('#product-cloud-state').filter({ hasText: /UNKNOWN|停止/ }).waitFor();
    expect(await page.locator('#product-cloud-snapshot').isHidden()).toBe(true);
    expect(await page.locator('#product-cloud-snapshot').textContent()).toBe('');
    expect(await page.getByText('クラウドの合成メモ', { exact: true }).count()).toBe(0);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_load_snapshot']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    const output = (await page.locator('body').innerHTML()) + JSON.stringify(logs);
    for (const secret of ['synthetic-email@example.invalid', 'synthetic-password', 'synthetic-token-private', 'raw-provider-token']) expect(output).not.toContain(secret);
  } finally { await page.context().close(); }
});
it('同じcloud選択はsnapshotを失効させず再loadもしない', async () => {
  const page = await pageFor('cloud-snapshot');
  try {
    await selectCloud(page); await page.getByRole('button', { name: 'クラウドの合成メモ', exact: true }).click();
    await selectCloud(page);
    expect(await page.getByText('クラウドメモ詳細（読取専用）', { exact: true }).count()).toBe(1);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
  } finally { await page.context().close(); }
});
it('取り外した旧snapshotのボタンは再load後の一覧を操作できない', async () => {
  const page = await pageFor('cloud-snapshot');
  try {
    await selectCloud(page); await page.getByRole('button', { name: 'クラウドの合成メモ', exact: true }).waitFor();
    await probe(page, 'window.oldCloudButton = document.querySelector("#product-cloud-snapshot button")');
    await page.getByRole('button', { name: 'ローカルを選択', exact: true }).click();
    await selectCloud(page); await page.getByRole('button', { name: 'クラウドの合成メモ', exact: true }).waitFor();
    await probe(page, 'window.oldCloudButton.click()');
    expect(await page.getByText('クラウドメモ一覧（読取専用）', { exact: true }).count()).toBe(1);
    expect(await page.getByText('クラウドメモ詳細（読取専用）', { exact: true }).count()).toBe(0);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_load_snapshot']);
  } finally { await page.context().close(); }
});
it('cloud切替をcancelした間は音声を保持し、確定前に停止して旧認識結果を遮断する', async () => {
  const page = await pageFor('cloud-voice');
  try {
    await page.locator('#new').click(); await page.locator('#memo-title').fill('音声ドラフト');
    await page.locator('#editor-view').getByRole('button', { name: '音声で本文へ追記', exact: true }).click();
    expect(await probe(page, 'fixture.voiceCalls.start')).toBe(1);
    const draft = await probe(page, 'fixture.state().editor.draft');
    await selectCloud(page); await page.getByRole('button', { name: '保存先変更をキャンセル' }).click();
    expect(await probe(page, 'fixture.voiceCalls.abort')).toBe(0);
    expect(await page.getByRole('button', { name: '音声入力を停止', exact: true }).isEnabled()).toBe(true);
    await selectCloud(page); await page.getByRole('button', { name: '確認して保存先を変更' }).click();
    await page.getByText(/クラウド読取成功/).waitFor();
    expect(await probe(page, 'fixture.voiceCalls.abort')).toBe(1);
    expect(await probe(page, 'fixture.voiceDetached()')).toBe(true);
    await probe(page, 'fixture.lateVoice()');
    expect(await probe(page, 'fixture.state().editor.draft')).toEqual(draft);
    await page.getByRole('button', { name: 'ローカルを選択', exact: true }).click();
    await page.getByRole('button', { name: '確認して保存先を変更' }).click();
    await page.locator('#editor-view').getByRole('button', { name: '音声で本文へ追記', exact: true }).click();
    expect(await probe(page, 'fixture.voiceCalls.start')).toBe(2);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
  } finally { await page.context().close(); }
});
it('同一userのUUID大文字小文字差を正規化し、世代更新と再選択後のloadを許可する', async () => {
  const page = await pageFor('cloud-casing');
  try {
    await selectCloud(page); await page.getByText(/クラウド読取成功/).waitFor();
    await probe(page, 'fixture.uppercaseAuth()');
    await page.getByText(/認証が更新されました/).waitFor();
    expect(await probe(page, 'fixture.target().generation')).toBe(await probe(page, 'fixture.auth().generation'));
    expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    await page.getByRole('button', { name: 'ローカルを選択', exact: true }).click();
    await selectCloud(page); await page.getByText(/クラウド読取成功/).waitFor();
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_load_snapshot']);
    expect(await page.locator('body').textContent()).not.toMatch(/00000000-0000-4000-8000-00000000abcd/i);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('C05の初期localからcloud選択し既存C03/C04経路のloadのみ1回、local保存へfallbackしない', async () => {
  const page = await pageFor('cloud');
  try {
    await page.getByText('ログイン済み', { exact: true }).waitFor();
    expect(await probe(page, 'fixture.target().target')).toBe('local');
    expect(await probe(page, 'fixture.rpcNames')).toEqual([]);
    await selectCloud(page);
    await page.getByText(/クラウド読取成功/).waitFor();
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    expect(await page.locator('#memo-app').evaluate(node => node instanceof HTMLElement && node.inert)).toBe(true);
    // inertを無視する合成clickでもviewのdispatch境界がlocal書込を拒否する。
    await page.locator('#new').dispatchEvent('click');
    expect(await probe(page, 'fixture.state().editor')).toBeNull();
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    await selectCloud(page);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    await page.getByRole('button', { name: 'ローカルを選択', exact: true }).click();
    expect(await page.locator('#memo-app').evaluate(node => node instanceof HTMLElement && node.inert)).toBe(false);
    await page.locator('#new').click(); await page.locator('#memo-title').fill('localに戻った明示保存'); await page.locator('#save').click();
    await page.waitForFunction('fixture.state().write.kind === "succeeded"');
  } finally { await page.context().close(); }
});
it.each(['cloud-no-session', 'cloud-no-host'])('%sなら従来local-onlyを維持する', async mode => {
  const page = await pageFor(mode);
  try {
    expect(await page.getByRole('button', { name: 'クラウドを選択', exact: true }).count()).toBe(0);
    expect(await probe(page, 'fixture.rpcNames')).toEqual([]);
    await page.locator('#new').click(); await page.locator('#memo-title').fill('local-only'); await page.locator('#save').click();
    await page.waitForFunction('fixture.state().write.kind === "succeeded"');
  } finally { await page.context().close(); }
});
it('未認証cloudをC05で拒否し、Auth成立だけでは切替/読取を行わない', async () => {
  const page = await pageFor('cloud-signed-out');
  try {
    await selectCloud(page);
    expect(await probe(page, 'fixture.target().target')).toBe('local');
    expect(await probe(page, 'fixture.rpcNames')).toEqual([]);
    await login(page); await page.getByText('ログイン済み', { exact: true }).waitFor();
    expect(await probe(page, 'fixture.target().target')).toBe('local');
    expect(await probe(page, 'fixture.rpcNames')).toEqual([]);
  } finally { await page.context().close(); }
});
it('dirty切替cancelは全状態保持、編集後の古い確認は拒否、cloud失効/logoutでもdraftを保持する', async () => {
  const page = await pageFor('cloud');
  try {
    await page.locator('#new').click(); await page.locator('#memo-title').fill('保持するlocal draft');
    const before = await probe(page, 'fixture.state()');
    await selectCloud(page); await page.getByRole('button', { name: '保存先変更をキャンセル' }).click();
    expect(await probe(page, 'fixture.state()')).toEqual(before);
    expect(await probe(page, 'fixture.target().target')).toBe('local');
    await selectCloud(page); await page.locator('#memo-title').fill('編集後');
    await page.getByRole('button', { name: '確認して保存先を変更' }).click();
    expect(await probe(page, 'fixture.target().target')).toBe('local');
    expect(await probe(page, 'fixture.rpcNames')).toEqual([]);
    await selectCloud(page); await page.getByRole('button', { name: '確認して保存先を変更' }).click();
    await page.getByText(/クラウド読取成功/).waitFor();
    await page.locator('#save').dispatchEvent('click');
    expect(await probe(page, 'fixture.calls.writes')).toBe(0);
    await probe(page, 'fixture.expired()'); await page.getByText(/クラウド選択とドラフトは保持/).waitFor();
    expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    expect(await probe(page, 'fixture.target().dirty')).toBe(true);
    expect(await page.locator('#memo-title').inputValue()).toBe('編集後');
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.getByRole('button', { name: 'ログアウトをキャンセル' }).click();
    expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.getByRole('button', { name: '確認してログアウト' }).click();
    await page.getByText('未ログイン', { exact: true }).waitFor();
    expect(await probe(page, 'fixture.target().target')).toBe('local');
    expect(await page.locator('#memo-title').inputValue()).toBe('編集後');
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
  } finally { await page.context().close(); }
});
it.each(['cloud-failure', 'cloud-unverified', 'cloud-permission'])('%sをlocal成功へ読み替えずcloudを保持し自動再送しない', async mode => {
  const page = await pageFor(mode); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    await selectCloud(page);
    await page.locator('#product-cloud-state').filter({ hasText: /UNKNOWN|停止/ }).waitFor();
    await probe(page, 'fixture.stale()');
    expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    expect(await page.locator('#product-cloud-state').textContent()).not.toContain('成功');
    const output = (await page.locator('body').textContent()) + JSON.stringify(logs);
    for (const secret of ['synthetic-token-private', 'synthetic-email@example.invalid', 'synthetic-password', 'raw-provider-token', '00000000-0000-4000-8000-000000000002']) expect(output).not.toContain(secret);
  } finally { await page.context().close(); }
});
it.each(['local', 'generation', 'dispose'])('pending load後の%s変更で古いcloud応答を反映せず自動送信しない', async change => {
  const page = await pageFor('cloud-snapshot-pending');
  try {
    await selectCloud(page); await page.waitForFunction('fixture.rpcNames.length === 1');
    await selectCloud(page);
    if (change === 'local') await page.getByRole('button', { name: 'ローカルを選択', exact: true }).click();
    if (change === 'generation') {
      await probe(page, 'fixture.refreshAuth()');
      await page.waitForFunction('fixture.auth().phase === "authenticated" && fixture.target().generation === fixture.auth().generation');
    }
    if (change === 'dispose') await probe(page, 'fixture.dispose()');
    await probe(page, 'fixture.releaseRead()');
    await page.waitForFunction('fixture.calls.readCompleted === 1');
    if (change === 'local') expect(await probe(page, 'fixture.target().target')).toBe('local');
    if (change === 'generation') expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    if (change === 'dispose') {
      expect(await page.locator('#product-session').count()).toBe(0);
      await page.waitForFunction('fixture.calls.cloudDispose === 1');
      expect(await probe(page, 'fixture.calls.listenerUnsubscribe')).toBe(1);
    }
    expect(await page.getByText(/クラウド読取成功/).count()).toBe(0);
    expect(await page.getByText('クラウドの合成メモ', { exact: true }).count()).toBe(0);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('cloudへの確認中にAuth世代が更新されると旧確認を拒否し、cloud利用中の同一user更新ではdirtyを保持する', async () => {
  const page = await pageFor('cloud');
  try {
    await page.locator('#new').click(); await page.locator('#memo-title').fill('世代をまたぐdraft');
    await selectCloud(page);
    const old = await probe(page, 'fixture.auth().generation');
    await probe(page, 'fixture.refreshAuth()');
    await page.waitForFunction(generation => {
      const f = (window as unknown as { fixture: { auth(): { generation: number; phase: string } } }).fixture;
      return f.auth().phase === 'authenticated' && f.auth().generation !== generation;
    }, old);
    await page.getByRole('button', { name: '確認して保存先を変更' }).click();
    expect(await probe(page, 'fixture.target().target')).toBe('local');
    expect(await probe(page, 'fixture.rpcNames')).toEqual([]);
    await selectCloud(page); await page.getByRole('button', { name: '確認して保存先を変更' }).click();
    await page.getByText(/クラウド読取成功/).waitFor();
    await probe(page, 'fixture.refreshAuth()');
    await page.getByText(/認証が更新されました/).waitFor();
    expect(await probe(page, 'fixture.target().generation')).toBe(await probe(page, 'fixture.auth().generation'));
    expect(await probe(page, 'fixture.target().dirty')).toBe(true);
    expect(await page.locator('#memo-title').inputValue()).toBe('世代をまたぐdraft');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
  } finally { await page.context().close(); }
});
it('保存中のcloud切替と確認後の保存開始を拒否する', async () => {
  const page = await pageFor('cloud');
  try {
    await page.locator('#new').click(); await page.locator('#memo-title').fill('保存が先');
    await selectCloud(page);
    await probe(page, 'fixture.holdWrite()'); await page.locator('#save').click();
    await page.getByRole('button', { name: '確認して保存先を変更' }).click();
    expect(await probe(page, 'fixture.target().target')).toBe('local');
    await page.getByRole('button', { name: 'クラウドを選択', exact: true }).dispatchEvent('click');
    expect(await probe(page, 'fixture.rpcNames')).toEqual([]);
    await probe(page, 'fixture.releaseWrite()');
    await page.waitForFunction('fixture.state().write.kind === "succeeded"');
    await selectCloud(page); await page.getByText(/クラウド読取成功/).waitFor();
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
  } finally { await page.context().close(); }
});
it.each(['rejected', 'unknown'])('editor外の%sもC05切替確認へ渡し、cancelで状態を維持する', async failure => {
  const page = await pageFor('cloud');
  try {
    await probe(page, failure === 'rejected' ? 'fixture.failReads(true)' : 'fixture.failWrites()');
    await probe(page, 'fixture.saveTag()');
    const state = await probe(page, 'fixture.state()');
    await selectCloud(page); await page.getByRole('button', { name: '保存先変更をキャンセル' }).click();
    expect(await probe(page, 'fixture.state()')).toEqual(state);
    expect(await probe(page, 'fixture.target().target')).toBe('local');
    expect(await probe(page, 'fixture.rpcNames')).toEqual([]);
  } finally { await page.context().close(); }
});
it('製品compositionで復元/ログイン/失効表示、古い通知を拒否し秘密を出さない', async () => {
  const page = await pageFor();
  try {
    await page.getByText('未ログイン', { exact: true }).waitFor();
    expect(await probe(page, 'fixture.calls.login')).toBe(0);
    await login(page); await page.getByText('ログイン済み', { exact: true }).waitFor();
    expect(await page.getByLabel('ログイン用パスワード').inputValue()).toBe('');
    expect(await page.getByLabel('ログイン用メールアドレス').inputValue()).toBe('');
    await probe(page, 'fixture.stale()');
    expect(await page.locator('#product-session-state').textContent()).toBe('ログイン済み');
    await probe(page, 'fixture.expired()');
    await page.getByText(/同じユーザーで再認証/).waitFor();
    const visible = await page.locator('body').textContent();
    for (const secret of ['synthetic-email@example.invalid', 'synthetic-password', 'synthetic-token-private', '00000000-0000-4000-8000-000000000002'])
      expect(visible).not.toContain(secret);
    expect(await probe(page, 'fixture.calls.fetch')).toBe(0);
    expect(await probe(page, 'fixture.calls.writes')).toBe(0);
    expect(await probe(page, 'fixture.stored()')).toEqual([]);
  } finally { await page.context().close(); }
});
it('復元済みsessionを表示し、clean logoutはscope localで既存sessionへ委譲する', async () => {
  const page = await pageFor('restore');
  try {
    await page.getByText('ログイン済み', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.getByText('未ログイン', { exact: true }).waitFor();
    expect(await probe(page, 'fixture.calls.logout')).toBe(1);
    expect(await page.getByText('保存先：ローカル（クラウド未接続）').count()).toBe(1);
  } finally { await page.context().close(); }
});
it('dirty logout cancel保持、編集後の古い確認を拒否しproceedだけAuthへ渡す', async () => {
  const page = await pageFor('restore');
  try {
    await page.locator('#new').click(); await page.locator('#memo-title').fill('保持するドラフト');
    const before = await probe(page, 'fixture.state()');
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.getByRole('button', { name: 'ログアウトをキャンセル' }).click();
    expect(await page.locator('#memo-title').inputValue()).toBe('保持するドラフト');
    expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    expect(await probe(page, 'fixture.state()')).toEqual(before);
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.locator('#memo-title').fill('確認後に編集');
    await page.getByRole('button', { name: '確認してログアウト' }).click();
    expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    await page.getByText(/確認後に状態が変わりました/).waitFor();
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.getByRole('button', { name: '確認してログアウト' }).click();
    await page.getByText('未ログイン', { exact: true }).waitFor();
    expect(await probe(page, 'fixture.calls.logout')).toBe(1);
    expect(await page.locator('#memo-title').inputValue()).toBe('確認後に編集');
  } finally { await page.context().close(); }
});
it('保存中logoutを抑止し、確認後に保存開始しても拒否する。local保存は成立する', async () => {
  const page = await pageFor('restore');
  try {
    await page.locator('#new').click(); await page.locator('#memo-title').fill('local保存');
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await probe(page, 'fixture.holdWrite()'); await page.locator('#save').click();
    await page.getByRole('button', { name: '確認してログアウト' }).click();
    expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    expect(await page.getByRole('button', { name: 'ログアウト', exact: true }).isDisabled()).toBe(true);
    await probe(page, 'fixture.releaseWrite()');
    await page.waitForFunction('fixture.calls.writes > 0 && fixture.state().write.kind !== "writing"');
    expect(await probe(page, 'fixture.state().data.memos[0].title')).toBe('local保存');
    expect(await probe(page, 'fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('二重ログインを抑止しdispose後の遅い完了/通知でDOMを復活させない', async () => {
  const page = await pageFor('pending');
  try {
    await login(page);
    expect(await page.getByRole('button', { name: 'ログイン', exact: true }).isDisabled()).toBe(true);
    await page.locator('#product-session form').dispatchEvent('submit');
    expect(await probe(page, 'fixture.calls.login')).toBe(1);
    await probe(page, 'fixture.dispose(); fixture.dispose(); fixture.releaseLogin(); fixture.stale()');
    expect(await page.locator('#product-session').count()).toBe(0);
    expect(await probe(page, 'fixture.calls.unsubscribe')).toBe(1);
    expect(await probe(page, 'fixture.calls.listenerUnsubscribe')).toBe(1);
    expect(await probe(page, 'fixture.calls.dispose')).toBe(1);
    expect(await probe(page, 'fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('生例外をDOM/consoleへ流さず失敗理由だけを表示する', async () => {
  const page = await pageFor('throw'); const logs: string[] = [];
  page.on('console', message => logs.push(message.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    await login(page); await page.getByText(/認証を確認できません/).waitFor();
    const output = (await page.locator('body').textContent()) + JSON.stringify(logs);
    for (const secret of ['synthetic-email@example.invalid', 'synthetic-password', 'raw-provider-token']) expect(output).not.toContain(secret);
    expect(await probe(page, 'fixture.calls.logout')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['rejected', 'unknown'])('cleanでも%sをnavigationへ委譲してlogout確認する', async failure => {
  const page = await pageFor('restore');
  try {
    await page.locator('#new').click(); await page.locator('#memo-title').fill('保存試行');
    await probe(page, failure === 'rejected' ? 'fixture.failReads(true)' : 'fixture.failWrites()');
    await page.locator('#save').click();
    await page.waitForFunction(`fixture.state().write.kind === '${failure}'`);
    await probe(page, 'fixture.failReads(false)');
    // baselineへ戻してdirtyをなくす。rejected/unresolvedの意味は消さない。
    await page.locator('#memo-title').fill('');
    expect(await probe(page, 'fixture.dirty()')).toBe(false);
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.getByRole('button', { name: 'ログアウトをキャンセル' }).waitFor();
    expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    await page.getByRole('button', { name: 'ログアウトをキャンセル' }).click();
    expect(await probe(page, 'fixture.state().write.kind')).toBe(failure);
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.getByRole('button', { name: '確認してログアウト' }).click();
    await page.getByText('未ログイン', { exact: true }).waitFor();
    expect(await probe(page, 'fixture.calls.logout')).toBe(1);
    expect(await probe(page, 'fixture.state().write.kind')).toBe(failure);
  } finally { await page.context().close(); }
});
it.each(['rejected', 'unknown'])('editor外のタグ保存%sもlogout確認しcancel保持・古い確認拒否・続行できる', async failure => {
  const page = await pageFor('restore');
  try {
    await probe(page, failure === 'rejected' ? 'fixture.failReads(true)' : 'fixture.failWrites()');
    await probe(page, 'fixture.saveTag()');
    expect(await probe(page, 'fixture.state().editor')).toBeNull();
    expect(await probe(page, 'fixture.state().write.kind')).toBe(failure);
    const before = await probe(page, 'fixture.state()');
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.getByRole('button', { name: 'ログアウトをキャンセル' }).click();
    expect(await probe(page, 'fixture.state()')).toEqual(before);
    expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await probe(page, 'fixture.failReads(false); fixture.reload()');
    await page.getByRole('button', { name: '確認してログアウト' }).click();
    await page.getByText(/確認後に状態が変わりました/).waitFor();
    expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    const after = await probe(page, 'fixture.state()');
    const writes = await probe(page, 'fixture.calls.writes');
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.getByRole('button', { name: '確認してログアウト' }).click();
    await page.getByText('未ログイン', { exact: true }).waitFor();
    expect(await probe(page, 'fixture.calls.logout')).toBe(1);
    expect(await probe(page, 'fixture.state()')).toEqual(after);
    expect(await probe(page, 'fixture.calls.writes')).toBe(writes);
    expect(await probe(page, 'fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['migration', 'migration-recover'])('%s実行中はlogoutせず、完了後に再び操作できる', async mode => {
  const page = await pageFor(mode);
  try {
    await page.locator('#migration-yes').waitFor({ state: 'visible' });
    await page.getByText('ログイン済み', { exact: true }).waitFor();
    await probe(page, 'fixture.holdWrite()');
    await page.locator('#migration-yes').click();
    await page.waitForFunction('fixture.migration().kind === "running"');
    const logout = page.getByRole('button', { name: 'ログアウト', exact: true });
    expect(await logout.isDisabled()).toBe(true);
    await logout.dispatchEvent('click');
    expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    await probe(page, 'fixture.releaseWrite()');
    await page.locator('#memo-app:not([hidden])').waitFor();
    await page.waitForFunction('!document.querySelector("#product-session form button:last-child").disabled');
    await logout.click(); await page.getByText('未ログイン', { exact: true }).waitFor();
    expect(await probe(page, 'fixture.calls.logout')).toBe(1);
    expect(await probe(page, 'fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['バックアップJSONを選択', '単件回復のバックアップJSON'])('%sの読取中はlogout抑止し、終了時にボタンを復帰する', async label => {
  const page = await pageFor('restore-data');
  try {
    await page.getByText('ログイン済み', { exact: true }).waitFor();
    await probe(page, 'fixture.holdWrite()');
    const backup = { format: 'myhomepage.memo.local-backup', backupVersion: 1, sourceStorageVersion: 3,
      exportedAt: '2026-01-01T00:00:00Z', data: { memos: [], tags: [], memoTags: [], deletedMemoIds: [] } };
    await page.getByLabel(label, { exact: true }).setInputFiles({ name: 'fake.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    const logout = page.getByRole('button', { name: 'ログアウト', exact: true });
    await page.waitForFunction('document.querySelector("#product-session form button:last-child").disabled');
    await logout.dispatchEvent('click');
    expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    await probe(page, 'fixture.releaseWrite()');
    await page.waitForFunction('!document.querySelector("#product-session form button:last-child").disabled');
    expect(await probe(page, 'fixture.calls.writes')).toBe(0);
    await logout.click(); await page.getByText('未ログイン', { exact: true }).waitFor();
    expect(await probe(page, 'fixture.calls.logout')).toBe(1);
    expect(await probe(page, 'fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('初期復元の診断中と確認中はlogoutせず、cancel完了時にボタンを復帰する', async () => {
  const page = await pageFor('restore');
  try {
    await page.getByText('ログイン済み', { exact: true }).waitFor();
    const backup = { format: 'myhomepage.memo.local-backup', backupVersion: 1, sourceStorageVersion: 3,
      exportedAt: '2026-01-01T00:00:00Z', data: { memos: [], tags: [], memoTags: [], deletedMemoIds: [] } };
    await page.getByLabel('初期復元のバックアップJSON').setInputFiles({ name: 'fake.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await probe(page, 'fixture.holdWrite()');
    await page.getByRole('button', { name: '初期復元の確認へ', exact: true }).click();
    const logout = page.getByRole('button', { name: 'ログアウト', exact: true });
    expect(await logout.isDisabled()).toBe(true);
    await logout.dispatchEvent('click');
    expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    await probe(page, 'fixture.releaseWrite()');
    await page.getByRole('button', { name: '初期復元をキャンセル', exact: true }).waitFor();
    expect(await logout.isDisabled()).toBe(true);
    await page.getByRole('button', { name: '初期復元をキャンセル', exact: true }).click();
    expect(await logout.isDisabled()).toBe(false);
    await logout.click(); await page.getByText('未ログイン', { exact: true }).waitFor();
    expect(await probe(page, 'fixture.calls.logout')).toBe(1);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('注入なしならAuth UI/初期化がなく既存local保存が動く', async () => {
  const page = await pageFor('absent');
  try {
    expect(await page.locator('#product-session').count()).toBe(0);
    expect(await probe(page, 'fixture.calls.restore + fixture.calls.login + fixture.calls.logout')).toBe(0);
    await page.locator('#new').click(); await page.locator('#memo-title').fill('未接続のlocal');
    await page.locator('#save').click();
    await page.waitForFunction('fixture.state().write.kind === "succeeded"');
    expect(await probe(page, 'fixture.state().data.memos[0].title')).toBe('未接続のlocal');
  } finally { await page.context().close(); }
});
it('購読失敗ではrestore/loginを開始せずraw errorを表示しない', async () => {
  const page = await pageFor('subscription-throw');
  try {
    expect(await page.getByRole('button', { name: 'ログイン', exact: true }).isDisabled()).toBe(true);
    expect(await probe(page, 'fixture.calls.restore + fixture.calls.login')).toBe(0);
    expect(await page.locator('body').textContent()).not.toContain('private-subscription-error');
  } finally { await page.context().close(); }
});
it('logout確認中のAuth世代変化でも古い確認を拒否する', async () => {
  const page = await pageFor('restore');
  try {
    await page.locator('#new').click(); await page.locator('#memo-title').fill('再認証待ち');
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await probe(page, 'fixture.expired()');
    await page.getByRole('button', { name: '確認してログアウト' }).click();
    expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    expect(await page.locator('#memo-title').inputValue()).toBe('再認証待ち');
    await page.getByText(/確認後に状態が変わりました/).waitFor();
  } finally { await page.context().close(); }
});

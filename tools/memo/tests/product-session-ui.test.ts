import { beforeAll, afterAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import type { CloudCall } from '../src/cloud-rpc-types';

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
async function draftCloud(page: Page, kind: string) {
  if (kind === 'edit') return editCloud(page);
  await selectCloud(page); await page.getByRole('button', { name: 'クラウドに新規メモ', exact: true }).click();
  await page.getByLabel('クラウドのタイトル', { exact: true }).fill('変更したクラウドタイトル');
  await page.getByLabel('クラウドの本文', { exact: true }).fill('変更したクラウド本文');
}
async function returnCloud(page: Page) {
  await selectCloud(page);
  const confirm = page.getByRole('button', { name: '確認して保存先を変更', exact: true });
  if (await confirm.isVisible()) await confirm.click();
  await page.getByLabel('クラウドのタイトル', { exact: true }).waitFor();
}
it('cloud新規はcreateIdのUUID/空draftから開始し、expectedRevision=nullで1件だけ保存する', async () => {
  const page = await pageFor('cloud-create-success'); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    const local = await probe(page, 'fixture.state()');
    const fresh = page.getByRole('button', { name: 'クラウドに新規メモ', exact: true });
    expect(await fresh.isDisabled()).toBe(true);
    await selectCloud(page); await page.getByText(/クラウド読取成功/).waitFor();
    const count = Number(await probe(page, 'fixture.generatedIds.length'));
    await fresh.click();
    expect(await page.getByLabel('クラウドのタイトル', { exact: true }).inputValue()).toBe('');
    expect(await page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('');
    expect(await probe(page, 'fixture.generatedIds.length')).toBe(count + 2);
    await fresh.dispatchEvent('click');
    expect(await probe(page, 'fixture.generatedIds.length')).toBe(count + 2);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    await page.getByLabel('クラウドのタイトル', { exact: true }).fill('  新規タイトル  ');
    await page.getByLabel('クラウドの本文', { exact: true }).fill('新規の本文');
    expect(await page.locator('#product-cloud-snapshot').isHidden()).toBe(true);
    await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
    await page.getByText(/保存要求の成功を確認/).waitFor();
    const args = await probe(page, 'fixture.savedArgs()') as CloudCall['args'];
    const ids = await probe(page, 'fixture.generatedIds.slice()') as string[];
    expect(args.p_id).toBe(ids[count]); expect(args.p_request_id).toBe(ids[count + 3]);
    expect(args.p_id).not.toBe(args.p_request_id);
    expect(args.p_expected_revision).toBeNull(); expect(args.p_tag_ids).toEqual([]);
    expect(args.p_title).toBe('新規タイトル'); expect(args.p_body).toBe('新規の本文');
    expect(await probe(page, 'fixture.state()')).toEqual(local);
    expect(await probe(page, 'fixture.stored()')).toEqual([]);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save']);
    expect(await page.locator('#product-cloud-snapshot').textContent()).toBe('');
    const output = (await page.locator('body').innerHTML()) + page.url() + JSON.stringify(logs);
    for (const secret of [...ids, 'synthetic-password', 'synthetic-token-private', 'raw-provider-token', '00000000-0000-4000-8000-000000000002']) expect(output).not.toContain(secret);
  } finally { await page.context().close(); }
});
it('cloud新規の空title/bodyを既存beginSaveで拒否し、本文だけなら既存の無題整形を使う', async () => {
  const page = await pageFor('cloud-create-success');
  try {
    await selectCloud(page); await page.getByRole('button', { name: 'クラウドに新規メモ', exact: true }).click();
    const memoId = await probe(page, 'fixture.generatedIds[0]');
    await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
    await page.getByText(/保存を開始できません/).waitFor();
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    await page.getByLabel('クラウドの本文', { exact: true }).fill('タイトルなしの本文');
    await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
    await page.getByText(/保存要求の成功を確認/).waitFor();
    expect(await probe(page, 'fixture.savedArgs().p_id')).toBe(memoId);
    expect(await probe(page, 'fixture.savedArgs().p_title')).toBe('無題');
    expect(await probe(page, 'fixture.savedArgs().p_expected_revision')).toBeNull();
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save']);
  } finally { await page.context().close(); }
});
it('cloud新規は認証/local選択で開始せず、失効ではdraft保持・入力停止、同じuserでだけ再表示する', async () => {
  const page = await pageFor('cloud-create-signed-out');
  try {
    const fresh = page.getByRole('button', { name: 'クラウドに新規メモ', exact: true });
    await fresh.dispatchEvent('click'); await selectCloud(page);
    expect(await probe(page, 'fixture.generatedIds.length')).toBe(0);
    expect(await probe(page, 'fixture.rpcNames')).toEqual([]);
    await login(page); await page.getByText('ログイン済み', { exact: true }).waitFor();
    await fresh.dispatchEvent('click'); expect(await probe(page, 'fixture.generatedIds.length')).toBe(0);
    await selectCloud(page); await fresh.click();
    await page.getByLabel('クラウドの本文', { exact: true }).fill('失効しても保持する新規本文');
    await probe(page, 'fixture.expired()');
    await page.waitForFunction('document.querySelector("#product-cloud-editor textarea").disabled');
    expect(await page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('');
    await fresh.dispatchEvent('click');
    expect(await probe(page, 'fixture.generatedIds.length')).toBe(2);
    expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    await probe(page, 'fixture.refreshAuth()'); await page.getByText(/認証が更新されました/).waitFor();
    expect(await page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('失効しても保持する新規本文');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('cloud新規のdirty編集終了/local切替は既存確認を使い、cancelでは保持する', async () => {
  const page = await pageFor('cloud-create-success');
  try {
    await draftCloud(page, 'create');
    await page.getByRole('button', { name: 'ローカルを選択', exact: true }).click();
    await page.getByRole('button', { name: '保存先変更をキャンセル', exact: true }).click();
    expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    await page.getByRole('button', { name: 'クラウド編集を閉じる', exact: true }).click();
    await page.getByRole('button', { name: 'クラウド編集を続ける', exact: true }).click();
    expect(await page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('変更したクラウド本文');
    await page.getByRole('button', { name: 'クラウド編集を閉じる', exact: true }).click();
    await page.getByRole('button', { name: '変更を破棄して編集を閉じる', exact: true }).click();
    expect(await page.locator('#product-cloud-editor').isHidden()).toBe(true);
    expect(await page.getByRole('button', { name: 'クラウドに新規メモ', exact: true }).isEnabled()).toBe(true);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('cloud新規のresolve中も離脱/二重照合を止め、元要求に対応する保存だけを確認する', async () => {
  const page = await pageFor('cloud-create-resolve-pending');
  try {
    await draftCloud(page, 'create'); await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
    await page.getByText(/保存できたか不明/).waitFor();
    await page.getByRole('button', { name: 'クラウドの保存結果を照合', exact: true }).click();
    await page.waitForFunction('fixture.rpcNames.length === 3');
    for (const name of ['クラウドの保存結果を照合', 'ローカルを選択', 'ログアウト', 'クラウドに新規メモ']) {
      await page.getByRole('button', { name, exact: true }).dispatchEvent('click');
    }
    expect(await probe(page, 'fixture.dispose()')).toBe('busy');
    expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    await probe(page, 'fixture.releaseResolve()'); await page.getByText(/保存要求の成功を確認/).waitFor();
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save', 'memo_resolve_request']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('別userで認証されても元userの新規UNKNOWN draftやpendingは操作できない', async () => {
  const page = await pageFor('cloud-create-unknown');
  try {
    await draftCloud(page, 'create'); await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
    await page.getByText(/保存できたか不明/).waitFor();
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.getByRole('button', { name: '確認してログアウト', exact: true }).click();
    await page.getByText('未ログイン', { exact: true }).waitFor();
    await probe(page, 'fixture.differentUser()'); await login(page);
    await page.getByText('ログイン済み', { exact: true }).waitFor();
    await returnCloud(page);
    expect(await page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('');
    expect(await page.getByLabel('クラウドの本文', { exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: 'クラウドの保存結果を照合', exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: 'クラウドに新規メモ', exact: true }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'クラウドの保存結果を照合', exact: true }).dispatchEvent('click');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save', 'memo_load_snapshot']);
    expect(await probe(page, 'fixture.dispose()')).toBe('pending');
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('空editorでも以前のuserに紐づくcloud選択のまま別userの新規保存を始めない', async () => {
  const page = await pageFor('cloud-create-success');
  try {
    await selectCloud(page); await page.getByText(/クラウド読取成功/).waitFor();
    await probe(page, 'fixture.externalLogout();');
    await page.getByText('未ログイン', { exact: true }).waitFor();
    await probe(page, 'fixture.differentUser()'); await login(page);
    await page.getByText('ログイン済み', { exact: true }).waitFor();
    const fresh = page.getByRole('button', { name: 'クラウドに新規メモ', exact: true });
    expect(await fresh.isDisabled()).toBe(true); await fresh.dispatchEvent('click');
    expect(await probe(page, 'fixture.generatedIds.length')).toBe(0);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['cloud-edit-pending', 'cloud-edit-pending-conflict', 'cloud-create-pending', 'cloud-create-pending-conflict'])('stale targetの%s完了結果を保持し、再選択後の明示回収で未解決を解消する', async mode => {
  const page = await pageFor(mode);
  try {
    await draftCloud(page, mode.includes('create') ? 'create' : 'edit'); await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
    await page.waitForFunction('fixture.rpcNames.length === 2');
    await probe(page, 'fixture.forceLocal(); fixture.releaseSave()');
    await page.waitForFunction('fixture.calls.saveCompleted === 1');
    expect(await page.getByText(/保存要求の成功/).count()).toBe(0);
    await returnCloud(page);
    expect(await page.getByText(/保存要求の成功/).count()).toBe(0);
    expect(await page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('変更したクラウド本文');
    expect(await page.getByRole('button', { name: 'クラウドの保存結果を照合', exact: true }).isEnabled()).toBe(true);
    const calls = await probe(page, 'fixture.rpcNames.slice()');
    await page.getByRole('button', { name: 'クラウドの保存結果を照合', exact: true }).click();
    await page.getByText(mode.endsWith('conflict') ? /競合：保存は拒否/ : /保存要求の成功を確認/).waitFor();
    expect(await probe(page, 'fixture.rpcNames')).toEqual(calls);
    expect(await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).isEnabled()).toBe(true);
    expect(await page.getByRole('button', { name: 'クラウドの保存結果を照合', exact: true }).isDisabled()).toBe(true);
    if (mode.endsWith('conflict')) expect(await page.getByText(/保存要求の成功/).count()).toBe(0);
    expect(await probe(page, 'fixture.dispose()')).toBe('applied');
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['cloud-edit-resolve-pending', 'cloud-edit-resolve-pending-deleted', 'cloud-create-resolve-pending', 'cloud-create-resolve-pending-deleted'])('stale targetの%s終端結果を保持し、閉鎖済みhandleへ再送せず回収する', async mode => {
  const page = await pageFor(mode);
  try {
    await draftCloud(page, mode.includes('create') ? 'create' : 'edit'); await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
    await page.getByText(/保存できたか不明/).waitFor();
    await page.getByRole('button', { name: 'クラウドの保存結果を照合', exact: true }).click();
    await page.waitForFunction('fixture.rpcNames.length === 3');
    await probe(page, 'fixture.forceLocal(); fixture.releaseResolve()');
    await page.waitForFunction('fixture.calls.resolveCompleted === 1');
    expect(await page.getByText(/保存要求の成功/).count()).toBe(0);
    await returnCloud(page);
    expect(await page.getByText(/保存要求の成功/).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'クラウドの保存結果を照合', exact: true }).isEnabled()).toBe(true);
    const calls = await probe(page, 'fixture.rpcNames.slice()');
    await page.getByRole('button', { name: 'クラウドの保存結果を照合', exact: true }).click();
    await page.getByText(mode.endsWith('deleted') ? /メモは削除済み/ : /保存要求の成功を確認/).waitFor();
    expect(await probe(page, 'fixture.rpcNames')).toEqual(calls);
    expect(await probe(page, 'fixture.rpcNames.filter(name => name === "memo_resolve_request").length')).toBe(1);
    if (mode.endsWith('deleted')) expect(await page.getByText(/保存要求の成功/).count()).toBe(0);
    expect(await probe(page, 'fixture.dispose()')).toBe('applied');
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
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
it.each(['edit', 'create'].flatMap(kind => ['conflict', 'rejected', 'unknown'].map(outcome => [kind, outcome] as const)))('cloud %s save %sは成功扱いせず編集を保持し、自動再送しない', async (kind, outcome) => {
  const page = await pageFor(`cloud-${kind}-${outcome}`); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    await draftCloud(page, kind); await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
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
it.each(['edit', 'create'].flatMap(kind => ['unknown', 'no-record', 'deleted'].map(outcome => [kind, outcome] as const)))('%sの結果不明後の明示resolve %sを元要求に結び付けて扱う', async (kind, outcome) => {
  const page = await pageFor(`cloud-${kind}-${outcome}`);
  try {
    await draftCloud(page, kind); await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
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
it.each(['edit', 'create'])('%s save中は二重save/保存先変更/logout/disposeを拒否し、追加編集を成功応答で消さない', async kind => {
  const page = await pageFor(`cloud-${kind}-pending`);
  try {
    await draftCloud(page, kind); await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
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
it.each(['edit', 'create'].flatMap(kind => ['expired', 'generation', 'target'].map(change => [kind, change] as const)))('%s save中の%s変更で旧成功応答を現在の保存成功にしない', async (kind, change) => {
  const page = await pageFor(`cloud-${kind}-pending`);
  try {
    await draftCloud(page, kind); await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
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
it.each(['edit', 'create'])('cloud %s dirty logoutのcancelはdraftとtargetを保持し、確認後の編集は古い確認を失効させる', async kind => {
  const page = await pageFor(`cloud-${kind}-success`);
  try {
    await draftCloud(page, kind);
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
it.each(['edit', 'create'])('%s UNKNOWNのdraftは同一user再認証後も保持し、明示resolveだけで元要求を照合する', async kind => {
  const page = await pageFor(`cloud-${kind}-unknown`);
  try {
    await draftCloud(page, kind); await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
    await page.getByText(/保存できたか不明/).waitFor();
    await probe(page, 'fixture.refreshAuth()'); await page.getByText(/認証が更新されました/).waitFor();
    expect(await page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('変更したクラウド本文');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save']);
    await page.getByRole('button', { name: 'クラウドの保存結果を照合', exact: true }).click();
    await page.getByText(/保存要求の成功を確認/).waitFor();
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save', 'memo_resolve_request']);
  } finally { await page.context().close(); }
});
it.each(['edit', 'create'])('実際にdisposeした後は取り外された%s/saveボタンから通信・UIを再開しない', async kind => {
  const page = await pageFor(`cloud-${kind}-success`);
  try {
    await draftCloud(page, kind);
    await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).evaluate(node => Object.assign(window, { oldSaveButton: node }));
    if (kind === 'create') await page.getByRole('button', { name: 'クラウドに新規メモ', exact: true }).evaluate(node => Object.assign(window, { oldNewButton: node }));
    expect(await probe(page, 'fixture.dispose()')).toBe('applied');
    await probe(page, 'window.oldSaveButton.click()');
    if (kind === 'create') await probe(page, 'window.oldNewButton.dispatchEvent(new Event("click"))');
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
    expect(await page.getByRole('button', { name: 'クラウドに新規メモ', exact: true }).count()).toBe(0);
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
    expect(await page.getByRole('button', { name: 'クラウドに新規メモ', exact: true }).count()).toBe(0);
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

async function prepareStateChange(page: Page, action: 'trash' | 'restore' | 'delete-permanently' = 'trash') {
  await selectCloud(page);
  await page.getByRole('button', { name: action === 'trash' ? 'クラウドの合成メモ' : 'ゴミ箱の合成メモ', exact: true }).click();
  const label = action === 'trash' ? 'ゴミ箱へ移動' : action === 'restore' ? '復元' : '完全削除';
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('button', { name: action === 'delete-permanently' ? '完全に削除' : `確認して${label}`, exact: true }).evaluate(node => Object.assign(window, { oldStateChange: node }));
}
async function sendStateChange(page: Page, action: 'trash' | 'restore' | 'delete-permanently' = 'trash') {
  await prepareStateChange(page, action);
  await page.getByRole('button', { name: action === 'trash' ? '確認してゴミ箱へ移動' : action === 'restore' ? '確認して復元' : '完全に削除', exact: true }).click();
}
async function prepareEmptyTrash(page: Page) {
  await selectCloud(page); await page.getByRole('button', { name: 'ゴミ箱を空にする', exact: true }).click();
  await page.getByRole('button', { name: 'すべて完全に削除', exact: true }).evaluate(node => Object.assign(window, { oldEmpty: node }));
}
async function prepareCloudTag(page: Page, kind: 'create' | 'rename') {
  await selectCloud(page);
  if (kind === 'create') await page.getByRole('button', { name: 'タグを作成', exact: true }).click();
  else await page.getByRole('list', { name: 'クラウドタグ一覧', exact: true }).getByRole('button', { name: '名前を変更', exact: true }).click();
  await page.getByRole('button', { name: kind === 'create' ? '作成' : '変更', exact: true }).evaluate(node => Object.assign(window, { oldTagSubmit: node }));
}
async function prepareDeleteCloudTag(page: Page) {
  await selectCloud(page);
  const tags = page.getByRole('list', { name: 'クラウドタグ一覧', exact: true });
  await tags.getByRole('button', { name: '名前を変更', exact: true }).evaluate(node => Object.assign(window, { oldRename: node }));
  await tags.getByRole('button', { name: '削除', exact: true }).click();
  await page.getByRole('button', { name: '削除する', exact: true }).evaluate(node => Object.assign(window, { oldDeleteTag: node }));
}
it('cloudタグ単件削除は対象名を一度確認し、cancel無送信・正式2引数だけで成功する', async () => {
  const page = await pageFor('cloud-tag-delete-success'); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    const local = await probe(page, 'fixture.state()');
    expect(await page.getByRole('list', { name: 'クラウドタグ一覧', exact: true }).count()).toBe(0);
    await prepareDeleteCloudTag(page);
    await page.getByText('タグ『既存クラウドタグ』を削除します。', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'タグ削除をキャンセル', exact: true }).click();
    await probe(page, 'window.oldDeleteTag.click()');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    await page.getByRole('list', { name: 'クラウドタグ一覧', exact: true }).getByRole('button', { name: '削除', exact: true }).click();
    await page.getByRole('button', { name: '削除する', exact: true }).click();
    await page.getByText(/タグ削除要求の成功を確認/).waitFor();
    expect(await probe(page, 'fixture.stateArgs()')).toEqual({ p_id: '00000000-0000-4000-8000-000000000103', p_expected_revision: 1 });
    expect(await probe(page, 'fixture.generatedIds.length')).toBe(0);
    expect(await page.locator('#product-cloud-snapshot').textContent()).toBe('');
    expect(await page.locator('#product-cloud-trash-state').textContent()).toContain('明示再読取が必要');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_delete_tag']);
    expect(await probe(page, 'fixture.state()')).toEqual(local); expect(await probe(page, 'fixture.stored()')).toEqual([]);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    const output = (await page.locator('body').innerHTML()) + page.url() + JSON.stringify(logs);
    for (const secret of ['00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000002',
      'synthetic-password', 'synthetic-token-private', 'raw-provider-token']) expect(output).not.toContain(secret);
  } finally { await page.context().close(); }
});
it.each(['conflict', 'rejected', 'unknown', 'unverified', 'invalid'])('cloudタグ削除%sを成功/未削除にせず、未知操作を保持して再送しない', async outcome => {
  const page = await pageFor(`cloud-tag-delete-${outcome}`); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    await prepareDeleteCloudTag(page); await page.getByRole('button', { name: '削除する', exact: true }).click();
    await page.waitForFunction('fixture.calls.stateCompleted === 1');
    const status = await page.locator('#product-cloud-trash-state').textContent();
    expect(status).not.toContain('要求の成功'); expect(status).not.toContain('削除されていません');
    if (outcome === 'conflict') expect(status).toContain('競合');
    else if (outcome === 'rejected') expect(status).toContain('拒否');
    else {
      expect(status).toContain('UNKNOWN'); expect(await probe(page, 'fixture.dispose()')).toBe('pending');
      expect(await probe(page, 'fixture.stateResult().operation.id')).toBe('00000000-0000-4000-8000-000000000103');
      expect(await probe(page, 'fixture.stateResult().operation.expectedRevision')).toBe(1);
      await probe(page, 'window.oldRename.click()');
      expect(await page.getByLabel('クラウドのタグ名', { exact: true }).count()).toBe(0);
      const fresh = page.getByRole('button', { name: 'クラウドに新規メモ', exact: true });
      expect(await fresh.isDisabled()).toBe(true); await fresh.dispatchEvent('click');
      await page.getByRole('button', { name: 'ローカルを選択', exact: true }).click();
      await page.getByRole('button', { name: '保存先変更をキャンセル', exact: true }).click();
      expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    }
    await probe(page, 'window.oldDeleteTag.click()');
    expect(await probe(page, 'fixture.generatedIds.length')).toBe(0);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_delete_tag']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    const output = (await page.locator('body').innerHTML()) + page.url() + JSON.stringify(logs);
    for (const secret of ['synthetic-password', 'raw-provider-token', 'synthetic-token-private']) expect(output).not.toContain(secret);
  } finally { await page.context().close(); }
});
it('cloudタグ削除送信中は二重送信/他write/切替/logout/disposeを抑止する', async () => {
  const page = await pageFor('cloud-tag-delete-pending');
  try {
    await prepareDeleteCloudTag(page); await page.getByRole('button', { name: '削除する', exact: true }).click();
    await page.waitForFunction('fixture.rpcNames.length === 2');
    await probe(page, 'window.oldDeleteTag.click(); window.oldRename.click()');
    await page.getByRole('button', { name: 'クラウドに新規メモ', exact: true }).dispatchEvent('click');
    await page.getByRole('button', { name: 'ローカルを選択', exact: true }).dispatchEvent('click');
    await page.getByRole('button', { name: 'ログアウト', exact: true }).dispatchEvent('click');
    expect(await probe(page, 'fixture.dispose()')).toBe('busy'); expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    await probe(page, 'fixture.releaseState()'); await page.getByText(/タグ削除要求の成功を確認/).waitFor();
    expect(await probe(page, 'fixture.dispose()')).toBe('applied'); await probe(page, 'window.oldDeleteTag.click()');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_delete_tag']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['expired', 'generation', 'target', 'snapshot'])('cloudタグ削除送信後%s変更の旧応答を現在成功にしない', async change => {
  const page = await pageFor('cloud-tag-delete-pending');
  try {
    await prepareDeleteCloudTag(page); await page.getByRole('button', { name: '削除する', exact: true }).click();
    await page.waitForFunction('fixture.rpcNames.length === 2');
    await probe(page, change === 'expired' ? 'fixture.expired()' : change === 'generation' ? 'fixture.refreshAuth()' : change === 'target' ? 'fixture.forceLocal()' : 'fixture.invalidateSnapshot()');
    await probe(page, 'fixture.releaseState()'); await page.waitForFunction('fixture.calls.stateCompleted === 1');
    expect(await page.locator('#product-cloud-trash-state').textContent()).not.toContain('要求の成功');
    expect(await page.locator('#product-cloud-snapshot').textContent()).toBe('');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_delete_tag']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['generation', 'user', 'target', 'snapshot', 'name', 'revision'])('cloudタグ削除確認後%s変更では元タグを新状態へ差替え送信しない', async change => {
  const page = await pageFor('cloud-tag-delete-success');
  try {
    await prepareDeleteCloudTag(page);
    if (change === 'user') { await probe(page, 'fixture.externalLogout()'); await probe(page, 'fixture.differentUser()'); await login(page); }
    else if (change === 'name' || change === 'revision') {
      await probe(page, `fixture.changeTag('${change}')`);
      await page.getByRole('button', { name: 'ローカルを選択', exact: true }).click(); await selectCloud(page);
      await page.waitForFunction('fixture.calls.readCompleted === 2');
    } else await probe(page, change === 'generation' ? 'fixture.refreshAuth()' : change === 'target' ? 'fixture.forceLocal()' : 'fixture.invalidateSnapshot()');
    await probe(page, 'window.oldDeleteTag.click()');
    expect(await probe(page, 'fixture.generatedIds.length')).toBe(0);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(change === 'name' || change === 'revision' ? ['memo_load_snapshot', 'memo_load_snapshot'] : ['memo_load_snapshot']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['create', 'rename'] as const)('cloudタグ%sは正式3引数だけを送り、要求成功後にsnapshotを失効する', async kind => {
  const page = await pageFor('cloud-tag-success'); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    const local = await probe(page, 'fixture.state()');
    expect(await page.getByRole('button', { name: 'タグを作成', exact: true }).count()).toBe(0);
    await prepareCloudTag(page, kind);
    if (kind === 'rename') {
      expect(await page.getByLabel('クラウドのタグ名', { exact: true }).inputValue()).toBe('既存クラウドタグ');
      await page.getByText('現在のタグ名：既存クラウドタグ', { exact: true }).waitFor();
    }
    const count = Number(await probe(page, 'fixture.generatedIds.length'));
    await page.getByLabel('クラウドのタグ名', { exact: true }).fill('　 新しいタグ😀  ');
    await page.getByRole('button', { name: kind === 'create' ? '作成' : '変更', exact: true }).click();
    await page.getByText(/タグ(作成|改名)要求の成功を確認/).waitFor();
    const ids = await probe(page, 'fixture.generatedIds.slice()') as string[];
    expect(await probe(page, 'fixture.stateArgs()')).toEqual({ p_id: kind === 'create' ? ids[count] : '00000000-0000-4000-8000-000000000103',
      p_name: '新しいタグ😀', p_expected_revision: kind === 'create' ? null : 1 });
    expect(ids.length).toBe(count + (kind === 'create' ? 1 : 0));
    expect(await probe(page, 'fixture.stateResult().result.value.revision')).toBe(kind === 'create' ? 1 : 2);
    expect(await page.locator('#product-cloud-snapshot').textContent()).toBe('');
    await probe(page, 'window.oldTagSubmit.click()');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save_tag']);
    expect(await probe(page, 'fixture.state()')).toEqual(local); expect(await probe(page, 'fixture.stored()')).toEqual([]);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    const output = (await page.locator('body').innerHTML()) + page.url() + JSON.stringify(logs);
    for (const secret of [...ids, '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000002',
      'synthetic-password', 'synthetic-token-private', 'raw-provider-token']) expect(output).not.toContain(secret);
  } finally { await page.context().close(); }
});
it.each(['create', 'rename'] as const)('cloudタグ%sは既存validatorで空白/31文字を拒否しcancelは無送信、30コードポイントは保存可能', async kind => {
  const page = await pageFor('cloud-tag-success');
  try {
    await prepareCloudTag(page, kind); const count = await probe(page, 'fixture.generatedIds.length');
    for (const name of ['', '　 ', '😀'.repeat(31)]) {
      await page.getByLabel('クラウドのタグ名', { exact: true }).fill(name);
      await page.getByRole('button', { name: kind === 'create' ? '作成' : '変更', exact: true }).click();
      await page.getByText(/タグ名を確認してください/).waitFor();
      expect(await probe(page, 'fixture.generatedIds.length')).toBe(count);
      expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    }
    await page.getByRole('button', { name: 'タグ編集をキャンセル', exact: true }).click();
    await probe(page, 'window.oldTagSubmit.click()');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    if (kind === 'create') await page.getByRole('button', { name: 'タグを作成', exact: true }).click();
    else await page.getByRole('list', { name: 'クラウドタグ一覧', exact: true }).getByRole('button', { name: '名前を変更', exact: true }).click();
    await page.getByLabel('クラウドのタグ名', { exact: true }).fill('😀'.repeat(30));
    await page.getByRole('button', { name: kind === 'create' ? '作成' : '変更', exact: true }).click();
    await page.getByText(/タグ(作成|改名)要求の成功を確認/).waitFor();
    expect(await probe(page, 'fixture.stateArgs().p_name')).toBe('😀'.repeat(30));
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['duplicate', 'conflict', 'rejected', 'unknown', 'unverified', 'invalid-id', 'invalid-name', 'invalid-revision'])('cloudタグ%sを成功/未保存へ昇格せず再送しない', async outcome => {
  const page = await pageFor(`cloud-tag-${outcome}`); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    const kind = outcome === 'conflict' || outcome === 'invalid-revision' ? 'rename' : 'create';
    await prepareCloudTag(page, kind); const count = Number(await probe(page, 'fixture.generatedIds.length'));
    await page.getByLabel('クラウドのタグ名', { exact: true }).fill('変更後タグ');
    await page.getByRole('button', { name: kind === 'create' ? '作成' : '変更', exact: true }).click();
    await page.waitForFunction('fixture.calls.stateCompleted === 1');
    const status = await page.locator('#product-cloud-trash-state').textContent();
    expect(status).not.toContain('要求の成功'); expect(status).not.toContain('保存されていません');
    if (outcome === 'conflict') expect(status).toContain('競合');
    else if (outcome === 'duplicate' || outcome === 'rejected') expect(status).toContain('拒否');
    else {
      expect(status).toContain('UNKNOWN'); expect(await probe(page, 'fixture.dispose()')).toBe('pending');
      expect(await probe(page, 'fixture.stateResult().operation.name')).toBe('変更後タグ');
      const fresh = page.getByRole('button', { name: 'クラウドに新規メモ', exact: true });
      expect(await fresh.isDisabled()).toBe(true); await fresh.dispatchEvent('click');
      await page.getByRole('button', { name: 'ローカルを選択', exact: true }).click();
      await page.getByRole('button', { name: '保存先変更をキャンセル', exact: true }).click();
      expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    }
    await probe(page, 'window.oldTagSubmit.click()');
    expect(await probe(page, 'fixture.generatedIds.length')).toBe(count + (kind === 'create' ? 1 : 0));
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save_tag']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    const output = (await page.locator('body').innerHTML()) + page.url() + JSON.stringify(logs);
    for (const secret of ['synthetic-password', 'raw-provider-token', 'synthetic-token-private']) expect(output).not.toContain(secret);
  } finally { await page.context().close(); }
});
it.each(['create', 'rename'] as const)('cloudタグ%s送信中は二重送信/他write/切替/logout/disposeを抑止する', async kind => {
  const page = await pageFor('cloud-tag-pending');
  try {
    await prepareCloudTag(page, kind); await page.getByLabel('クラウドのタグ名', { exact: true }).fill('変更タグ');
    await page.getByRole('button', { name: kind === 'create' ? '作成' : '変更', exact: true }).click();
    await page.waitForFunction('fixture.rpcNames.length === 2');
    await probe(page, 'window.oldTagSubmit.click()');
    await page.getByRole('button', { name: 'クラウドに新規メモ', exact: true }).dispatchEvent('click');
    await page.getByRole('button', { name: 'ローカルを選択', exact: true }).dispatchEvent('click');
    await page.getByRole('button', { name: 'ログアウト', exact: true }).dispatchEvent('click');
    expect(await probe(page, 'fixture.dispose()')).toBe('busy'); expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    await probe(page, 'fixture.releaseState()'); await page.getByText(/タグ(作成|改名)要求の成功を確認/).waitFor();
    expect(await probe(page, 'fixture.dispose()')).toBe('applied'); await probe(page, 'window.oldTagSubmit.click()');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save_tag']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['expired', 'generation', 'target', 'snapshot'])('cloudタグ送信後%s変更の旧応答を現在成功にしない', async change => {
  const page = await pageFor('cloud-tag-pending');
  try {
    await prepareCloudTag(page, change === 'expired' || change === 'target' ? 'create' : 'rename');
    await page.getByLabel('クラウドのタグ名', { exact: true }).fill('変更タグ'); await probe(page, 'window.oldTagSubmit.click()');
    await page.waitForFunction('fixture.rpcNames.length === 2');
    await probe(page, change === 'expired' ? 'fixture.expired()' : change === 'generation' ? 'fixture.refreshAuth()' : change === 'target' ? 'fixture.forceLocal()' : 'fixture.invalidateSnapshot()');
    await probe(page, 'fixture.releaseState()'); await page.waitForFunction('fixture.calls.stateCompleted === 1');
    expect(await page.locator('#product-cloud-trash-state').textContent()).not.toContain('要求の成功');
    expect(await page.locator('#product-cloud-snapshot').textContent()).toBe('');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save_tag']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('同IDのタグが再読取で改名/revision更新されても、旧フォームを新タグへ付け替えない', async () => {
  const page = await pageFor('cloud-tag-success');
  try {
    await prepareCloudTag(page, 'rename'); await page.getByLabel('クラウドのタグ名', { exact: true }).fill('旧フォームの入力');
    await probe(page, 'fixture.changeTag()');
    await page.getByRole('button', { name: 'ローカルを選択', exact: true }).click(); await selectCloud(page);
    await page.getByRole('list', { name: 'クラウドタグ一覧', exact: true }).getByText('changed tag', { exact: true }).waitFor();
    await probe(page, 'window.oldTagSubmit.click()');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_load_snapshot']);
    await page.getByRole('list', { name: 'クラウドタグ一覧', exact: true }).getByRole('button', { name: '名前を変更', exact: true }).click();
    expect(await page.getByLabel('クラウドのタグ名', { exact: true }).inputValue()).toBe('changed tag');
    await page.getByLabel('クラウドのタグ名', { exact: true }).fill('明示した新しい変更');
    await page.getByRole('button', { name: '変更', exact: true }).click(); await page.getByText(/タグ改名要求の成功を確認/).waitFor();
    expect(await probe(page, 'fixture.stateArgs()')).toEqual({ p_id: '00000000-0000-4000-8000-000000000103', p_name: '明示した新しい変更', p_expected_revision: 2 });
    expect(await probe(page, 'fixture.generatedIds.length')).toBe(0);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['generation', 'user', 'snapshot'])('改名入力後%s変更では旧タグ/revisionへ送信できない', async change => {
  const page = await pageFor('cloud-tag-success');
  try {
    await prepareCloudTag(page, 'rename'); await page.getByLabel('クラウドのタグ名', { exact: true }).fill('変更タグ');
    if (change === 'user') { await probe(page, 'fixture.externalLogout()'); await probe(page, 'fixture.differentUser()'); await login(page); }
    else if (change === 'generation') await probe(page, 'fixture.refreshAuth()');
    else await probe(page, 'fixture.invalidateSnapshot()');
    await probe(page, 'window.oldTagSubmit.click()');
    expect(await probe(page, 'fixture.generatedIds.length')).toBe(0);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('一括完全削除はゴミ箱2件の集合だけを確認・固定し、正式2引数で一度だけ送信する', async () => {
  const page = await pageFor('cloud-empty-success'); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    const local = await probe(page, 'fixture.state()'); await prepareEmptyTrash(page);
    await page.getByText('ゴミ箱内のメモ2件を完全に削除します。元に戻せません。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '一括削除をキャンセル', exact: true }).click();
    await probe(page, 'window.oldEmpty.click()');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    await page.getByRole('button', { name: 'ゴミ箱を空にする', exact: true }).click();
    const count = Number(await probe(page, 'fixture.generatedIds.length'));
    await page.getByRole('button', { name: 'すべて完全に削除', exact: true }).click();
    await page.getByText(/一括完全削除要求の成功を確認/).waitFor();
    expect(await page.locator('#product-cloud-trash-state').textContent()).toContain('削除件数2件');
    expect(await probe(page, 'fixture.stateArgs()')).toEqual({ p_ids: ['00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000104'], p_revisions: [1, 3] });
    const ids = await probe(page, 'fixture.generatedIds.slice()') as string[]; expect(ids.length).toBe(count + 1);
    expect(await page.locator('#product-cloud-snapshot').textContent()).toBe('');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_empty_trash']);
    expect(await probe(page, 'fixture.state()')).toEqual(local); expect(await probe(page, 'fixture.stored()')).toEqual([]);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    const output = (await page.locator('body').innerHTML()) + page.url() + JSON.stringify(logs);
    for (const secret of [...ids, '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000104',
      '00000000-0000-4000-8000-000000000002', 'synthetic-email@example.invalid', 'synthetic-password', 'synthetic-token-private']) expect(output).not.toContain(secret);
  } finally { await page.context().close(); }
});
it('ゴミ箱0件では一括削除入口もRPCも生成しない', async () => {
  const page = await pageFor('cloud-empty-zero');
  try {
    await selectCloud(page); await page.getByText('ゴミ箱は空です。', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'ゴミ箱を空にする', exact: true }).count()).toBe(0);
    expect(await probe(page, 'fixture.generatedIds.length')).toBe(0);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['conflict', 'revision', 'rejected', 'unknown', 'count', 'unverified', 'invalid'])('一括削除%sは成功/未削除にせず、元集合と不明操作を保持して再送しない', async outcome => {
  const page = await pageFor(`cloud-empty-${outcome}`); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    await prepareEmptyTrash(page); const count = Number(await probe(page, 'fixture.generatedIds.length'));
    await page.getByRole('button', { name: 'すべて完全に削除', exact: true }).click();
    await page.waitForFunction('fixture.calls.stateCompleted === 1');
    const status = await page.locator('#product-cloud-trash-state').textContent();
    expect(status).not.toContain('要求の成功'); expect(status).not.toContain('未削除');
    if (outcome === 'conflict' || outcome === 'revision') expect(status).toContain('競合');
    else if (outcome === 'rejected') expect(status).toContain('拒否');
    else {
      expect(status).toContain('UNKNOWN'); expect(await probe(page, 'fixture.dispose()')).toBe('pending');
      expect(await probe(page, 'fixture.stateResult().operation.targets')).toEqual([
        { id: '00000000-0000-4000-8000-000000000102', revision: 1 }, { id: '00000000-0000-4000-8000-000000000104', revision: 3 }]);
      expect(await probe(page, 'fixture.stateResult().operation.requestId')).toBe(await probe(page, `fixture.generatedIds[${count}]`));
      const fresh = page.getByRole('button', { name: 'クラウドに新規メモ', exact: true });
      expect(await fresh.isDisabled()).toBe(true); await fresh.dispatchEvent('click');
      await page.getByRole('button', { name: 'ローカルを選択', exact: true }).click();
      await page.getByRole('button', { name: '保存先変更をキャンセル', exact: true }).click();
      expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    }
    await probe(page, 'window.oldEmpty.click()');
    expect(await probe(page, 'fixture.generatedIds.length')).toBe(count + 1);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_empty_trash']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    const output = (await page.locator('body').innerHTML()) + page.url() + JSON.stringify(logs);
    for (const secret of ['synthetic-password', 'raw-provider-token', 'synthetic-token-private']) expect(output).not.toContain(secret);
  } finally { await page.context().close(); }
});
it('一括削除中の二重送信/他write/切替/logout/disposeを抑止し、元対象を差し替えない', async () => {
  const page = await pageFor('cloud-empty-pending');
  try {
    await prepareEmptyTrash(page); await page.getByRole('button', { name: 'すべて完全に削除', exact: true }).click();
    await page.waitForFunction('fixture.rpcNames.length === 2'); const args = await probe(page, 'fixture.stateArgs()');
    await probe(page, 'fixture.changeTrashSet(); window.oldEmpty.click()');
    await page.getByRole('button', { name: 'クラウドに新規メモ', exact: true }).dispatchEvent('click');
    await page.getByRole('button', { name: 'ローカルを選択', exact: true }).dispatchEvent('click');
    await page.getByRole('button', { name: 'ログアウト', exact: true }).dispatchEvent('click');
    expect(await probe(page, 'fixture.dispose()')).toBe('busy'); expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    await probe(page, 'fixture.releaseState()'); await page.getByText(/一括完全削除要求の成功を確認/).waitFor();
    expect(await probe(page, 'fixture.stateArgs()')).toEqual(args);
    expect(await probe(page, 'fixture.dispose()')).toBe('applied'); await probe(page, 'window.oldEmpty.click()');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_empty_trash']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['expired', 'generation', 'target', 'snapshot'])('一括削除送信後%s変更では旧応答を現在成功へ反映しない', async change => {
  const page = await pageFor('cloud-empty-pending');
  try {
    await prepareEmptyTrash(page); await page.getByRole('button', { name: 'すべて完全に削除', exact: true }).click();
    await page.waitForFunction('fixture.rpcNames.length === 2');
    await probe(page, change === 'expired' ? 'fixture.expired()' : change === 'generation' ? 'fixture.refreshAuth()' : change === 'target' ? 'fixture.forceLocal()' : 'fixture.invalidateSnapshot()');
    await probe(page, 'fixture.releaseState()'); await page.waitForFunction('fixture.calls.stateCompleted === 1');
    expect(await page.locator('#product-cloud-trash-state').textContent()).not.toContain('要求の成功');
    expect(await page.locator('#product-cloud-snapshot').textContent()).toBe('');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_empty_trash']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['generation', 'user', 'targets'])('一括削除確認後%s変更では旧集合の確認を実行できない', async change => {
  const page = await pageFor('cloud-empty-success');
  try {
    await prepareEmptyTrash(page); const count = await probe(page, 'fixture.generatedIds.length');
    if (change === 'user') { await probe(page, 'fixture.externalLogout()'); await probe(page, 'fixture.differentUser()'); await login(page); }
    else if (change === 'generation') await probe(page, 'fixture.refreshAuth()');
    else {
      await probe(page, 'fixture.changeTrashSet()');
      await page.getByRole('button', { name: 'ローカルを選択', exact: true }).click();
      await selectCloud(page); await page.getByText('ゴミ箱は空です。', { exact: true }).waitFor();
    }
    await probe(page, 'window.oldEmpty.click()');
    expect(await probe(page, 'fixture.generatedIds.length')).toBe(count);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(change === 'targets' ? ['memo_load_snapshot', 'memo_load_snapshot'] : ['memo_load_snapshot']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('完全削除はゴミ箱だけで明示確認し、正式な2引数で一度だけ送信する', async () => {
  const page = await pageFor('cloud-delete-success'); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    const local = await probe(page, 'fixture.state()');
    await selectCloud(page); await page.getByRole('button', { name: 'クラウドの合成メモ', exact: true }).click();
    expect(await page.getByRole('button', { name: '完全削除', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'クラウド一覧へ戻る', exact: true }).click();
    await page.getByRole('button', { name: 'ゴミ箱の合成メモ', exact: true }).click();
    expect(await page.getByRole('button', { name: '復元', exact: true }).count()).toBe(1);
    await page.getByRole('button', { name: '完全削除', exact: true }).click();
    await page.getByText('このメモを完全に削除します。元に戻せません。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '完全に削除', exact: true }).evaluate(node => Object.assign(window, { cancelledDelete: node }));
    await page.getByRole('button', { name: '完全削除をキャンセル', exact: true }).click();
    await probe(page, 'window.cancelledDelete.click()');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    await page.getByRole('button', { name: '完全削除', exact: true }).click();
    const count = Number(await probe(page, 'fixture.generatedIds.length'));
    await page.getByRole('button', { name: '完全に削除', exact: true }).click();
    await page.getByText(/完全削除要求の成功を確認/).waitFor();
    expect(await probe(page, 'fixture.stateArgs()')).toEqual({ p_id: '00000000-0000-4000-8000-000000000102', p_expected_revision: 1 });
    const ids = await probe(page, 'fixture.generatedIds.slice()') as string[];
    expect(ids.length).toBe(count + 1); // 既存C04の内部識別用。RPC引数へは送らない。
    expect(await page.locator('#product-cloud-snapshot').textContent()).toBe('');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_delete_permanently']);
    expect(await probe(page, 'fixture.state()')).toEqual(local); expect(await probe(page, 'fixture.stored()')).toEqual([]);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    const output = (await page.locator('body').innerHTML()) + page.url() + JSON.stringify(logs);
    for (const secret of [...ids, '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000002',
      'synthetic-email@example.invalid', 'synthetic-password', 'synthetic-token-private']) expect(output).not.toContain(secret);
  } finally { await page.context().close(); }
});
it.each(['conflict', 'rejected', 'unknown', 'not-found', 'unverified', 'invalid'])('完全削除%sを成功/未削除の証明にせず、再送しない', async outcome => {
  const page = await pageFor(`cloud-delete-${outcome}`); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    await sendStateChange(page, 'delete-permanently'); await page.waitForFunction('fixture.calls.stateCompleted === 1');
    const status = await page.locator('#product-cloud-trash-state').textContent();
    expect(status).not.toContain('要求の成功'); expect(status).not.toContain('未削除');
    if (outcome === 'conflict') expect(status).toContain('競合');
    else if (outcome === 'rejected') expect(status).toContain('拒否');
    else {
      expect(status).toContain('完全削除できたか不明');
      expect(await probe(page, 'fixture.dispose()')).toBe('pending');
      const fresh = page.getByRole('button', { name: 'クラウドに新規メモ', exact: true });
      expect(await fresh.isDisabled()).toBe(true); await fresh.dispatchEvent('click');
      await page.getByRole('button', { name: 'ローカルを選択', exact: true }).click();
      await page.getByRole('button', { name: '保存先変更をキャンセル', exact: true }).click();
      expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    }
    await probe(page, 'window.oldStateChange.click()');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_delete_permanently']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    const output = (await page.locator('body').innerHTML()) + page.url() + JSON.stringify(logs);
    for (const secret of ['synthetic-password', 'raw-provider-token', 'synthetic-token-private']) expect(output).not.toContain(secret);
  } finally { await page.context().close(); }
});
it('完全削除中は二重送信・他write・切替/logout/disposeを既存busyで抑止する', async () => {
  const page = await pageFor('cloud-delete-pending');
  try {
    await sendStateChange(page, 'delete-permanently'); await page.waitForFunction('fixture.rpcNames.length === 2');
    await probe(page, 'window.oldStateChange.click()');
    await page.getByRole('button', { name: 'クラウドに新規メモ', exact: true }).dispatchEvent('click');
    await page.getByRole('button', { name: 'ローカルを選択', exact: true }).dispatchEvent('click');
    await page.getByRole('button', { name: 'ログアウト', exact: true }).dispatchEvent('click');
    expect(await probe(page, 'fixture.dispose()')).toBe('busy');
    expect(await probe(page, 'fixture.target().target')).toBe('cloud'); expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    await probe(page, 'fixture.releaseState()'); await page.getByText(/完全削除要求の成功を確認/).waitFor();
    expect(await probe(page, 'fixture.dispose()')).toBe('applied'); await probe(page, 'window.oldStateChange.click()');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_delete_permanently']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['expired', 'generation', 'target', 'snapshot'])('完全削除送信後%s変更では旧応答を現在成功にしない', async change => {
  const page = await pageFor('cloud-delete-pending');
  try {
    await sendStateChange(page, 'delete-permanently'); await page.waitForFunction('fixture.rpcNames.length === 2');
    await probe(page, change === 'expired' ? 'fixture.expired()' : change === 'generation' ? 'fixture.refreshAuth()' : change === 'target' ? 'fixture.forceLocal()' : 'fixture.invalidateSnapshot()');
    await probe(page, 'fixture.releaseState()'); await page.waitForFunction('fixture.calls.stateCompleted === 1');
    expect(await page.locator('#product-cloud-trash-state').textContent()).not.toContain('要求の成功');
    expect(await page.locator('#product-cloud-snapshot').textContent()).toBe('');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_delete_permanently']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['generation', 'user', 'dispose'])('完全削除確認後%s変更では旧確認ボタンを使えない', async change => {
  const page = await pageFor('cloud-delete-success');
  try {
    await prepareStateChange(page, 'delete-permanently'); const count = await probe(page, 'fixture.generatedIds.length');
    if (change === 'user') { await probe(page, 'fixture.externalLogout()'); await probe(page, 'fixture.differentUser()'); await login(page); }
    else await probe(page, change === 'generation' ? 'fixture.refreshAuth()' : 'fixture.dispose()');
    await probe(page, 'window.oldStateChange.click()');
    expect(await probe(page, 'fixture.generatedIds.length')).toBe(count);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('restoreはゴミ箱詳細だけに表示し、cancel後は無送信、確認後は正式要求を1回だけ送る', async () => {
  const page = await pageFor('cloud-restore-success'); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    const local = await probe(page, 'fixture.state()');
    await selectCloud(page);
    await page.getByRole('button', { name: 'クラウドの合成メモ', exact: true }).click();
    expect(await page.getByRole('button', { name: '復元', exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'ゴミ箱へ移動', exact: true }).count()).toBe(1);
    await page.getByRole('button', { name: 'クラウド一覧へ戻る', exact: true }).click();
    await page.getByRole('button', { name: 'ゴミ箱の合成メモ', exact: true }).click();
    expect(await page.getByRole('button', { name: 'ゴミ箱へ移動', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: '復元', exact: true }).click();
    await page.getByRole('button', { name: '確認して復元', exact: true }).evaluate(node => Object.assign(window, { cancelledRestore: node }));
    await page.getByRole('button', { name: '復元をキャンセル', exact: true }).click();
    await probe(page, 'window.cancelledRestore.click()');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    await page.getByRole('button', { name: '復元', exact: true }).click();
    const count = Number(await probe(page, 'fixture.generatedIds.length'));
    await page.getByRole('button', { name: '確認して復元', exact: true }).click();
    await page.getByText(/復元要求の成功を確認/).waitFor();
    const ids = await probe(page, 'fixture.generatedIds.slice()') as string[];
    expect(await probe(page, 'fixture.stateArgs()')).toEqual({ p_id: '00000000-0000-4000-8000-000000000102',
      p_expected_revision: 1, p_request_id: ids[count], p_action: 'restore' });
    expect(ids.length).toBe(count + 1);
    expect(await page.locator('#product-cloud-snapshot').textContent()).toBe('');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_change_state']);
    expect(await probe(page, 'fixture.state()')).toEqual(local); expect(await probe(page, 'fixture.stored()')).toEqual([]);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    const output = (await page.locator('body').innerHTML()) + page.url() + JSON.stringify(logs);
    for (const secret of [...ids, '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000002',
      'synthetic-email@example.invalid', 'synthetic-password', 'synthetic-token-private']) expect(output).not.toContain(secret);
  } finally { await page.context().close(); }
});
it.each(['conflict', 'rejected', 'unknown'])('restore %sで成功表示/自動再送/local fallbackをせず、UNKNOWNは新writeを停止する', async outcome => {
  const page = await pageFor(`cloud-restore-${outcome}`); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    await sendStateChange(page, 'restore'); await page.waitForFunction('fixture.calls.stateCompleted === 1');
    const status = await page.locator('#product-cloud-trash-state').textContent();
    expect(status).not.toContain('要求の成功');
    expect(status).toContain(outcome === 'conflict' ? '競合' : outcome === 'rejected' ? '拒否' : 'UNKNOWN');
    await probe(page, 'window.oldStateChange.click()');
    if (outcome === 'unknown') {
      expect(await probe(page, 'fixture.dispose()')).toBe('pending');
      const fresh = page.getByRole('button', { name: 'クラウドに新規メモ', exact: true });
      expect(await fresh.isDisabled()).toBe(true); await fresh.dispatchEvent('click');
      await page.getByRole('button', { name: 'ローカルを選択', exact: true }).click();
      await page.getByRole('button', { name: '保存先変更をキャンセル', exact: true }).click();
      expect(await probe(page, 'fixture.target().target')).toBe('cloud');
    }
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_change_state']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    const output = (await page.locator('body').innerHTML()) + page.url() + JSON.stringify(logs);
    for (const secret of ['synthetic-password', 'raw-provider-token', 'synthetic-token-private']) expect(output).not.toContain(secret);
  } finally { await page.context().close(); }
});
it('restore処理中の旧ボタン/切替/logout/disposeを共有busyで抑止する', async () => {
  const page = await pageFor('cloud-restore-pending');
  try {
    await sendStateChange(page, 'restore'); await page.waitForFunction('fixture.rpcNames.length === 2');
    await probe(page, 'window.oldStateChange.click()');
    await page.getByRole('button', { name: 'ローカルを選択', exact: true }).dispatchEvent('click');
    await page.getByRole('button', { name: 'ログアウト', exact: true }).dispatchEvent('click');
    expect(await probe(page, 'fixture.dispose()')).toBe('busy');
    expect(await probe(page, 'fixture.target().target')).toBe('cloud'); expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    await probe(page, 'fixture.releaseState()'); await page.getByText(/復元要求の成功を確認/).waitFor();
    expect(await probe(page, 'fixture.dispose()')).toBe('applied'); await probe(page, 'window.oldStateChange.click()');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_change_state']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['expired', 'generation', 'target', 'snapshot'])('restore送信後%sで旧応答を復元成功にしない', async change => {
  const page = await pageFor('cloud-restore-pending');
  try {
    await sendStateChange(page, 'restore'); await page.waitForFunction('fixture.rpcNames.length === 2');
    await probe(page, change === 'expired' ? 'fixture.expired()' : change === 'generation' ? 'fixture.refreshAuth()' : change === 'target' ? 'fixture.forceLocal()' : 'fixture.invalidateSnapshot()');
    await probe(page, 'fixture.releaseState()'); await page.waitForFunction('fixture.calls.stateCompleted === 1');
    expect(await page.locator('#product-cloud-trash-state').textContent()).not.toContain('要求の成功');
    expect(await page.locator('#product-cloud-snapshot').textContent()).toBe('');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_change_state']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it('restore確認後の別user再認証では旧メモへ操作できない', async () => {
  const page = await pageFor('cloud-restore-success');
  try {
    await prepareStateChange(page, 'restore'); const count = await probe(page, 'fixture.generatedIds.length');
    await probe(page, 'fixture.externalLogout()'); await probe(page, 'fixture.differentUser()'); await login(page);
    await probe(page, 'window.oldStateChange.click()');
    expect(await probe(page, 'fixture.generatedIds.length')).toBe(count);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['cloud-trash-success', 'cloud-trash-no-writer'])('%s: 確認後trashを一度だけ送信し、snapshotを更新せず失効させる', async mode => {
  const page = await pageFor(mode); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    const local = await probe(page, 'fixture.state()');
    await prepareStateChange(page);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    await page.getByRole('button', { name: '移動をキャンセル', exact: true }).click();
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    await page.getByRole('button', { name: 'ゴミ箱へ移動', exact: true }).click();
    const count = Number(await probe(page, 'fixture.generatedIds.length'));
    await page.getByRole('button', { name: '確認してゴミ箱へ移動', exact: true }).click();
    await page.getByText(/ゴミ箱への移動要求の成功を確認/).waitFor();
    const args = await probe(page, 'fixture.stateArgs()') as CloudCall['args'];
    const ids = await probe(page, 'fixture.generatedIds.slice()') as string[];
    expect(args).toEqual({ p_id: '00000000-0000-4000-8000-000000000101', p_expected_revision: 1, p_request_id: ids[count], p_action: 'trash' });
    expect(ids.length).toBe(count + 1);
    expect(await page.locator('#product-cloud-snapshot').textContent()).toBe('');
    await probe(page, 'window.oldStateChange.click()');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_change_state']);
    expect(await probe(page, 'fixture.state()')).toEqual(local);
    expect(await probe(page, 'fixture.stored()')).toEqual([]);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    const output = (await page.locator('body').innerHTML()) + page.url() + JSON.stringify(logs);
    for (const secret of [...ids, String(args.p_id), 'synthetic-password', 'synthetic-token-private', 'raw-provider-token', '00000000-0000-4000-8000-000000000002']) expect(output).not.toContain(secret);
  } finally { await page.context().close(); }
});
it.each(['conflict', 'rejected', 'unknown', 'unverified', 'invalid', 'deleted'])('trash %sを現在の移動成功にせず、再送/独自resolve/local writeを行わない', async outcome => {
  const page = await pageFor(`cloud-trash-${outcome}`); const logs: string[] = [];
  page.on('console', item => logs.push(item.text())); page.on('pageerror', error => logs.push(error.message));
  try {
    await sendStateChange(page); await page.waitForFunction('fixture.calls.stateCompleted === 1');
    const status = await page.locator('#product-cloud-trash-state').textContent();
    expect(status).not.toContain('移動要求の成功');
    if (outcome === 'conflict') expect(status).toContain('競合');
    if (outcome === 'rejected') expect(status).toContain('拒否');
    if (outcome === 'deleted') expect(status).toContain('削除済み');
    if (['unknown', 'unverified', 'invalid'].includes(outcome)) {
      expect(status).toContain('UNKNOWN'); expect(await probe(page, 'fixture.dispose()')).toBe('pending');
      expect(await page.getByRole('button', { name: 'クラウドに新規メモ', exact: true }).isDisabled()).toBe(true);
    }
    await probe(page, 'window.oldStateChange.click()');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_change_state']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    expect(await page.locator('#product-cloud-snapshot').textContent()).toBe('');
    const output = (await page.locator('body').innerHTML()) + page.url() + JSON.stringify(logs);
    for (const secret of ['synthetic-password', 'raw-provider-token', 'synthetic-token-private']) expect(output).not.toContain(secret);
  } finally { await page.context().close(); }
});
it('trash中の二重操作/保存先変更/logout/disposeを既存busyで抑止する', async () => {
  const page = await pageFor('cloud-trash-pending');
  try {
    await sendStateChange(page); await page.waitForFunction('fixture.rpcNames.length === 2');
    await probe(page, 'window.oldStateChange.click()');
    await page.getByRole('button', { name: 'ローカルを選択', exact: true }).dispatchEvent('click');
    await page.getByRole('button', { name: 'ログアウト', exact: true }).dispatchEvent('click');
    expect(await probe(page, 'fixture.dispose()')).toBe('busy');
    expect(await probe(page, 'fixture.target().target')).toBe('cloud'); expect(await probe(page, 'fixture.calls.logout')).toBe(0);
    await probe(page, 'fixture.releaseState()'); await page.getByText(/ゴミ箱への移動要求の成功を確認/).waitFor();
    expect(await probe(page, 'fixture.dispose()')).toBe('applied');
    await probe(page, 'window.oldStateChange.click()');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_change_state']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['expired', 'generation', 'target', 'snapshot'])('trash送信後%s変更時の旧応答を現在成功へ反映しない', async change => {
  const page = await pageFor('cloud-trash-pending');
  try {
    await sendStateChange(page); await page.waitForFunction('fixture.rpcNames.length === 2');
    await probe(page, change === 'expired' ? 'fixture.expired()' : change === 'generation' ? 'fixture.refreshAuth()' : change === 'target' ? 'fixture.forceLocal()' : 'fixture.invalidateSnapshot()');
    await probe(page, 'fixture.releaseState()'); await page.waitForFunction('fixture.calls.stateCompleted === 1');
    expect(await page.locator('#product-cloud-trash-state').textContent()).not.toContain('移動要求の成功');
    expect(await page.locator('#product-cloud-snapshot').textContent()).toBe('');
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_change_state']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});
it.each(['expired', 'generation', 'target', 'snapshot', 'dispose', 'user'])('trash確認後%s変更で旧ボタンを再利用できない', async change => {
  const page = await pageFor('cloud-trash-success');
  try {
    await prepareStateChange(page);
    const count = await probe(page, 'fixture.generatedIds.length');
    if (change === 'user') { await probe(page, 'fixture.externalLogout()'); await probe(page, 'fixture.differentUser()'); await login(page); }
    else await probe(page, change === 'expired' ? 'fixture.expired()' : change === 'generation' ? 'fixture.refreshAuth()' : change === 'target' ? 'fixture.forceLocal()' : change === 'dispose' ? 'fixture.dispose()' : 'fixture.invalidateSnapshot()');
    await probe(page, 'window.oldStateChange.click()');
    expect(await probe(page, 'fixture.generatedIds.length')).toBe(count);
    expect(await probe(page, 'fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await probe(page, 'fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await page.context().close(); }
});

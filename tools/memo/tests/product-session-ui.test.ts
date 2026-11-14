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
  await page.locator('#memo-app:not([hidden])').waitFor();
  return page;
}
const probe = (page: Page, code: string) => page.evaluate(code);
async function login(page: Page) {
  await page.getByLabel('ログイン用メールアドレス').fill('synthetic-email@example.invalid');
  await page.getByLabel('ログイン用パスワード').fill('synthetic-password');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
}
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

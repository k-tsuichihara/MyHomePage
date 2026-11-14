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
  const page = await pageFor('cloud-pending');
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

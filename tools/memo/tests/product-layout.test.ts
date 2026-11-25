import { beforeAll, afterAll, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { prepareProductPreview } from '../scripts/product-preview';

const root = new URL('../', import.meta.url);
async function waitSavedEditor(page: import('@playwright/test').Page) {
  await page.locator('#editor-view .editor-saved').waitFor();
  expect(await page.locator('#editor-view').isVisible()).toBe(true);
  expect(await page.locator('#detail-view').isVisible()).toBe(false);
}
let browser: Browser, fake: string;
beforeAll(async () => {
  execFileSync(process.execPath, ['scripts/build-product.mjs']);
  const layout = (await build({ entryPoints: [fileURLToPath(new URL('src/ui/product-layout.ts', root))], bundle: true, write: false, format: 'iife', globalName: 'ProductLayout' })).outputFiles[0]!.text;
  const fixture = (await build({ entryPoints: [fileURLToPath(new URL('tests/product-session-fixture.ts', root))], bundle: true, write: false, format: 'iife' })).outputFiles[0]!.text;
  fake = layout + '\nProductLayout.mountProductLayout(document);\n' + fixture;
  browser = await chromium.launch({ headless: true, proxy: { server: 'http://127.0.0.1:9' } });
}, 30000);
afterAll(async () => { await browser?.close(); });

it.each([1200, 390, 320])('UAT-05：編集画面のlogin禁止と一覧復帰・cloud移行：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-d05-login');
    await page.locator('#product-auth-open:not([disabled])').waitFor();
    const dialog = page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true });
    await page.locator('#product-auth-open').click();
    const login = dialog.getByRole('button', { name: 'ログイン', exact: true });
    expect(await login.isEnabled()).toBe(true);
    const oldLogin = await login.elementHandle();
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
    const checkBlocked = async () => {
      await page.locator('#product-auth-open').click();
      expect(await login.isDisabled()).toBe(true);
      expect(await page.locator('#product-login-hint').isVisible()).toBe(true);
      await oldLogin!.evaluate(node => node.dispatchEvent(new Event('click')));
      await dialog.locator('form').dispatchEvent('submit');
      expect(await page.evaluate('fixture.calls.login')).toBe(0);
      expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
      await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
    };
    await page.locator('#new').click(); await checkBlocked(); // clean new
    await page.locator('#memo-title').fill('保護するlocal draft'); await checkBlocked();
    await page.locator('#back').click(); await page.locator('#confirm-no').click();
    expect(await page.locator('#memo-title').inputValue()).toBe('保護するlocal draft');
    await checkBlocked();
    await page.locator('#save').click(); await waitSavedEditor(page); await checkBlocked(); // clean saved
    await page.locator('#memo-body').fill('未保存の本文'); await checkBlocked();
    await page.locator('#save').click(); await waitSavedEditor(page); await page.locator('#back').click();
    await page.locator('#product-auth-open').click();
    expect(await login.isEnabled()).toBe(true);
    expect(await page.locator('#product-login-hint').isVisible()).toBe(false);
    await dialog.getByLabel('メールアドレス', { exact: true }).fill('synthetic-email@example.invalid');
    await dialog.getByLabel('パスワード', { exact: true }).fill('synthetic-password');
    await login.click();
    await page.locator('#product-cloud-items').waitFor();
    expect(await page.evaluate('fixture.target().target')).toBe('cloud');
    expect(await page.evaluate('fixture.calls.login')).toBe(1);
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await page.evaluate('fixture.calls.writes')).toBe(2);
    expect(await page.evaluate('fixture.calls.fetch')).toBe(0);
    expect(await page.getByText('現在の保存先：クラウド（ログイン中）', { exact: true }).count()).toBe(1);
    for (const name of ['ローカルを選択', 'クラウドを選択', 'セッションを復元']) expect(await page.getByRole('button', { name, exact: true }).count()).toBe(0);
  } finally { await context.close(); }
}, 20000);

it.each(['new', 'saved'])('UAT-05：%s未保存離脱を承認した保管draftは保持し、一覧loginでD05を重複しない', async kind => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-d05-login'); await page.locator('#new').waitFor();
    await page.locator('#new').click(); await page.locator('#memo-title').fill('保管するlocal draft');
    if (kind === 'saved') {
      await page.locator('#save').click(); await waitSavedEditor(page);
      await page.locator('#memo-body').fill('未保存の追記');
    }
    await page.locator('#back').click(); await page.locator('#confirm-no').click();
    expect(await page.locator('#memo-title').inputValue()).toBe('保管するlocal draft');
    expect(await page.evaluate('fixture.state().route.kind')).toBe('edit');
    await page.locator('#back').click(); await page.locator('#confirm-yes').click();
    expect(await page.evaluate('fixture.state().route.kind')).toBe('list');
    const retained = await page.evaluate<readonly import('../src/editor-state').EditorState[]>('fixture.state().retainedEditors');
    expect(retained).toHaveLength(1);
    expect(retained[0]!.draft.title).toBe('保管するlocal draft');
    expect(retained[0]!.draft).not.toEqual(retained[0]!.baseline);
    expect(await page.evaluate('fixture.target().dirty')).toBe(false);
    const stored = await page.evaluate('fixture.stored()');
    await page.locator('#product-auth-open').click();
    const dialog = page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true });
    await dialog.getByLabel('メールアドレス', { exact: true }).fill('synthetic-email@example.invalid');
    await dialog.getByLabel('パスワード', { exact: true }).fill('synthetic-password');
    await dialog.getByRole('button', { name: 'ログイン', exact: true }).click();
    await page.locator('#product-cloud-items').waitFor();
    expect(await page.getByRole('button', { name: '確認して保存先を変更', exact: true }).isVisible()).toBe(false);
    expect(await page.evaluate('fixture.target().target')).toBe('cloud');
    expect(await page.evaluate('fixture.state().retainedEditors')).toEqual(retained);
    expect(await page.evaluate('fixture.stored()')).toEqual(stored);
    expect(await page.evaluate('fixture.calls.login')).toBe(1);
    expect(await page.evaluate('fixture.calls.writes')).toBe(kind === 'saved' ? 1 : 0);
    expect(await page.evaluate('fixture.calls.fetch')).toBe(0);
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
  } finally { await context.close(); }
}, 20000);

it.each([1200, 390, 320])('UAT-07：logout確認の余白・赤いlogin案内・取消通知なし：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit'); await page.locator('#product-cloud-items').waitFor();
    await page.locator('#product-cloud-items .open-card').first().click();
    await page.getByLabel('クラウドの本文', { exact: true }).fill('UAT-07 保護する追記');
    await page.locator('#product-auth-open').click();
    const dialog = page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true });
    expect(await page.locator('#product-login-hint').evaluate(node => getComputedStyle(node).color)).toBe('rgb(180, 35, 24)');
    await dialog.getByRole('button', { name: 'ログアウト', exact: true }).click();
    const actions = dialog.locator('.auth-confirmation-actions');
    expect(await actions.evaluate(node => { const s = getComputedStyle(node); return [s.gap, s.marginTop, s.marginBottom, s.flexWrap]; })).toEqual(['10px', '10px', '10px', 'wrap']);
    const yes = await dialog.getByRole('button', { name: '確認してログアウト', exact: true }).boundingBox();
    const no = await dialog.getByRole('button', { name: 'ログアウトをキャンセル', exact: true }).boundingBox();
    expect(yes && no).toBeTruthy();
    expect(no!.y >= yes!.y + yes!.height + 9 || no!.x >= yes!.x + yes!.width + 9).toBe(true);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await dialog.getByRole('button', { name: 'ログアウトをキャンセル', exact: true }).click();
    expect(await page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('UAT-07 保護する追記');
    await page.locator('#product-auth-open').click();
    expect(await page.locator('#product-auth-feedback').textContent()).toBe('');
    expect(await page.evaluate('fixture.target().target')).toBe('cloud');
    expect(await page.evaluate('fixture.calls.logout + fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
  } finally { await context.close(); }
}, 20000);

it.each(['saved', 'new'])('UAT-05：cloudの%s編集でもlogin禁止、失効時のlogout回復は維持', async kind => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit'); await page.locator('#product-cloud-items').waitFor();
    if (kind === 'new') await page.locator('.cloud-actions').getByRole('button', { name: '＋ 新規作成', exact: true }).click();
    else await page.locator('#product-cloud-items .open-card').first().click();
    const dialog = page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true });
    for (const dirty of [false, true]) {
      if (dirty) await page.getByLabel('クラウドの本文', { exact: true }).fill('保護するcloud draft');
      await page.locator('#product-auth-open').click();
      expect(await dialog.getByRole('button', { name: 'ログイン', exact: true }).isDisabled()).toBe(true);
      await dialog.locator('form').dispatchEvent('submit');
      expect(await page.evaluate('fixture.calls.login')).toBe(0);
      await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
    }
    await page.evaluate('fixture.expired()'); await page.locator('#product-auth-open').click();
    expect(await dialog.getByRole('button', { name: 'ログイン', exact: true }).isDisabled()).toBe(true);
    expect(await dialog.getByRole('button', { name: 'ログアウト', exact: true }).isEnabled()).toBe(true);
    await dialog.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await dialog.getByRole('button', { name: 'ログアウトをキャンセル', exact: true }).click();
    // 失効時は本文をDOMへ露出せず、editorとcloud選択を保持する既存契約。
    expect(await page.locator('#product-cloud-editor').isVisible()).toBe(true);
    expect(await page.getByLabel('クラウドの本文', { exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate('fixture.target().target')).toBe('cloud');
    expect(await page.evaluate('fixture.calls.login + fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
  } finally { await context.close(); }
}, 20000);

it.each([1200, 390, 320])('UAT-05：認証ラベル/操作行と正常・エラー色を既存判定から表示：幅%s', async width => {
  for (const mode of ['cloud-edit-signed-out', 'cloud-d05-restore-blocked', 'cloud-failure']) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    try {
      const page = await fakeProduct(context, mode); await page.locator('#product-auth-open:not([disabled])').waitFor();
      await page.locator('#product-auth-open').click();
      const dialog = page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true });
      expect(await dialog.getByText(mode === 'cloud-edit-signed-out' ? '現在の保存先：ローカル（未ログイン）' : mode === 'cloud-d05-restore-blocked' ? '現在の保存先：ローカル（認証を確認できません）' : '現在の保存先：クラウド（ログイン中）', { exact: true }).count()).toBe(1);
      expect(await dialog.getByLabel('メールアドレス', { exact: true }).isVisible()).toBe(true);
      expect(await dialog.getByLabel('パスワード', { exact: true }).isVisible()).toBe(true);
      const login = await dialog.getByRole('button', { name: 'ログイン', exact: true }).boundingBox(), logout = await dialog.getByRole('button', { name: 'ログアウト', exact: true }).boundingBox();
      expect(login!.y).toBe(logout!.y); expect(login!.x + login!.width).toBeLessThan(logout!.x);
      const status = page.locator(mode === 'cloud-failure' ? '#product-cloud-state' : '#product-session-state');
      const error = mode !== 'cloud-edit-signed-out';
      expect(await status.getAttribute('data-notice')).toBe(error ? 'error' : 'routine');
      expect(await status.evaluate(node => getComputedStyle(node).color === 'rgb(180, 35, 24)')).toBe(error);
      for (const name of ['ローカルを選択', 'クラウドを選択', 'セッションを復元']) expect(await dialog.getByRole('button', { name, exact: true }).count()).toBe(0);
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    } finally { await context.close(); }
  }
}, 20000);

it.each([320, 390, 650, 1200])('UAT-02追加：タグ折返しと縦scroll、複数タグでも日時位置を維持：幅%s', async width => {
  for (const cloud of [false, true]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    try {
      const page = await fakeProduct(context, cloud ? 'cloud-list-many-tags' : 'cloud-edit-signed-out');
      if (!cloud) {
        await page.getByRole('button', { name: 'タグ管理', exact: true }).first().click();
        const dialog = page.getByRole('dialog', { name: 'タグ管理', exact: true });
        for (let index = 0; index < 16; index++) {
          await dialog.getByLabel('新規タグ名').fill(`折返し用タグ${index}`); await dialog.getByRole('button', { name: '＋追加', exact: true }).click();
          await dialog.getByRole('group', { name: `タグ「折返し用タグ${index}」`, exact: true }).waitFor();
        }
        await dialog.getByRole('button', { name: 'タグ管理を閉じる', exact: true }).click();
        await page.locator('#new').click(); await page.locator('#memo-title').fill('タグ配置確認');
        for (const input of await page.locator('#editor-tags input').all()) await input.check();
        await page.locator('#save').click(); await waitSavedEditor(page); await page.locator('#back').click();
      } else await page.locator('#product-cloud-items').waitFor();
      const scroll = page.locator(cloud ? '.cloud-filter-wrap' : '.tag-chip-strip');
      const layout = await scroll.evaluate(node => {
        const tops = [...node.querySelectorAll('label')].map(label => label.getBoundingClientRect().top);
        node.scrollTop = 50;
        return { x: node.scrollWidth <= node.clientWidth, y: node.scrollHeight > node.clientHeight, moved: node.scrollTop > 0, height: node.clientHeight, rows: new Set(tops).size };
      });
      if (width <= 650) { expect(layout).toMatchObject({ x: true, y: true, moved: true }); expect(layout.height).toBeLessThanOrEqual(148); expect(layout.rows).toBeGreaterThan(3); }
      else expect(layout.rows).toBe(1);
      const card = page.locator(cloud ? '#product-cloud-items>li' : '#cards>li').filter({ has: page.locator('.card-tag') }).filter({ hasText: cloud ? 'Alpha title' : 'タグ配置確認' }).first();
      const timing = await card.evaluate(node => {
        const time = node.querySelector('time')!, tags = node.querySelector('.card-tags')!, open = node.querySelector('.open-card')!;
        const position = () => ({ x: time.getBoundingClientRect().x - open.getBoundingClientRect().x, y: time.getBoundingClientRect().y - open.getBoundingClientRect().y });
        const many = position(), height = node.getBoundingClientRect().height;
        while (tags.children.length > 1) tags.lastElementChild!.remove();
        const one = position();
        const pin = node.querySelector<HTMLElement>('.pin-indicator')!;
        return { many, one, height, smaller: node.getBoundingClientRect().height, hidden: pin.hidden, pinWidth: pin.getBoundingClientRect().width, icons: tags.querySelectorAll('.tag-icon').length };
      });
      expect(timing.many).toEqual(timing.one); expect(timing.height).toBeGreaterThanOrEqual(timing.smaller);
      expect(timing).toMatchObject({ hidden: true, pinWidth: 0, icons: 1 });
      expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
      await page.screenshot({ path: fileURLToPath(new URL(`.product/uat02-tags-${cloud ? 'cloud' : 'local'}-${width}.png`, root)) });
    } finally { await context.close(); }
  }
}, 30000);

it.each([1200, 390, 320])('UAT-02：cloudカードのタグアイコンとタイトル前のピンをoffline表示：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-list-success'); await page.locator('#product-cloud-items').waitFor();
    expect(await page.locator('#product-cloud-items .card-tag .tag-icon').count()).toBeGreaterThan(0);
    const card = page.locator('#product-cloud-items>li').filter({ has: page.locator('.pin-indicator[aria-label="ピン留め済み"]') }).first();
    const geometry = await card.evaluate(node => {
      const pin = node.querySelector<HTMLElement>('.pin-indicator')!, caption = node.querySelector('.card-title')!;
      return { first: caption.firstChild === pin, size: Number.parseFloat(getComputedStyle(pin).fontSize) };
    });
    expect(geometry.first).toBe(true); expect(geometry.size).toBe(20);
    await card.locator('summary').click(); expect(await page.locator('#product-cloud-editor').isVisible()).toBe(false);
    await page.locator('#page-title').click(); await card.locator('.open-card').click(); expect(await page.locator('#product-cloud-editor').isVisible()).toBe(true);
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  } finally { await context.close(); }
}, 15000);

it.each([1200, 390, 320])('UAT-02：タグ改名をnative dialogなしで保存し関連・再表示・カード表示を維持：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out');
    await page.getByRole('button', { name: 'タグ管理', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'タグ管理', exact: true });
    await dialog.getByLabel('新規タグ名').fill('旧名称'); await dialog.getByRole('button', { name: '＋追加', exact: true }).click();
    await dialog.getByRole('group', { name: 'タグ「旧名称」', exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'タグ管理を閉じる', exact: true }).click();
    await page.locator('#new').click(); await page.locator('#memo-title').fill('関連メモ');
    await page.locator('#editor-tags input').check(); await page.locator('#save').click(); await waitSavedEditor(page); await page.locator('#back').click();
    const before = await page.evaluate("JSON.parse(fixture.stored().find(([key])=>key==='myhomepage.memo.data.v2')[1])") as { tags: { id: string }[]; memoTags: unknown[] };
    await page.getByRole('button', { name: 'タグ管理', exact: true }).first().click();
    const row = dialog.getByRole('group', { name: 'タグ「旧名称」', exact: true });
    expect(await row.getByText('1件', { exact: true }).isVisible()).toBe(true);
    await row.getByRole('button', { name: '編集', exact: true }).click(); await row.getByLabel('変更後のタグ名').fill('新名称');
    await row.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.getByRole('group', { name: 'タグ「新名称」', exact: true }).waitFor();
    expect(await dialog.getByRole('button', { name: '変更を保存', exact: true }).count()).toBe(0);
    await dialog.getByRole('button', { name: 'タグ管理を閉じる', exact: true }).click(); await page.locator('#reload').click();
    await expect.poll(() => page.locator('#filters').textContent()).toContain('新名称（1件）');
    const after = await page.evaluate("JSON.parse(fixture.stored().find(([key])=>key==='myhomepage.memo.data.v2')[1])") as { tags: { id: string; name: string }[]; memoTags: unknown[] };
    expect(after.tags[0]).toMatchObject({ id: before.tags[0]!.id, name: '新名称' }); expect(after.memoTags).toEqual(before.memoTags);
    const card = page.locator('#cards>li').first(); expect(await card.locator('.card-tag .tag-icon').count()).toBe(1);
    expect(await card.locator('.card-tag').textContent()).toContain('新名称');
    await card.locator('summary').click(); await card.getByRole('button', { name: 'ピン留め', exact: true }).click();
    await card.locator('.pin-indicator').filter({ hasText: '📌' }).waitFor();
    const geometry = await card.evaluate(node => {
      const pin = node.querySelector<HTMLElement>('.pin-indicator')!, caption = node.querySelector('.card-title')!;
      return { first: caption.firstChild === pin, size: Number.parseFloat(getComputedStyle(pin).fontSize) };
    });
    expect(geometry.first).toBe(true); expect(geometry.size).toBe(20);
    if (width === 1200) { const all = await page.locator('#filters-all').boundingBox(), tag = await page.locator('#filters label').boundingBox(); expect(Math.abs(all!.height - tag!.height)).toBeLessThan(1); }
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    await card.locator('.open-card').click(); expect(await page.locator('#editor-view').isVisible()).toBe(true);
    expect(await page.evaluate('fixture.rpcNames')).toEqual([]); expect(await page.evaluate('fixture.calls.fetch')).toBe(0);
  } finally { await context.close(); }
}, 20000);

it('通常メモは一覧/前後とも直接編集、新規dirtyのcancel/approveと端のno-opを維持する', async () => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out'); await page.locator('#new').waitFor();
    for (const title of ['保存済みA', '保存済みB']) {
      await page.locator('#new').click(); await page.locator('#memo-title').fill(title); await page.locator('#save').click();
      await waitSavedEditor(page); await page.locator('#back').click(); await page.locator('#list-view').waitFor();
    }
    const first = await page.locator('#cards .card-title').first().textContent();
    await page.locator('#new').click(); await page.locator('#memo-title').fill('未保存新規');
    await page.locator('#editor-previous').click(); expect(await page.locator('#confirmation').isVisible()).toBe(false);
    expect(await page.locator('#error').textContent()).toBe('');
    await page.locator('#editor-next').click(); await page.locator('#confirmation').waitFor();
    await page.locator('#confirm-no').click(); expect(await page.locator('#memo-title').inputValue()).toBe('未保存新規');
    await page.locator('#editor-next').click(); await page.locator('#confirm-yes').click();
    await expect.poll(() => page.locator('#memo-title').inputValue()).toBe(first);
    expect(await page.locator('#detail-view').isVisible()).toBe(false);
    await page.locator('#memo-body').fill('dirty本文'); await page.locator('#editor-next').click(); await page.locator('#confirm-no').click();
    expect(await page.locator('#memo-body').inputValue()).toBe('dirty本文');
    await page.locator('#editor-next').click(); await page.locator('#confirm-yes').click();
    expect(await page.locator('#memo-title').inputValue()).not.toBe(first);
    await page.locator('#editor-next').click(); expect(await page.locator('#confirmation').isVisible()).toBe(false);
    expect(await page.locator('#error').textContent()).toBe('');
    await page.locator('#editor-previous').click(); expect(await page.locator('#memo-title').inputValue()).toBe(first);
    await page.locator('#back').click(); await page.locator('#cards button.open-card').first().click();
    expect(await page.locator('#editor-view').isVisible()).toBe(true); expect(await page.locator('#detail-view').isVisible()).toBe(false);
    expect(await page.evaluate('fixture.calls.writes')).toBe(2); expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
  } finally { await context.close(); }
}, 15000);

it.each(['success', 'failure', 'generation', 'user', 'target', 'edit'])('cloudの前後移動は同じ一覧文脈と既存loadで対象を確認する：%s', async change => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-list-success'); await page.locator('#product-cloud-items').waitFor();
    await page.locator('#product-cloud-snapshot').getByLabel('検索', { exact: true }).fill('common');
    await page.locator('#product-cloud-items button.open-card').first().click();
    const editor = page.locator('#product-cloud-editor'); await editor.waitFor();
    expect(await page.getByLabel('クラウドのタイトル', { exact: true }).inputValue()).toBe('Pinned new');
    await page.getByLabel('クラウドの本文', { exact: true }).fill('dirty cloud本文');
    await editor.getByRole('button', { name: '次のメモ 〉', exact: true }).click();
    await editor.getByRole('button', { name: 'クラウド編集を続ける', exact: true }).click();
    expect(await page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('dirty cloud本文');
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    if (change === 'failure') await page.evaluate("fixture.snapshotMode('unverified')");
    if (!['success', 'failure'].includes(change)) await page.evaluate('fixture.holdNextRead()');
    await editor.getByRole('button', { name: '次のメモ 〉', exact: true }).click();
    await editor.getByRole('button', { name: '変更を破棄して移動', exact: true }).click();
    await expect.poll(() => page.evaluate('fixture.rpcNames.length')).toBe(2);
    if (change === 'generation') await page.evaluate('fixture.refreshAuth()');
    if (change === 'user') await page.evaluate('fixture.differentUser(); fixture.emit()');
    if (change === 'target') await page.evaluate('fixture.forceLocal()');
    if (change === 'edit') await page.getByLabel('クラウドの本文', { exact: true }).fill('読込中の追加');
    if (!['success', 'failure'].includes(change)) await page.evaluate('fixture.releaseRead()');
    await expect.poll(() => page.evaluate('fixture.calls.readCompleted')).toBe(2);
    if (change === 'success') {
      await expect.poll(() => page.getByLabel('クラウドのタイトル', { exact: true }).inputValue()).toBe('Pinned A');
      await editor.getByRole('button', { name: '〈 前のメモ', exact: true }).click();
      await expect.poll(() => page.getByLabel('クラウドのタイトル', { exact: true }).inputValue()).toBe('Pinned new');
      await editor.getByRole('button', { name: '〈 前のメモ', exact: true }).click();
      expect(await page.evaluate('fixture.rpcNames.length')).toBe(3);
    } else {
      expect(await page.getByLabel('クラウドのタイトル', { exact: true }).inputValue()).not.toBe('Pinned A');
      if (change === 'failure') expect(await page.locator('.cloud-editor-statuses').textContent()).toContain('移動先を確認できません');
      if (change === 'edit') expect(await page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('読込中の追加');
    }
    expect(await page.locator('#product-cloud-snapshot').isVisible()).toBe(false);
    expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    expect(await page.evaluate('fixture.rpcNames')).not.toContain('memo_save');
  } finally { await context.close(); }
}, 15000);

it.each(['new', 'voice'])('P2追補：localゴミ箱からの%sも通常一覧の前後対象と条件を使う', async kind => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-voice-existing-signed-out'); await page.locator('#new').waitFor();
    await page.locator('#new').click(); await page.locator('#memo-title').fill('通常対象'); await page.locator('#save').click(); await waitSavedEditor(page);
    await page.locator('#back').click(); await page.locator('#search').fill('通常対象'); await page.locator('#sort').selectOption('created-asc');
    await page.locator('#trash-view').click();
    await page.locator(kind === 'new' ? '#new' : '#list-voice-slot button').click();
    await page.locator('#memo-title').fill('ゴミ箱からの未保存'); await page.locator('#memo-body').fill('維持する本文');
    await page.locator('#editor-next').click(); await page.locator('#confirmation').waitFor(); await page.locator('#confirm-no').click();
    expect(await page.locator('#memo-body').inputValue()).toBe('維持する本文');
    await page.locator('#editor-next').click(); await page.locator('#confirm-yes').click();
    await expect.poll(() => page.locator('#memo-title').inputValue()).toBe('通常対象');
    await page.locator('#back').click(); await page.locator('#list-view').waitFor();
    expect(await page.locator('#search').inputValue()).toBe('通常対象'); expect(await page.locator('#sort').inputValue()).toBe('created-asc');
    expect(await page.evaluate('fixture.state().list.result.query.view')).toBe('normal');
    expect(await page.evaluate('fixture.calls.writes')).toBe(1); expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
  } finally { await context.close(); }
}, 15000);

it.each([1200, 390, 320])('P2追補：cloud編集の独立した複製を既存新規saveへ接続する：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-list-success'); await page.locator('#product-cloud-items').waitFor();
    await page.locator('#product-cloud-snapshot').getByLabel('検索', { exact: true }).fill('Pinned A');
    await page.locator('#product-cloud-items button.open-card').click();
    const editor = page.locator('#product-cloud-editor'), copy = editor.getByRole('button', { name: '複製', exact: true });
    await copy.waitFor();
    const nav = await editor.locator('nav').evaluate(node => Array.from(node.children).map(child => { const r = child.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right }; }));
    expect(nav[0]!.x).toBeLessThan(nav[1]!.x); expect(nav[1]!.right).toBeLessThan(nav[2]!.x); expect(nav[0]!.y).toBe(nav[2]!.y);
    await copy.click();
    expect(await page.getByLabel('クラウドのタイトル', { exact: true }).inputValue()).toBe('Pinned A');
    expect(await page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('needle common');
    expect(await editor.getByRole('checkbox', { name: '赤タグ', exact: true }).isChecked()).toBe(true);
    expect(await copy.isVisible()).toBe(true); expect(await copy.isDisabled()).toBe(true);
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    await page.getByLabel('クラウドのタイトル', { exact: true }).fill('編集からの複製');
    await editor.getByRole('checkbox', { name: '青タグ', exact: true }).check();
    await editor.getByRole('button', { name: '保存する', exact: true }).click();
    await editor.locator('.editor-saved').waitFor();
    const args = await page.evaluate('fixture.savedArgs()') as Record<string, unknown>;
    expect(args.p_id).not.toBe('00000000-0000-4000-8000-000000000201'); expect(args.p_expected_revision).toBeNull();
    expect(args.p_title).toBe('編集からの複製'); expect(args.p_body).toBe('needle common');
    expect(args.p_tag_ids).toEqual(['00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000105']);
    expect(args).not.toHaveProperty('pinned_at');
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save']);
    expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    expect(await page.locator('body').innerText()).not.toMatch(/00000000-0000-4000-8000/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
}, 15000);

it('P2追補：cloud編集の複製はdirtyのcancel/古い承認を拒否し、有効承認後だけ保存済みbaselineを使う', async () => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-success'); await page.locator('#product-cloud-items button.open-card').first().click();
    const editor = page.locator('#product-cloud-editor'), copy = editor.getByRole('button', { name: '複製', exact: true }), title = page.getByLabel('クラウドのタイトル', { exact: true });
    const ids = Number(await page.evaluate('fixture.generatedIds.length'));
    await title.fill('未保存値'); await copy.click(); await editor.getByRole('button', { name: 'クラウド編集を続ける', exact: true }).click();
    expect(await title.inputValue()).toBe('未保存値'); expect(await page.evaluate('fixture.generatedIds.length')).toBe(ids);
    await copy.click(); await title.fill('確認後の入力');
    await editor.getByRole('button', { name: '変更を破棄して複製', exact: true }).click();
    expect(await title.inputValue()).toBe('確認後の入力'); expect(await page.evaluate('fixture.generatedIds.length')).toBe(ids);
    await page.evaluate("fixture.snapshotMode('failure')");
    await page.locator('.cloud-list-navigation').getByRole('button', { name: '< 一覧へ', exact: true }).click();
    await editor.getByRole('button', { name: '変更を破棄して編集を閉じる', exact: true }).click();
    await page.locator('.cloud-editor-statuses').getByRole('status').filter({ hasText: '一覧を確認できません' }).waitFor();
    await copy.click(); await editor.getByRole('button', { name: '変更を破棄して複製', exact: true }).click();
    expect(await title.inputValue()).toBe('クラウドの合成メモ');
    expect(await page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('<b>読取専用の本文</b>');
    expect(await page.evaluate('fixture.generatedIds.length')).toBe(ids + 2);
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_load_snapshot']); expect(await page.evaluate('fixture.calls.writes')).toBe(0);
  } finally { await context.close(); }
}, 15000);

it.each(['unknown', 'pending', 'stale'])('P2追補：cloud編集の複製は%sでは新規draft/通信を開始しない', async condition => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, condition === 'stale' ? 'cloud-edit-success' : `cloud-edit-${condition}`);
    await page.locator('#product-cloud-items button.open-card').first().click();
    const editor = page.locator('#product-cloud-editor'), copy = editor.getByRole('button', { name: '複製', exact: true });
    await page.getByLabel('クラウドのタイトル', { exact: true }).fill('元draftを保持');
    if (condition === 'stale') {
      await copy.click(); await page.evaluate('fixture.refreshAuth()');
      await editor.getByRole('button', { name: '変更を破棄して複製', exact: true }).click();
    }
    else await editor.getByRole('button', { name: '保存する', exact: true }).click();
    if (condition === 'unknown') await page.locator('.cloud-editor-statuses').getByRole('status').filter({ hasText: '保存できたか不明' }).waitFor();
    const ids = Number(await page.evaluate('fixture.generatedIds.length'));
    await copy.dispatchEvent('click'); expect(await copy.isDisabled()).toBe(true);
    expect(await page.evaluate('fixture.generatedIds.length')).toBe(ids);
    expect(await page.getByLabel('クラウドのタイトル', { exact: true }).inputValue()).toBe('元draftを保持');
    if (condition === 'pending') {
      await page.evaluate('fixture.releaseSave()'); await editor.locator('.editor-saved').waitFor();
      await copy.click(); expect(await copy.isVisible()).toBe(true); expect(await copy.isDisabled()).toBe(true);
      expect(await page.getByLabel('クラウドのタイトル', { exact: true }).inputValue()).toBe('元draftを保持');
      expect(await page.evaluate('fixture.generatedIds.length')).toBe(ids + 2);
    }
    expect(await page.evaluate('fixture.rpcNames')).toEqual(condition === 'stale' ? ['memo_load_snapshot'] : ['memo_load_snapshot', 'memo_save']);
    expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await context.close(); }
}, 15000);

it.each(['failure', 'unverified', 'generation', 'edit'])('P2：cloud一覧復帰の%sではeditorと一覧条件を失わず明示再操作だけ許可する', async change => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-list-success'); await page.locator('#product-cloud-items').waitFor();
    await page.locator('#product-cloud-snapshot').getByLabel('検索', { exact: true }).fill('common');
    await page.getByRole('checkbox', { name: '絞込タグ：青タグ', exact: true }).check();
    await page.locator('#product-cloud-snapshot').getByLabel('並び替え', { exact: true }).selectOption('created-asc');
    await page.locator('#product-session .cloud-actions .primary').click();
    const editor = page.locator('#product-cloud-editor'), title = page.getByLabel('クラウドのタイトル', { exact: true }), body = page.getByLabel('クラウドの本文', { exact: true });
    await title.fill('一覧復帰前のdraft'); await body.fill('保持する本文');
    if (change === 'failure' || change === 'unverified') await page.evaluate(change === 'failure' ? "fixture.snapshotMode('failure')" : "fixture.snapshotMode('unverified')");
    else await page.evaluate('fixture.holdNextRead()');
    await page.locator('.cloud-list-navigation').getByRole('button', { name: '< 一覧へ', exact: true }).click();
    await editor.getByRole('button', { name: '変更を破棄して編集を閉じる', exact: true }).click();
    await expect.poll(() => page.evaluate('fixture.rpcNames.length')).toBe(2);
    if (change === 'generation' || change === 'edit') {
      expect(await editor.isVisible()).toBe(true); expect(await page.evaluate('fixture.dispose()')).toBe('busy');
      await editor.getByRole('button', { name: '保存する', exact: true }).evaluate(node => (node as HTMLButtonElement).click());
      if (change === 'generation') await page.evaluate('fixture.refreshAuth()');
      else await body.fill('読取中の追加入力');
      await page.evaluate('fixture.releaseRead()');
    }
    await expect.poll(() => page.evaluate('fixture.calls.readCompleted')).toBe(2);
    await expect.poll(() => page.locator('.cloud-list-navigation').getByRole('button', { name: '< 一覧へ', exact: true }).isEnabled()).toBe(true);
    expect(await editor.isVisible()).toBe(true); expect(await title.inputValue()).toBe('一覧復帰前のdraft');
    expect(await body.inputValue()).toBe(change === 'edit' ? '読取中の追加入力' : '保持する本文');
    expect(await page.locator('#product-cloud-snapshot').isVisible()).toBe(false);
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_load_snapshot']);
    await page.evaluate("fixture.snapshotMode('success')");
    await page.locator('.cloud-list-navigation').getByRole('button', { name: '< 一覧へ', exact: true }).click();
    await editor.getByRole('button', { name: '変更を破棄して編集を閉じる', exact: true }).click();
    await page.locator('#product-cloud-items').waitFor(); expect(await editor.isVisible()).toBe(false);
    expect(await page.locator('#product-cloud-snapshot').getByLabel('検索', { exact: true }).inputValue()).toBe('common');
    expect(await page.getByRole('checkbox', { name: '絞込タグ：青タグ', exact: true }).isChecked()).toBe(true);
    expect(await page.locator('#product-cloud-snapshot').getByLabel('並び替え', { exact: true }).inputValue()).toBe('created-asc');
    expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_load_snapshot', 'memo_load_snapshot']);
  } finally { await context.close(); }
}, 15000);

it.each(['new', 'voice'])('P2：ゴミ箱からのcloud %sでも保持した通常一覧の条件と前後対象を使う', async kind => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, kind === 'voice' ? 'cloud-list-voice' : 'cloud-list-success'); await page.locator('#product-cloud-items').waitFor();
    await page.locator('#product-cloud-snapshot').getByLabel('検索', { exact: true }).fill('Delta');
    await page.getByRole('checkbox', { name: '絞込タグ：青タグ', exact: true }).check();
    await page.locator('#product-cloud-snapshot').getByLabel('並び替え', { exact: true }).selectOption('created-asc');
    await page.getByRole('button', { name: 'ゴミ箱', exact: true }).click();
    await page.locator(kind === 'voice' ? '#product-session .cloud-actions .voice-memo-button' : '#product-session .cloud-actions .primary').click();
    const editor = page.locator('#product-cloud-editor'); await editor.waitFor();
    await page.getByLabel('クラウドのタイトル', { exact: true }).fill('ゴミ箱からの新規');
    await editor.getByRole('button', { name: '次のメモ 〉', exact: true }).click();
    await editor.getByRole('button', { name: '変更を破棄して移動', exact: true }).click();
    await expect.poll(() => page.getByLabel('クラウドのタイトル', { exact: true }).inputValue()).toBe('Delta');
    await page.locator('.cloud-list-navigation').getByRole('button', { name: '< 一覧へ', exact: true }).click(); await page.locator('#product-cloud-items').waitFor();
    expect(await page.locator('#product-cloud-snapshot').getByLabel('検索', { exact: true }).inputValue()).toBe('Delta');
    expect(await page.getByRole('checkbox', { name: '絞込タグ：青タグ', exact: true }).isChecked()).toBe(true);
    expect(await page.locator('#product-cloud-snapshot').getByLabel('並び替え', { exact: true }).inputValue()).toBe('created-asc');
    expect(await page.locator('#product-cloud-items .card-title').allTextContents()).toEqual(['Delta']);
    expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_load_snapshot', 'memo_load_snapshot']);
  } finally { await context.close(); }
}, 15000);

it('cloud新規も対象ありだけ確認し、cancelで保持・approveで対象editorへ移る（write0）', async () => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-list-success'); await page.locator('#product-cloud-items').waitFor();
    await page.locator('#product-cloud-snapshot').getByLabel('検索', { exact: true }).fill('Delta');
    await page.locator('#product-session .cloud-actions .primary').click();
    const editor = page.locator('#product-cloud-editor'), title = page.getByLabel('クラウドのタイトル', { exact: true });
    await title.fill('新規未保存cloud');
    await editor.getByRole('button', { name: '〈 前のメモ', exact: true }).click();
    expect(await editor.getByRole('group', { name: 'クラウド編集を閉じる確認', exact: true }).isVisible()).toBe(false);
    await editor.getByRole('button', { name: '次のメモ 〉', exact: true }).click();
    await editor.getByRole('button', { name: 'クラウド編集を続ける', exact: true }).click();
    expect(await title.inputValue()).toBe('新規未保存cloud'); expect(await page.evaluate('fixture.rpcNames.length')).toBe(1);
    await editor.getByRole('button', { name: '次のメモ 〉', exact: true }).click();
    await editor.getByRole('button', { name: '変更を破棄して移動', exact: true }).click();
    await expect.poll(() => title.inputValue()).toBe('Delta');
    await editor.getByRole('button', { name: '次のメモ 〉', exact: true }).click();
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_load_snapshot']);
    expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    expect(await page.locator('#product-cloud-snapshot').isVisible()).toBe(false);
  } finally { await context.close(); }
}, 15000);

async function fakeProduct(context: BrowserContext, mode: string) {
  await context.addInitScript(mode => Object.assign(window, { fixtureMode: mode }), mode);
  const url = await prepareProductPreview(context, root, false);
  const html = await readFile(new URL('.product/site/tools/memo/memo.html', root), 'utf8');
  await context.route('**/tools/memo/memo.html', route => route.fulfill({ contentType: 'text/html', body: html.replace(/<script type="module"[^>]*><\/script>/, '<script src="/layout-fixture.js"></script>') }));
  await context.route('**/layout-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fake }));
  const page = await context.newPage(); page.setDefaultTimeout(3000); await page.goto(url); return page;
}

it.each([1200, 390, 320])('UAT-01：local/cloudの保存後編集継続・カード主要領域とメニュー分離：幅%s', async width => {
  for (const cloud of [false, true]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    try {
      const page = await fakeProduct(context, cloud ? 'cloud-edit-success' : 'cloud-edit-signed-out');
      if (!cloud) {
        await page.locator('#new').click(); await page.locator('#memo-title').fill('UAT合成メモ'); await page.locator('#memo-body').fill('本文プレビュー');
        await page.locator('#save').click();
        await page.locator('#editor-view .editor-saved').waitFor();
        expect(await page.locator('#editor-view .editor-saved').textContent()).toBe('保存しました');
        expect(await page.locator('#save-status').isVisible()).toBe(false);
        const notice = await page.locator('#editor-view .editor-saved').boundingBox(), save = await page.locator('#save').boundingBox();
        expect(notice!.y + notice!.height).toBeLessThanOrEqual(save!.y);
        await page.screenshot({ path: fileURLToPath(new URL(`.product/uat01-saved-local-${width}.png`, root)) });
        expect(await page.locator('#editor-view').isVisible()).toBe(true);
        expect(await page.locator('#detail-view').isVisible()).toBe(false);
        await page.locator('#memo-body').fill('継続編集'); expect(await page.locator('#editor-view .editor-saved').isVisible()).toBe(false);
        await page.locator('#save').click(); await page.locator('#editor-view .editor-saved').waitFor(); await page.locator('#back').click();
      }
      const rows = page.locator(cloud ? '#product-cloud-items' : '#cards'); await rows.locator('button.open-card').first().waitFor();
      const card = rows.locator('li').first(), open = card.locator('button.open-card');
      expect(await open.locator('.card-preview').count()).toBe(1); expect(await open.locator('time').textContent()).toMatch(/^更新：/);
      expect(await open.locator('time').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
      const before = await page.evaluate('fixture.rpcNames.length');
      // pointer-downだけを観察し、upはカード外へ逃がして遷移させない。
      const hit = (await open.boundingBox())!;
      await page.mouse.move(hit.x + 8, hit.y + 8); await page.mouse.down();
      expect(await open.evaluate(node => ({ focused: document.activeElement === node, visible: node.matches(':focus-visible'), outline: getComputedStyle(node).outlineStyle })))
        .toEqual({ focused: true, visible: false, outline: 'none' });
      await page.mouse.move(0, 0); await page.mouse.up();
      await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      expect(await open.evaluate(node => ({ focused: document.activeElement === node, visible: node.matches(':focus-visible'), outline: getComputedStyle(node).outlineStyle, width: getComputedStyle(node).outlineWidth })))
        .toEqual({ focused: true, visible: true, outline: 'solid', width: '3px' });
      await page.locator('#page-title').click();
      await open.hover(); expect(await open.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
      await page.screenshot({ path: fileURLToPath(new URL(`.product/uat01-cards-${cloud ? 'cloud' : 'local'}-${width}.png`, root)) });
      const closedIcon = await card.locator('summary').boundingBox();
      await card.locator('summary').click();
      expect(await card.locator('summary').boundingBox()).toEqual(closedIcon);
      expect(await card.locator('summary').textContent()).toBe('︙');
      expect(await rows.isVisible()).toBe(true);
      expect(await card.locator('details[open] button').first().evaluate(node => ({ border: getComputedStyle(node).borderTopWidth, radius: getComputedStyle(node).borderRadius }))).toEqual({ border: '0px', radius: '0px' });
      const menuAction = card.locator('details[open] button').first(); await menuAction.hover();
      expect(await menuAction.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
      await card.locator('.card-menu-items').dispatchEvent('click'); expect(await card.locator('details').getAttribute('open')).not.toBeNull();
      await page.locator('#page-title').click(); expect(await card.locator('details').getAttribute('open')).toBeNull();
      expect(await card.locator('summary').boundingBox()).toEqual(closedIcon);
      await open.locator('.card-preview').click();
      if (cloud) {
        const editor = page.locator('#product-cloud-editor');
        await page.getByLabel('クラウドの本文', { exact: true }).fill('保存後も編集する本文'); await editor.getByRole('button', { name: '保存する', exact: true }).click();
        await editor.locator('.editor-saved').waitFor(); expect(await editor.locator('.editor-saved').textContent()).toBe('保存しました');
        const notice = await editor.locator('.editor-saved').boundingBox(), save = await editor.getByRole('button', { name: '保存する', exact: true }).boundingBox();
        expect(notice!.y + notice!.height).toBeLessThanOrEqual(save!.y);
        expect(await editor.isVisible()).toBe(true); expect(await page.evaluate('fixture.calls.writes')).toBe(0);
        await page.mouse.move(0, 0);
        const primary = editor.getByRole('button', { name: '保存する', exact: true });
        expect(await primary.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(39, 94, 157)');
        await primary.hover(); expect(await primary.evaluate(node => ({ bg: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color }))).toEqual({ bg: 'rgb(219, 234, 254)', color: 'rgb(23, 63, 107)' });
        expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save']);
      } else {
        await page.locator('#editor-view').waitFor();
        expect(await page.locator('#detail-view').isVisible()).toBe(false);
        await page.mouse.move(0, 0);
        const styles = async (selector: string) => page.locator(selector).evaluate(node => ({ bg: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color, border: getComputedStyle(node).borderTopColor }));
        expect(await styles('#save')).toEqual(await styles('#new')); expect(await styles('#edit')).toEqual(await styles('#new'));
        await page.locator('#save').hover(); expect((await styles('#save')).bg).toBe('rgb(219, 234, 254)');
        await page.locator('#editor-next').click(); expect(await page.locator('#error').textContent()).toBe('');
        await page.locator('#editor-previous').click(); expect(await page.locator('#error').textContent()).toBe('');
        await page.locator('#back').click(); await rows.locator('button.open-card time').first().click(); await page.locator('#editor-view').waitFor();
        await page.locator('#back').click(); await rows.locator('button.open-card').first().focus(); await page.keyboard.press('Enter');
        await page.locator('#editor-view').waitFor();
        expect(await page.evaluate('fixture.rpcNames.length')).toBe(before);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: fileURLToPath(new URL(`.product/uat01-${cloud ? 'cloud' : 'local'}-${width}.png`, root)) });
    } finally { await context.close(); }
  }
}, 20000);

it.each(['unknown', 'rejected'])('UAT-01：local %sで成功表示せず保存通知とdraftを保持する', async outcome => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out');
    await page.locator('#new').click(); await page.locator('#memo-title').fill('失わないlocal draft');
    await page.evaluate(outcome === 'unknown' ? 'fixture.failWrites()' : 'fixture.failReads(true)');
    await page.locator('#save').click(); await page.locator('#save-status').filter({ hasText: outcome === 'unknown' ? '保存結果は不明' : '拒否' }).waitFor();
    expect(await page.locator('#editor-view .editor-saved').isVisible()).toBe(false);
    expect(await page.locator('#save-status').isVisible()).toBe(true);
    expect(await page.locator('#memo-title').inputValue()).toBe('失わないlocal draft');
    expect(await page.locator('#editor-view').isVisible()).toBe(true);
    expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
  } finally { await context.close(); }
}, 15000);

it.each(['conflict', 'rejected', 'unknown'])('UAT-01：cloud %sで保存しましたを出さず重要通知とdraftを維持する', async outcome => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, `cloud-edit-${outcome}`);
    await page.locator('#product-cloud-items button.open-card').first().click();
    const editor = page.locator('#product-cloud-editor'); await page.getByLabel('クラウドの本文', { exact: true }).fill('失わないdraft');
    await editor.getByRole('button', { name: '保存する', exact: true }).click();
    await page.locator('.cloud-editor-statuses').getByRole('status').filter({ hasText: outcome === 'unknown' ? '保存できたか不明' : '保存は拒否' }).waitFor();
    expect(await editor.locator('.editor-saved').isVisible()).toBe(false);
    expect(await page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('失わないdraft');
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save']);
    expect(await page.evaluate('fixture.calls.writes')).toBe(0);
  } finally { await context.close(); }
}, 15000);

it.each(['local', 'cloud'])('スマホ一覧のタグ検索幅・矢印余白とPC配置を維持する：%s', async mode => {
  for (const width of [320, 390, 650, 1200]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    try {
      const page = await fakeProduct(context, mode === 'cloud' ? 'cloud-assign-edit' : 'cloud-edit-signed-out');
      await page.locator(mode === 'cloud' ? '#product-cloud-items' : '#new').waitFor();
      await expect.poll(() => page.locator('.memo-product').getAttribute('data-page')).toBe('list');
      const controls = page.locator(mode === 'cloud' ? '#product-cloud-snapshot' : '#list-view');
      const search = controls.locator('.tag-search-row input'), reset = controls.locator('.tag-search-row button');
      const select = controls.locator('.sort-control select');
      const metrics = await controls.evaluate(node => {
        const rect = (selector: string) => { const r = node.querySelector(selector)!.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        const style = getComputedStyle(node.querySelector('.sort-control select')!);
        return { input: rect('.tag-search-row input'), manager: rect('.section-heading button'), reset: rect('.tag-search-row button'),
          sort: rect('.sort-control select'), appearance: style.appearance, padding: style.paddingRight,
          arrow: style.backgroundImage, position: style.backgroundPosition, repeat: style.backgroundRepeat };
      });
      expect(metrics.appearance).toBe('none'); expect(metrics.padding).toBe('42px');
      expect(metrics.arrow).toContain('data:image/svg+xml'); expect(metrics.position).toBe('calc(100% - 16px) 50%'); expect(metrics.repeat).toBe('no-repeat');
      if (width <= 650) {
        expect(Math.abs(metrics.reset.right - metrics.manager.right)).toBeLessThanOrEqual(1);
        expect(metrics.reset.top).toBe(metrics.input.top);
        expect(metrics.reset.left - metrics.input.right).toBeGreaterThanOrEqual(10);
        expect(metrics.sort.top).toBeGreaterThan(metrics.reset.bottom);
      } else {
        expect(metrics.reset.top).toBe(metrics.input.top);
        expect(metrics.sort.left).toBe(metrics.reset.left); expect(metrics.sort.right - metrics.sort.left).toBe(250);
      }
      const raw = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
      await search.fill('合成'); await search.fill(''); await reset.click(); await select.selectOption('created-asc');
      expect(await select.inputValue()).toBe('created-asc');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(raw);
      expect(await page.evaluate('fixture.calls.writes')).toBe(0);
      expect(await page.evaluate('fixture.rpcNames')).toEqual(mode === 'cloud' ? ['memo_load_snapshot'] : []);
      await page.screenshot({ path: fileURLToPath(new URL(`.product/final-tag-${mode}-${width}.png`, root)) });
    } finally { await context.close(); }
  }
}, 20000);

it.each(['local', 'cloud'])('一覧の新規作成は青・hoverは薄青で文字コントラストを保つ：%s', async mode => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
  try {
    let page;
    if (mode === 'cloud') page = await fakeProduct(context, 'cloud-assign-edit');
    else { const url = await prepareProductPreview(context, root, false); page = await context.newPage(); await page.goto(url); }
    const create = page.locator(mode === 'cloud' ? '.cloud-actions>button:first-child' : '#new'); await create.waitFor();
    await expect.poll(() => create.isEnabled()).toBe(true);
    await expect.poll(() => page.locator('.memo-product').getAttribute('data-page')).toBe('list');
    await page.mouse.move(0, 0);
    const normal = await create.evaluate(node => ({ bg: getComputedStyle(node).backgroundColor, fg: getComputedStyle(node).color }));
    await page.screenshot({ path: fileURLToPath(new URL(`.product/list-create-normal-${mode}.png`, root)) });
    await create.hover();
    const hover = await create.evaluate(node => ({ bg: getComputedStyle(node).backgroundColor, fg: getComputedStyle(node).color }));
    await page.screenshot({ path: fileURLToPath(new URL(`.product/list-create-hover-${mode}.png`, root)) });
    expect(normal).toEqual({ bg: 'rgb(39, 94, 157)', fg: 'rgb(255, 255, 255)' });
    expect(hover).toEqual({ bg: 'rgb(219, 234, 254)', fg: 'rgb(23, 63, 107)' });
    const luminance = (rgb: string) => rgb.match(/\d+/g)!.map(Number).map(value => { const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i]!, 0);
    for (const colors of [normal, hover]) {
      const a = luminance(colors.bg), b = luminance(colors.fg);
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  } finally { await context.close(); }
}, 15000);

it.each([[320, 568], [390, 667], [568, 320]])('縦に短いスマホでも操作領域をスクロールして一覧へ到達できる：%s×%s', async (width, height) => {
  const context = await browser.newContext({ viewport: { width: width!, height: height! }, serviceWorkers: 'block' });
  try {
    const url = await prepareProductPreview(context, root, false), page = await context.newPage();
    await page.goto(url); await page.locator('#new').waitFor();
    await page.locator('#new').click(); await page.locator('#memo-title').fill('短い画面の合成メモ');
    await page.locator('#save').click(); await waitSavedEditor(page); await page.locator('#back').click();
    const raw = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
    expect(await page.locator('#cards').evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(160);
    const main = page.locator('body > main'), box = await main.boundingBox();
    await page.mouse.move(box!.x + 20, box!.y + 30); await page.mouse.wheel(0, 2000);
    await expect.poll(() => main.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    // 戻る位置によって既にscrollTop>0のことがあるため、非同期wheelの完了を一覧の到達で待つ。
    await expect.poll(async () => { const cards = (await page.locator('#cards').boundingBox())!; return cards.y + cards.height; })
      .toBeLessThanOrEqual(box!.y + box!.height + 1);
    const cards = await page.locator('#cards').boundingBox();
    expect(cards!.y).toBeGreaterThanOrEqual(box!.y);
    expect(cards!.y + cards!.height).toBeLessThanOrEqual(box!.y + box!.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/short-local-${width}-${height}.png`, root)) });
    await page.locator('#cards button.open-card').first().click(); await expect.poll(() => page.locator('#memo-title').inputValue()).toBe('短い画面の合成メモ');
    expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(raw);
  } finally { await context.close(); }
}, 15000);

it.each([[320, 568], [568, 320]])('短いスマホのcloud一覧へも縦スクロールで到達できる：%s×%s', async (width, height) => {
  const context = await browser.newContext({ viewport: { width: width!, height: height! }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-assign-edit'), rows = page.locator('#product-cloud-items');
    await rows.waitFor();
    expect(await rows.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(160);
    const main = page.locator('body > main'), box = await main.boundingBox();
    await page.mouse.move(box!.x + 20, box!.y + 30); await page.mouse.wheel(0, 2000);
    await expect.poll(() => main.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    const list = await rows.boundingBox();
    expect(list!.y).toBeGreaterThanOrEqual(box!.y);
    expect(list!.y + list!.height).toBeLessThanOrEqual(box!.y + box!.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/short-cloud-${width}-${height}.png`, root)) });
    await rows.locator('button.open-card').first().click();
    await page.getByLabel('クラウドのタイトル', { exact: true }).waitFor();
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await page.evaluate('fixture.calls.writes')).toBe(0);
  } finally { await context.close(); }
}, 15000);

it.each([1200, 800, 650, 390, 320])('local切替領域とview別スクロールを保持しスマホ操作をまとめる：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const url = await prepareProductPreview(context, root, false), page = await context.newPage();
    await page.goto(url); await page.locator('#new').waitFor();
    await page.locator('#new').click(); await page.locator('#memo-title').fill('合成スクロール'); await page.locator('#save').click();
    await waitSavedEditor(page);
    await page.evaluate(() => {
      const key = 'myhomepage.memo.data.v2', data = JSON.parse(localStorage.getItem(key)!);
      const seed = data.memos[0];
      data.memos = Array.from({ length: 60 }, (_, index) => ({ ...seed, id: crypto.randomUUID(), title: `合成 ${index}`, lastRequestId: null,
        deletedAt: index < 30 ? null : seed.updatedAt }));
      localStorage.setItem(key, JSON.stringify(data));
    });
    await page.reload(); await page.locator('#cards li').first().waitFor();
    expect(await page.locator('body > footer').isVisible()).toBe(true);
    expect(await page.locator('body > footer').count()).toBe(1);
    expect(await page.locator('body > footer .footer-title').textContent()).toBe('Kana Tsuichihara Portfolio');
    if (width <= 650) expect(await page.locator('body > footer').evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual(80);
    const raw = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
    const toggle = await page.locator('#trash-view').boundingBox(), top = await page.locator('#cards').evaluate(node => node.getBoundingClientRect().top);
    await page.locator('#cards').evaluate(node => { node.scrollTop = 420; });
    await page.locator('#trash-view').click(); await page.locator('#count').filter({ hasText: 'ゴミ箱' }).waitFor();
    expect(await page.locator('#normal-view').boundingBox()).toEqual(toggle);
    expect(await page.locator('#cards').evaluate(node => node.scrollTop)).toBe(0);
    expect(await page.locator('#cards').evaluate(node => node.getBoundingClientRect().top)).toBe(top);
    await page.locator('#cards').evaluate(node => { node.scrollTop = 230; });
    await page.locator('#normal-view').click(); await page.locator('#count').filter({ hasText: '通常メモ' }).waitFor();
    await expect.poll(() => page.locator('#cards').evaluate(node => node.scrollTop)).toBe(420);
    expect(await page.locator('#trash-view').boundingBox()).toEqual(toggle);
    await page.locator('#search').fill('合成'); await page.locator('#sort').selectOption('created-asc');
    await page.locator('#trash-view').click(); await page.locator('#count').filter({ hasText: 'ゴミ箱' }).waitFor();
    await expect.poll(() => page.locator('#cards').evaluate(node => node.scrollTop)).toBe(230);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(raw);
    const group = page.getByRole('group', { name: '一覧の操作', exact: true });
    expect(await group.getByRole('button', { name: '通常一覧', exact: true }).isVisible()).toBe(true);
    expect(await group.getByRole('button', { name: 'バックアップ・復元', exact: true }).isVisible()).toBe(true);
    expect(await group.getByRole('button', { name: '再読み込み', exact: true }).isVisible()).toBe(true);
    if (width <= 650) {
      expect(await page.locator('#list-voice-slot button').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(189, 40, 59)');
      expect(await page.locator('#list-voice-slot button').evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      const result = await page.evaluate(() => {
        const r = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        return { caption: getComputedStyle(document.querySelector('.sort-caption')!).fontWeight,
          heading: getComputedStyle(document.querySelector('.tag-controls h2')!).fontWeight,
          select: r('#sort').left, clear: r('#clear-tag-filters').left,
          tap: Array.from(document.querySelectorAll('.list-operation-group button:not([hidden])')).every(node => node.getBoundingClientRect().height >= 44),
          headerBottom: r('.tag-controls .section-heading').bottom, searchTop: r('.tag-search-row').top, searchBottom: r('.tag-search-row').bottom,
          tagsTop: r('.tag-chip-strip').top, tagsBottom: r('.tag-chip-strip').bottom, sortTop: r('.sort-caption').top };
      });
      expect(result.caption).toBe(result.heading); expect(result.tap).toBe(true);
      expect(await page.locator('#page-title').evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(40);
      expect(result.searchTop).toBeGreaterThanOrEqual(result.headerBottom);
      expect(result.tagsTop).toBeGreaterThanOrEqual(result.searchBottom);
      expect(result.sortTop).toBeGreaterThanOrEqual(result.tagsBottom);
    }
    await page.screenshot({ path: fileURLToPath(new URL(`.product/switch-local-${width}.png`, root)) });
  } finally { await context.close(); }
}, 15000);

it.each([1200, 390, 320])('cloud既存ListContextの切替位置・スクロールを維持する：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-list-scroll-views');
    const rows = page.locator('#product-cloud-items'); await rows.waitFor();
    const toggle = await page.getByRole('button', { name: 'ゴミ箱', exact: true }).boundingBox();
    await rows.evaluate(node => { node.scrollTop = 420; });
    await page.getByRole('button', { name: 'ゴミ箱', exact: true }).click();
    expect(await page.getByRole('button', { name: '通常一覧', exact: true }).boundingBox()).toEqual(toggle);
    await rows.evaluate(node => { node.scrollTop = 230; });
    await page.getByRole('button', { name: '通常一覧', exact: true }).click();
    await expect.poll(() => rows.evaluate(node => node.scrollTop)).toBe(420);
    await page.getByRole('button', { name: 'ゴミ箱', exact: true }).click();
    await expect.poll(() => rows.evaluate(node => node.scrollTop)).toBe(230);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await page.evaluate('fixture.calls.writes')).toBe(0);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/switch-cloud-${width}.png`, root)) });
  } finally { await context.close(); }
}, 15000);

it('headed cloud製品画面も6幅で追従し、PC7項目とスマホ境界を維持する', async () => {
  const headed = await chromium.launch({ headless: false, proxy: { server: 'http://127.0.0.1:9' } });
  const context = await headed.newContext({ viewport: null, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-assign-edit');
    await page.locator('#product-cloud-items').waitFor();
    const cdp = await context.newCDPSession(page), { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    const samples = [];
    for (const width of [1200, 992, 900, 800, 651, 650, 390]) {
      const frame = await page.evaluate(() => outerWidth - innerWidth);
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: width + frame, height: 950 } });
      await page.waitForTimeout(150);
      const nativeWidth = await page.evaluate(() => innerWidth), emulated = nativeWidth !== width;
      if (emulated) {
        expect(width).toBe(390);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: false });
      }
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
      await page.screenshot({ path: fileURLToPath(new URL(`.product/width-cloud-${width}.png`, root)) });
      const sample = await page.evaluate(({ width, nativeWidth, emulated }) => {
        const rect = (selector: string) => { const node = document.querySelector(selector); if (!node) throw new Error(`Missing layout element: ${selector}`); const r = node.getBoundingClientRect(); return { width: r.width, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
        return { width, nativeWidth, emulated, scroll: document.documentElement.scrollWidth,
          roots: ['body', 'main', '.memo-page', '.memo-product'].map(rect),
          controls: ['.cloud-actions', '#product-cloud-snapshot .list-controls', '#product-cloud-snapshot .memo-search', '#product-cloud-snapshot .tag-search-row', '#product-cloud-snapshot .sort-control select'].map(rect),
          heading: rect('#product-cloud-snapshot .tag-controls h2'), manager: rect('#product-cloud-snapshot .tag-controls .section-heading button'),
          search: rect('#product-cloud-snapshot .tag-search-row'), clear: rect('#product-cloud-snapshot .tag-search-row button'), sort: rect('#product-cloud-snapshot .sort-control select'),
          caption: rect('#product-cloud-snapshot .pc-sort-caption'),
          bold: style('#product-cloud-snapshot .pc-sort-caption').fontWeight, headingBold: style('#product-cloud-snapshot .tag-controls h2').fontWeight,
          sortPadding: parseFloat(style('#product-cloud-snapshot .sort-control select').paddingRight), voiceColor: style('.cloud-actions .voice-memo-button').backgroundColor };
      }, { width, nativeWidth, emulated });
      expect(sample.scroll).toBeLessThanOrEqual(width);
      for (const box of [...sample.roots, ...sample.controls]) { expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width); }
      expect(await page.locator('#product-auth-open').textContent()).toBe('ログアウト / 保存先：クラウド');
      expect(await page.locator('.cloud-actions .voice-memo-button [aria-hidden=true]').textContent()).toBe('🎙');
      if (width > 650) {
        expect(sample.voiceColor).toBe('rgb(189, 40, 59)'); expect(sample.sortPadding).toBeGreaterThanOrEqual(40);
        expect(sample.manager.left).toBeGreaterThan(sample.heading.right);
        expect(sample.sort.left).toBe(sample.clear.left); expect(sample.caption.right).toBeLessThan(sample.sort.left); expect(sample.bold).toBe(sample.headingBold);
        expect(sample.search.top - sample.manager.bottom).toBeGreaterThanOrEqual(12);
      }
      samples.push(sample); await page.screenshot({ path: fileURLToPath(new URL(`.product/width-cloud-${width}.png`, root)) });
      if (emulated) await cdp.send('Emulation.clearDeviceMetricsOverride');
    }
    await writeFile(new URL('.product/width-cloud.json', root), JSON.stringify(samples, null, 2));
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await page.evaluate('fixture.calls.writes')).toBe(0);
  } finally { await context.close(); await headed.close(); }
}, 20000);

it.each(['local', 'cloud'])('スマホ一覧では成功通知だけを次の明示操作で閉じる：%s', async mode => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, mode === 'cloud' ? 'cloud-assign-edit' : 'cloud-edit-signed-out');
    await page.locator(mode === 'cloud' ? '#product-cloud-items' : '#new').waitFor();
    for (const operation of ['click', 'input']) {
      // 通知の結果分類は変更せず、layoutのdismiss対象だけを確認する。
      await page.evaluate(() => {
        document.getElementById('notice-probe')?.remove();
        const group = document.createElement('div'); group.id = 'notice-probe';
        for (const kind of ['succeeded', 'rejected', 'unknown']) {
          const p = document.createElement('p'); p.dataset.notice = kind; p.textContent = `通知：${kind}`; group.append(p);
        }
        document.querySelector('.memo-product')!.append(group);
      });
      const success = page.locator('#notice-probe [data-notice=succeeded]');
      expect(await success.isVisible()).toBe(true);
      if (operation === 'click') {
        await page.locator('#product-auth-open').click();
        await page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true }).getByRole('button', { name: '閉じる', exact: true }).click();
      } else await (mode === 'cloud' ? page.locator('#product-cloud-snapshot').getByLabel('検索', { exact: true }) : page.locator('#search')).fill('確認');
      expect(await success.isVisible()).toBe(false);
      expect(await page.locator('#notice-probe [data-notice=rejected]').isVisible()).toBe(true);
      expect(await page.locator('#notice-probe [data-notice=unknown]').isVisible()).toBe(true);
    }
    expect(await page.evaluate('fixture.calls.writes')).toBe(0);
  } finally { await context.close(); }
}, 15000);

it.each([1440, 390, 320])('定型通知を省略してもlocal/cloudのエラー・UNKNOWNは操作後も表示する：幅%s', async width => {
  for (const failure of ['unknown', 'rejected', 'cloud']) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    try {
      const page = await fakeProduct(context, failure === 'cloud' ? 'cloud-failure' : 'cloud-edit-signed-out');
      if (failure !== 'cloud') {
        await page.locator('#new').waitFor();
        expect(await page.locator('#memo-app .statuses').isVisible()).toBe(false);
        await page.evaluate(failure === 'unknown' ? 'fixture.failWrites()' : 'fixture.failReads(true)'); await page.evaluate('fixture.saveTag()');
        await page.locator('#save-status').filter({ hasText: failure === 'unknown' ? '保存結果は不明' : '拒否' }).waitFor();
        await page.locator('#product-auth-open').click();
        await page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true }).getByRole('button', { name: '閉じる', exact: true }).click();
        expect(await page.locator('#save-status').isVisible()).toBe(true);
      } else {
        await page.locator('#product-cloud-state').filter({ hasText: 'UNKNOWN' }).waitFor();
        await page.locator('#product-auth-open').click();
        await page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true }).getByRole('button', { name: '閉じる', exact: true }).click();
        expect(await page.locator('#product-cloud-state').isVisible()).toBe(true);
        expect(await page.locator('#product-cloud-trash-state').isVisible()).toBe(false);
      }
    } finally { await context.close(); }
  }
}, 15000);

it('cloudの明示再読取では古い成功案内だけを片付ける', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-pin');
    await page.locator('#product-cloud-items summary').first().click();
    await page.locator('#product-cloud-items details').first().getByRole('button', { name: 'ピン留め', exact: true }).click();
    await page.locator('#product-cloud-trash-state').filter({ hasText: '要求の成功を確認' }).waitFor();
    await page.getByRole('button', { name: '再読み込み', exact: true }).click();
    await page.locator('#product-cloud-items').waitFor();
    expect(await page.locator('#product-cloud-trash-state').textContent()).toBe('');
    expect(await page.locator('#product-cloud-trash-state').isVisible()).toBe(false);
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_change_state', 'memo_load_snapshot']);
  } finally { await context.close(); }
}, 15000);

it.each([1200, 650, 390, 320])('編集の定型通知だけを隠しスマホは上段2操作・下段一覧へにする：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out'); await page.locator('#new').waitFor();
    const order = async () => {
      const boxes = await page.evaluate(() => {
        const rect = (selector: string) => { const node = document.querySelector(selector)!; const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, fits: node.scrollWidth <= node.clientWidth }; };
        return { back: rect('#back'), backup: rect('[data-open-dialog=backup-dialog]'), reload: rect('#reload') };
      });
      if (width <= 650) {
        expect(boxes.reload.top).toBe(boxes.backup.top);
        expect(boxes.reload.left - boxes.backup.right).toBeGreaterThanOrEqual(8);
        expect(Math.max(boxes.reload.bottom, boxes.backup.bottom)).toBeLessThan(boxes.back.top);
      } else {
        expect(boxes.backup.top).toBe(boxes.reload.top); expect(boxes.backup.left).toBeLessThan(boxes.reload.left);
      }
      expect(boxes.reload.fits).toBe(true); expect(boxes.backup.fits).toBe(true); expect(boxes.back.fits).toBe(true);
      expect(await page.locator('body > footer').isVisible()).toBe(true);
      expect(await page.locator('body > footer').count()).toBe(1);
      expect(await page.locator('body > footer .footer-title').textContent()).toBe('Kana Tsuichihara Portfolio');
      if (width <= 650) expect(await page.locator('body > footer').evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual(80);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    };
    const initialOrder = await page.locator('#memo-app .list-operation-group').evaluate(node => getComputedStyle(node).flexDirection);
    await page.locator('#new').click();
    await expect.poll(() => page.locator('.memo-product').getAttribute('data-page')).toBe('edit');
    expect(await page.locator('#save-status').textContent()).toBe('まだ保存操作は行っていません。');
    expect(await page.locator('#save-status').isVisible()).toBe(false);
    expect(await page.locator('#read-status').isVisible()).toBe(false);
    await order();
    await page.locator('#memo-title').fill('未保存の合成メモ'); await page.locator('#memo-body').fill('保持する本文');
    expect(await page.locator('#draft-status').isVisible()).toBe(true);
    await page.locator('#back').click(); await page.locator('#confirmation').waitFor(); await page.locator('#confirm-no').click();
    expect(await page.locator('#memo-body').inputValue()).toBe('保持する本文');
    await page.locator('#editor-voice-slot button').click();
    expect(await page.getByRole('status').filter({ hasText: 'このブラウザは音声入力に対応していません。' }).isVisible()).toBe(true);
    await page.getByRole('button', { name: 'バックアップ・復元', exact: true }).click();
    const backup = page.getByRole('dialog', { name: 'バックアップ・復元', exact: true });
    expect(await backup.isVisible()).toBe(true); await backup.getByRole('button', { name: 'バックアップ・復元を閉じる', exact: true }).click();
    expect(await page.locator('#memo-body').inputValue()).toBe('保持する本文');
    expect(await page.evaluate('fixture.calls.writes')).toBe(0);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/mobile-editor-notice-order-${width}.png`, root)) });
    await page.locator('#save').click(); await waitSavedEditor(page);
    await expect.poll(() => page.locator('.memo-product').getAttribute('data-page')).toBe('edit'); await order();
    await page.screenshot({ path: fileURLToPath(new URL(`.product/mobile-detail-two-actions-${width}.png`, root)) });
    await page.locator('#back').click(); await page.locator('#list-view').waitFor();
    await expect.poll(() => page.locator('.memo-product').getAttribute('data-page')).toBe('list');
    expect(await page.locator('#memo-app .list-operation-group').evaluate(node => getComputedStyle(node).flexDirection)).toBe(initialOrder);
    await page.locator('#reload').click(); await page.locator('#cards button.open-card').first().waitFor();
    expect(await page.evaluate('fixture.calls.writes')).toBe(1); expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
}, 15000);

it.each([1200, 390, 320])('編集通知の抑制後も実fake保存のエラー/拒否/UNKNOWNを表示する：幅%s', async width => {
  for (const failure of ['invalid', 'rejected', 'unknown']) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    try {
      const page = await fakeProduct(context, 'cloud-edit-signed-out'); await page.locator('#new').waitFor(); await page.locator('#new').click();
      await page.locator('#memo-title').fill(failure === 'invalid' ? 'あ'.repeat(101) : '合成メモ'); await page.locator('#memo-body').fill('残す本文');
      if (failure !== 'invalid') await page.evaluate(failure === 'unknown' ? 'fixture.failWrites()' : 'fixture.failReads(true)');
      await page.locator('#save').click();
      const notice = page.locator(failure === 'invalid' ? '#error' : '#save-status');
      await notice.filter({ hasText: failure === 'invalid' ? '入力を確認' : failure === 'unknown' ? '保存結果は不明' : '拒否' }).waitFor();
      expect(await notice.isVisible()).toBe(true);
      expect(await page.locator('#memo-app .statuses').isVisible()).toBe(true);
      expect(await page.locator('#memo-body').inputValue()).toBe('残す本文');
      await page.screenshot({ path: fileURLToPath(new URL(`.product/mobile-editor-${failure}-${width}.png`, root)) });
      expect(await page.evaluate('fixture.calls.writes')).toBe(failure === 'unknown' ? 1 : 0);
      expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
    } finally { await context.close(); }
  }
}, 15000);

it.each(['local', 'cloud'])('全幅の編集画面で上部ナビと左右の停止/保存・前回表示を維持する：%s', async mode => {
  for (const width of [1200, 900, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    try {
      const page = await fakeProduct(context, mode === 'local' ? 'cloud-voice-existing-signed-out' : 'cloud-voice-existing');
      if (mode === 'local') { await page.locator('#new').waitFor(); await page.locator('#new').click(); }
      else { await page.locator('#product-cloud-items').waitFor(); await page.locator('#product-cloud-items button.open-card').first().click(); }
      const editor = page.locator(mode === 'local' ? '#editor-view' : '#product-cloud-editor'); await editor.waitFor();
      const title = mode === 'local' ? page.locator('#memo-title') : page.getByLabel('クラウドのタイトル', { exact: true });
      const body = mode === 'local' ? page.locator('#memo-body') : page.getByLabel('クラウドの本文', { exact: true });
      await title.fill('配置確認'); await body.fill('保存する本文');
      const rect = async (selector: string) => editor.locator(selector).evaluate(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
      if (mode === 'local') {
        const previous = await rect('#editor-previous'), duplicate = await rect('#editor-duplicate'), next = await rect('#editor-next');
        expect(previous.left).toBeLessThan(duplicate.left); expect(duplicate.right).toBeLessThan(next.left);
        expect(previous.top).toBe(next.top); expect(next.right).toBe((await rect(':scope>.detail-actions')).right);
        expect((await rect('#memo-form>label')).top - next.bottom).toBeGreaterThanOrEqual(14);
        expect(await page.getByRole('button', { name: '< 一覧へ', exact: true }).isVisible()).toBe(true);
        expect(await page.locator('#lengths').isVisible()).toBe(false); expect(await editor.locator('.editor-footer>p').isVisible()).toBe(false);
      } else expect(await page.locator('.cloud-list-navigation').getByRole('button', { name: '< 一覧へ', exact: true }).isVisible()).toBe(true);
      expect(await editor.locator('.editor-tag-hint').evaluate(node => getComputedStyle(node).fontSize)).toBe('12px');
      const voice = editor.getByRole('button', { name: '音声で本文へ追記', exact: true });
      await page.mouse.move(0, 0); expect(await voice.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(189, 40, 59)');
      const voiceBox = (await voice.boundingBox())!, note = await rect('.voice-service-notice');
      expect(voiceBox.height).toBeLessThanOrEqual(50);
      expect(note.top).toBeGreaterThanOrEqual(voiceBox.y + voiceBox.height);
      expect(note.bottom).toBeLessThanOrEqual((await body.boundingBox())!.y);
      const footer = editor.locator('.editor-footer');
      const stop = footer.getByRole('button', { name: '音声入力を停止', exact: true }), save = footer.getByRole('button', { name: '保存する', exact: true });
      const a = (await stop.boundingBox())!, b = (await save.boundingBox())!, f = (await footer.boundingBox())!;
      expect(a.y).toBe(b.y); expect(a.x).toBe(f.x); expect(b.x + b.width).toBe(f.x + f.width);
      expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(12);
      for (const button of [stop, save]) expect(await button.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await editor.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate('fixture.calls.writes')).toBe(0);
      expect(await page.evaluate('fixture.rpcNames')).toEqual(mode === 'cloud' ? ['memo_load_snapshot'] : []);
      await editor.evaluate(node => { node.scrollTop = 0; });
      await page.screenshot({ path: fileURLToPath(new URL(`.product/editor-actions-top-${mode}-${width}.png`, root)) });
      await voice.click(); await expect.poll(() => stop.isEnabled()).toBe(true);
      await stop.click(); expect(await page.evaluate('fixture.voiceCalls.start')).toBe(1); expect(await page.evaluate('fixture.voiceCalls.abort')).toBe(1);
      await save.scrollIntoViewIfNeeded(); await page.screenshot({ path: fileURLToPath(new URL(`.product/editor-actions-${mode}-${width}.png`, root)) });
      await save.click();
      if (mode === 'local') { await waitSavedEditor(page); expect(await page.evaluate('fixture.calls.writes')).toBe(1); }
      else { await editor.locator('.editor-saved').waitFor(); expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_save']); expect(await page.evaluate('fixture.calls.writes')).toBe(0); }
      expect(await page.evaluate('fixture.calls.fetch')).toBe(0);
    } finally { await context.close(); }
  }
}, 25000);

it.each([1200, 900, 651, 390])('長いゴミ箱本文は読取専用詳細内をスクロールして読める：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 800 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out'); await page.locator('#new').waitFor();
    const content = Array.from({ length: 100 }, (_, index) => `長文${index}：${'折り返す本文'.repeat(10)}`).join('\n');
    await page.locator('#new').click(); await page.locator('#memo-title').fill('長文の合成メモ'); await page.locator('#memo-body').fill(content);
    await page.locator('#save').click(); await waitSavedEditor(page);
    await page.locator('#back').click(); await page.locator('#cards summary').first().click();
    await page.locator('#cards').getByRole('button', { name: 'ゴミ箱へ', exact: true }).click();
    await page.locator('#confirm-yes').click(); await page.locator('#trash-view').click();
    await page.locator('#cards button.open-card').first().click(); await page.locator('#detail-view').waitFor();
    const before = await page.evaluate('fixture.calls.writes');
    const metrics = await page.locator('#detail-view').evaluate(node => {
      const body = node.querySelector('#detail-body')!, rect = body.getBoundingClientRect();
      return { height: rect.height, bottom: rect.bottom, client: body.clientHeight, scroll: body.scrollHeight,
        editing: node.querySelector('#edit')!.getBoundingClientRect().top,
        voice: node.querySelector('#detail-voice-slot')!.getBoundingClientRect().top,
        nav: node.querySelector('#previous')!.getBoundingClientRect().top, viewport: node.clientHeight };
    });
    expect(metrics.height).toBeGreaterThan(metrics.viewport); expect(metrics.scroll).toBeLessThanOrEqual(metrics.client + 1);
    expect(metrics.bottom).toBeLessThanOrEqual(metrics.editing); expect(metrics.bottom).toBeLessThanOrEqual(metrics.voice);
    if (width > 650) expect(metrics.bottom).toBeLessThanOrEqual(metrics.nav);
    expect(await page.locator('#detail-body').textContent()).toBe(content); expect(await page.locator('#edit').isDisabled()).toBe(true);
    expect(await page.locator('#editor-view').isVisible()).toBe(false);
    await page.locator('#edit').scrollIntoViewIfNeeded(); expect(await page.locator('#detail-view').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/long-trash-detail-${width}.png`, root)) });
    expect(await page.evaluate('fixture.calls.writes')).toBe(before);
    expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
  } finally { await context.close(); }
}, 15000);

it.each([1200, 900, 390])('local編集のPC表示とスマホ・保存後edit継続を維持する：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out'); await page.locator('#new').waitFor();
    await page.locator('#new').click(); await page.locator('#memo-title').fill('PC表示のメモ'); await page.locator('#memo-body').fill('本文');
    await page.locator('#save').click(); await waitSavedEditor(page);
    const before = await page.evaluate('fixture.calls.writes');
    expect(await page.getByRole('button', { name: '〈 前のメモ', exact: true }).count()).toBe(1);
    expect(await page.getByRole('button', { name: '次のメモ 〉', exact: true }).count()).toBe(1);
    const rect = async (selector: string) => page.locator(selector).evaluate(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    expect(await page.getByRole('button', { name: '< 一覧へ', exact: true }).isVisible()).toBe(true);
    expect(await page.locator('#detail-view').isVisible()).toBe(false);
    const voice = page.locator('#editor-voice-slot button');
    await page.mouse.move(0, 0);
    expect(await voice.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(189, 40, 59)');
    expect(await page.locator('#lengths').isVisible()).toBe(false);
    expect(await page.locator('.editor-footer>p').isVisible()).toBe(false);
    if (width > 650) {
      const previous = await rect('#editor-previous'), duplicate = await rect('#editor-duplicate'), next = await rect('#editor-next');
      expect(previous.left).toBeLessThan(duplicate.left); expect(duplicate.right).toBeLessThan(next.left);
      expect(next.right).toBe((await rect('#editor-view>.detail-actions')).right);
      expect((await rect('#memo-form>label')).top - (await rect('#editor-view>.detail-actions')).bottom).toBeGreaterThanOrEqual(14);
      expect(await page.locator('#memo-form .editor-tag-hint').evaluate(node => getComputedStyle(node).fontSize)).toBe('12px');
      const note = await rect('#editor-voice-controls-slot .voice-service-notice');
      expect(note.top).toBeGreaterThanOrEqual((await rect('#editor-voice-slot')).bottom);
      expect(note.bottom).toBeLessThanOrEqual((await rect('#memo-body')).top);
      expect(await voice.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(await page.locator('#list-voice-slot button').evaluate(node => getComputedStyle(node).backgroundColor));
      expect(await voice.evaluate(node => ({ color: getComputedStyle(node).color, border: getComputedStyle(node).borderColor }))).toEqual(
        await page.locator('#list-voice-slot button').evaluate(node => ({ color: getComputedStyle(node).color, border: getComputedStyle(node).borderColor })));
      await voice.hover(); expect(await voice.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(159, 32, 49)');
      await page.mouse.move(0, 0);
    } else {
      expect(await page.locator('#editor-next').evaluate(node => getComputedStyle(node).order)).toBe('0');
      expect((await rect('#editor-voice-controls-slot .voice-service-notice')).bottom).toBeLessThanOrEqual((await rect('#memo-body')).top);
    }
    expect(await page.evaluate('fixture.calls.writes')).toBe(before);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/pc-editor-local-${width}.png`, root)) });
    if (width > 650) { await page.locator('#editor-next').scrollIntoViewIfNeeded(); await page.screenshot({ path: fileURLToPath(new URL(`.product/pc-editor-nav-local-${width}.png`, root)) }); }
    await page.locator('#memo-title').fill('あ'.repeat(101)); await page.locator('#save').click();
    await page.locator('#error').filter({ hasText: '入力を確認' }).waitFor();
    expect(await page.evaluate('fixture.calls.writes')).toBe(before);
    await page.locator('#memo-title').fill('未保存の変更'); await page.locator('#back').click();
    await page.locator('#confirmation').waitFor(); await page.locator('#confirm-no').click();
    expect(await page.locator('#memo-title').inputValue()).toBe('未保存の変更');
    expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
  } finally { await context.close(); }
}, 15000);

it.each([1200, 390])('cloudゴミ箱詳細と通常メモの複製編集・スマホ表示を維持する：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-assign-edit-success'); await page.locator('#product-cloud-items').waitFor();
    await page.getByRole('button', { name: 'ゴミ箱', exact: true }).click();
    await page.locator('#product-cloud-items button.open-card').first().click();
    const snapshotRoot = page.locator('#product-cloud-snapshot');
    if (width > 650) {
      const previous = await snapshotRoot.getByRole('button', { name: '〈 前のメモ', exact: true }).boundingBox();
      const next = await snapshotRoot.getByRole('button', { name: '次のメモ 〉', exact: true }).boundingBox();
      expect(previous!.x).toBeLessThan(next!.x);
      expect(Math.abs(previous!.y - next!.y)).toBeLessThanOrEqual(1);
      expect(await snapshotRoot.getByRole('button', { name: '< 一覧へ', exact: true }).isVisible()).toBe(true);
    } else expect(await snapshotRoot.getByRole('button', { name: 'クラウド一覧へ戻る', exact: true }).isVisible()).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/pc-detail-cloud-${width}.png`, root)) });
    await snapshotRoot.getByRole('button', { name: width > 650 ? '< 一覧へ' : 'クラウド一覧へ戻る', exact: true }).click();
    await page.getByRole('button', { name: '通常一覧', exact: true }).click();
    await page.locator('#product-cloud-items summary').first().click();
    await page.locator('#product-cloud-items details').first().getByRole('button', { name: '複製', exact: true }).click();
    const editor = page.locator('#product-cloud-editor'); await editor.waitFor();
    const voice = editor.getByRole('button', { name: '音声で本文へ追記', exact: true });
    await page.mouse.move(0, 0);
    expect(await voice.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(189, 40, 59)');
    if (width > 650) {
      expect(await editor.locator('.editor-tag-hint').evaluate(node => getComputedStyle(node).fontSize)).toBe('12px');
      expect(await editor.locator('.memo-editor-form').evaluate(node => getComputedStyle(node).paddingTop)).toBe('14px');
      const note = await editor.locator('.voice-service-notice').boundingBox();
      const body = await page.getByLabel('クラウドの本文', { exact: true }).boundingBox();
      expect(note!.y + note!.height).toBeLessThanOrEqual(body!.y);
      await page.locator('.cloud-list-navigation').getByRole('button', { name: '< 一覧へ', exact: true }).click();
    } else await page.locator('.cloud-list-navigation').getByRole('button', { name: '< 一覧へ', exact: true }).click();
    await editor.getByRole('button', { name: 'クラウド編集を続ける', exact: true }).click();
    expect(await page.getByLabel('クラウドのタイトル', { exact: true }).inputValue()).toContain('クラウド');
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/pc-editor-cloud-${width}.png`, root)) });
    await editor.evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: fileURLToPath(new URL(`.product/pc-editor-top-cloud-${width}.png`, root)) });
  } finally { await context.close(); }
}, 15000);

it.each(['local', 'cloud'])('スマホのタグ列タイトルと名前/件数を同じ行に揃えPC配置を維持する：%s', async mode => {
  for (const width of [1200, 650, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    try {
      const page = await fakeProduct(context, mode === 'cloud' ? 'cloud-tag-delete-success' : 'cloud-edit-signed-out');
      await page.locator(mode === 'cloud' ? '#product-cloud-items' : '#new').waitFor();
      await page.getByRole('button', { name: 'タグ管理', exact: true }).last().click();
      const dialog = page.getByRole('dialog', { name: mode === 'cloud' ? 'クラウドタグ管理' : 'タグ管理', exact: true });
      if (mode === 'local') {
        await dialog.getByLabel('新規タグ名').fill('長いタグ名'.repeat(6));
        await dialog.getByRole('button', { name: '＋追加', exact: true }).click();
      }
      const row = dialog.locator('.tag-manager-row').first(); await row.waitFor();
      expect(await dialog.locator('.tag-manager-columns').isVisible()).toBe(true);
      expect(await dialog.locator('.tag-manager-columns').allTextContents()).toEqual(['タグ名使用メモ数']);
      const metrics = await dialog.evaluate(node => {
        const rect = (selector: string) => { const r = node.querySelector(selector)!.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, center: (r.top + r.bottom) / 2 }; };
        const style = getComputedStyle(node.querySelector('.tag-manager-columns')!);
        return { headerName: rect('.tag-manager-columns>span:first-child'), headerCount: rect('.tag-manager-columns>span:nth-child(2)'),
          name: rect('.tag-manager-row>span:first-child'), count: rect('.tag-manager-row>span:nth-child(2)'),
          edit: rect('.tag-manager-row>button'), search: rect('input[type=search]'),
          font: style.fontSize, color: style.color, overflow: node.scrollWidth > node.clientWidth };
      });
      expect(metrics.font).toBe('13px'); expect(metrics.color).toBe('rgb(104, 118, 138)');
      expect(metrics.headerName.top).toBeGreaterThan(metrics.search.bottom);
      expect(Math.abs(metrics.name.left - metrics.headerName.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.count.left - metrics.headerCount.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.name.center - metrics.count.center)).toBeLessThanOrEqual(1);
      expect(metrics.overflow).toBe(false);
      if (width <= 650) expect(metrics.edit.top).toBeGreaterThanOrEqual(Math.max(metrics.name.bottom, metrics.count.bottom));
      else expect(Math.abs(metrics.edit.center - metrics.name.center)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: fileURLToPath(new URL(`.product/tag-columns-${mode}-${width}.png`, root)) });
      const before = await page.evaluate('fixture.rpcNames.slice()');
      const writes = await page.evaluate('fixture.calls.writes');
      await row.getByRole('button', { name: '編集', exact: true }).click();
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: fileURLToPath(new URL(`.product/tag-columns-edit-${mode}-${width}.png`, root)) });
      await row.getByRole('button', { name: 'キャンセル', exact: true }).click();
      expect(await page.evaluate('fixture.rpcNames.slice()')).toEqual(before);
      expect(await page.evaluate('fixture.calls.writes')).toBe(writes);
      expect(await page.evaluate('fixture.calls.fetch')).toBe(0);
    } finally { await context.close(); }
  }
}, 20000);

it.each(['local', 'cloud'])('タグ管理の見出し階層と2領域の余白・短い説明文を揃える：%s', async mode => {
  for (const width of [1200, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    try {
      const page = await fakeProduct(context, mode === 'cloud' ? 'cloud-tag-delete-success' : 'cloud-edit-signed-out');
      await page.locator(mode === 'cloud' ? '#product-cloud-items' : '#new').waitFor();
      await page.getByRole('button', { name: 'タグ管理', exact: true }).last().click();
      const dialog = page.getByRole('dialog', { name: mode === 'cloud' ? 'クラウドタグ管理' : 'タグ管理', exact: true });
      const metrics = await dialog.evaluate(node => {
        const sections = node.querySelectorAll('.tag-manager-content>section');
        const gap = (section: Element) => section.querySelector('input')!.getBoundingClientRect().top - section.querySelector('h3')!.getBoundingClientRect().bottom;
        return { title: getComputedStyle(node.querySelector('.dialog-heading h2')!).fontSize,
          sub: getComputedStyle(sections[0]!.querySelector('h3')!).fontSize,
          createGap: gap(sections[0]!), registeredGap: gap(sections[1]!), overflow: node.scrollWidth > node.clientWidth };
      });
      expect(metrics.title).toBe('22px'); expect(metrics.sub).toBe('17px');
      expect(metrics.createGap).toBeGreaterThanOrEqual(14);
      expect(Math.abs(metrics.createGap - metrics.registeredGap)).toBeLessThanOrEqual(1);
      expect(metrics.overflow).toBe(false);
      const notice = dialog.locator('.tag-manager-content>p');
      expect(await notice.textContent()).toBe('タグ削除時は関連する全メモ（ゴミ箱内を含む）からタグを外します。');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: fileURLToPath(new URL(`.product/tag-dialog-final-${mode}-${width}.png`, root)) });
      await dialog.getByRole('button', { name: 'タグ管理を閉じる', exact: true }).click();
      expect(await dialog.isVisible()).toBe(false);
      expect(await page.evaluate('fixture.rpcNames')).toEqual(mode === 'cloud' ? ['memo_load_snapshot'] : []);
      expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    } finally { await context.close(); }
  }
}, 15000);

it.each([1200, 390, 320])('localタグ管理は上部追加・行編集/取消・検索・既存削除確認を使う：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out'); await page.locator('#new').waitFor();
    await page.getByRole('button', { name: 'タグ管理', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'タグ管理', exact: true });
    expect(await dialog.getByRole('button', { name: '閉じる', exact: true }).count()).toBe(0);
    const create = dialog.getByRole('region', { name: 'タグの新規作成', exact: true });
    for (const name of ['仕事', '勉強']) {
      await create.getByLabel('新規タグ名').fill(name); await create.getByRole('button', { name: '＋追加', exact: true }).click();
      await dialog.getByRole('group', { name: `タグ「${name}」`, exact: true }).waitFor();
    }
    const row = dialog.getByRole('group', { name: 'タグ「仕事」', exact: true });
    expect(await row.getByText('0件', { exact: true }).isVisible()).toBe(true);
    const before = await page.evaluate('fixture.calls.writes');
    await dialog.getByLabel('管理タグを検索').fill('仕事');
    expect(await dialog.getByRole('group', { name: 'タグ「勉強」', exact: true }).isVisible()).toBe(false);
    await dialog.getByLabel('管理タグを検索').fill('');
    await row.getByRole('button', { name: '編集', exact: true }).click();
    expect(await dialog.getByRole('group', { name: 'タグ「勉強」', exact: true }).getByRole('button', { name: '編集', exact: true }).isVisible()).toBe(true);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/tag-manager-edit-${width}.png`, root)) });
    await row.getByLabel('変更後のタグ名').fill('破棄する入力'); await row.getByRole('button', { name: 'キャンセル', exact: true }).click();
    expect(await page.evaluate('fixture.calls.writes')).toBe(before);
    await row.getByRole('button', { name: '編集', exact: true }).click(); await row.getByLabel('変更後のタグ名').fill('業務');
    await row.getByRole('button', { name: '保存', exact: true }).click();
    const renamed = dialog.getByRole('group', { name: 'タグ「業務」', exact: true }); await renamed.waitFor();
    await renamed.getByRole('button', { name: '削除', exact: true }).click();
    await page.locator('#confirm-no').click(); expect(await renamed.isVisible()).toBe(true);
    expect(await page.evaluate('fixture.calls.writes')).toBe(Number(before) + 1);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/tag-manager-local-${width}.png`, root)) });
    await renamed.getByRole('button', { name: '削除', exact: true }).click(); await page.locator('#confirm-yes').click();
    await expect.poll(() => dialog.getByRole('group', { name: 'タグ「業務」', exact: true }).count()).toBe(0);
    await dialog.getByRole('button', { name: 'タグ管理を閉じる', exact: true }).click(); expect(await dialog.isVisible()).toBe(false);
    await page.getByRole('button', { name: 'タグ管理', exact: true }).first().click(); await page.keyboard.press('Escape'); expect(await dialog.isVisible()).toBe(false);
    expect(await page.evaluate('fixture.calls.writes')).toBe(Number(before) + 2);
    expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
  } finally { await context.close(); }
}, 15000);

it.each(['new', 'edit', 'search'])('localタグ管理のIME中は%s入力とフォーカスを保持し操作だけを止める', async target => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out'); await page.locator('#new').waitFor();
    await page.getByRole('button', { name: 'タグ管理', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'タグ管理', exact: true });
    await dialog.getByLabel('新規タグ名').fill('仕事'); await dialog.getByRole('button', { name: '＋追加', exact: true }).click();
    const row = dialog.getByRole('group', { name: 'タグ「仕事」', exact: true }); await row.waitFor();
    if (target === 'edit') await row.getByRole('button', { name: '編集', exact: true }).click();
    const input = dialog.getByLabel(target === 'new' ? '新規タグ名' : target === 'edit' ? '変更後のタグ名' : '管理タグを検索', { exact: true });
    const before = await page.evaluate('fixture.calls.writes');
    await input.focus(); await input.evaluate(node => Object.assign(window, { tagIMEProbe: node }));
    await input.dispatchEvent('compositionstart', { data: '' });
    expect(await input.isEnabled()).toBe(true);
    expect(await input.evaluate(node => document.activeElement === node && Reflect.get(window, 'tagIMEProbe') === node)).toBe(true);
    await input.evaluate(node => { const input = node as HTMLInputElement; input.value = '仕事中'; input.setSelectionRange(3, 3); });
    await input.dispatchEvent('input', { data: '中', inputType: 'insertCompositionText', isComposing: true });
    expect(await input.inputValue()).toBe('仕事中');
    expect(await input.evaluate(node => document.activeElement === node && (node as HTMLInputElement).selectionStart === 3)).toBe(true);
    expect(await dialog.locator('.tag-manager-content button').evaluateAll(nodes => nodes.every(node => (node as HTMLButtonElement).disabled))).toBe(true);
    // disabledボタンを迂回したsubmitでも、変換途中の値を保存しない。
    if (target !== 'search') await input.evaluate(node => node.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(await page.evaluate('fixture.calls.writes')).toBe(before);
    await input.dispatchEvent('compositionend', { data: '仕事中' });
    expect(await input.isEnabled()).toBe(true);
    expect(await input.evaluate(node => document.activeElement === node)).toBe(true);
    expect(await dialog.getByRole('button', { name: '＋追加', exact: true }).isEnabled()).toBe(true);
    expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
  } finally { await context.close(); }
}, 15000);

it.each(['success', 'rejected', 'unknown', 'pending', 'cancel'])('cloudタグ入力エラー後の削除%sでも共有通知を保持する', async outcome => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, `cloud-tag-delete-${outcome === 'cancel' ? 'success' : outcome}`);
    await page.locator('#product-cloud-items').waitFor(); await page.getByRole('button', { name: 'タグ管理', exact: true }).last().click();
    const dialog = page.getByRole('dialog', { name: 'クラウドタグ管理', exact: true });
    await dialog.getByLabel('新規タグ名').fill('   '); await dialog.getByRole('button', { name: '＋追加', exact: true }).click();
    await dialog.getByRole('status').filter({ hasText: 'タグ名を確認してください。' }).waitFor();
    await dialog.getByRole('group', { name: 'タグ「既存クラウドタグ」', exact: true }).getByRole('button', { name: '削除', exact: true }).click();
    expect(await page.locator('#product-session > #product-cloud-trash-state').count()).toBe(1);
    if (outcome === 'cancel') {
      await page.getByRole('button', { name: 'タグ削除をキャンセル', exact: true }).click();
      expect(await page.locator('#product-session > #product-cloud-trash-state').count()).toBe(1);
      expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
    } else {
      await page.getByRole('button', { name: '削除する', exact: true }).click();
      const status = page.locator('#product-session > #product-cloud-trash-state');
      if (outcome === 'pending') {
        await status.filter({ hasText: '処理中' }).waitFor(); await page.evaluate('fixture.releaseState()');
      }
      await status.filter({ hasText: outcome === 'unknown' ? 'UNKNOWN' : outcome === 'rejected' ? '拒否' : '要求の成功を確認' }).waitFor();
      expect(await status.isVisible()).toBe(true);
      expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_delete_tag']);
    }
    expect(await page.locator('#product-cloud-trash-state').count()).toBe(1);
    expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await context.close(); }
}, 15000);

it('localタグ保存busy中は既存closeガードで×/Escapeと二重操作を止める', async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out'); await page.locator('#new').waitFor();
    await page.getByRole('button', { name: 'タグ管理', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'タグ管理', exact: true });
    await dialog.getByLabel('新規タグ名').fill('待機するタグ'); await page.evaluate('fixture.holdWrite()');
    await dialog.getByRole('button', { name: '＋追加', exact: true }).click();
    await expect.poll(() => dialog.locator('[aria-busy=true]').count()).toBe(1);
    await dialog.getByRole('button', { name: 'タグ管理を閉じる', exact: true }).click(); expect(await dialog.isVisible()).toBe(true);
    await page.keyboard.press('Escape'); expect(await dialog.isVisible()).toBe(true);
    expect(await dialog.getByRole('button', { name: '＋追加', exact: true }).isDisabled()).toBe(true);
    await page.evaluate('fixture.releaseWrite()'); await dialog.getByRole('group', { name: 'タグ「待機するタグ」', exact: true }).waitFor();
    expect(await page.evaluate('fixture.calls.writes')).toBe(1);
    await dialog.getByRole('button', { name: 'タグ管理を閉じる', exact: true }).click(); expect(await dialog.isVisible()).toBe(false);
  } finally { await context.close(); }
}, 15000);

it.each(['create', 'rename', 'delete'])('cloudタグ管理の%sは既存C04要求だけを1回送りsnapshotを失効する', async operation => {
  const context = await browser.newContext({ viewport: { width: operation === 'rename' ? 1200 : 320, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, operation === 'delete' ? 'cloud-tag-delete-success' : 'cloud-tag-success');
    await page.locator('#product-cloud-items').waitFor(); await page.getByRole('button', { name: 'タグ管理', exact: true }).last().click();
    const dialog = page.getByRole('dialog', { name: 'クラウドタグ管理', exact: true });
    const row = dialog.getByRole('group', { name: 'タグ「既存クラウドタグ」', exact: true });
    expect(await row.getByText('1件', { exact: true }).isVisible()).toBe(true);
    await dialog.getByLabel('管理タグを検索').fill('一致しない'); expect(await row.isVisible()).toBe(false);
    await dialog.getByLabel('管理タグを検索').fill(''); expect(await row.isVisible()).toBe(true);
    expect(await dialog.getByRole('button', { name: '閉じる', exact: true }).count()).toBe(0);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/tag-manager-cloud-${operation}.png`, root)) });
    if (operation === 'create') {
      await dialog.getByLabel('新規タグ名').fill('新しいタグ'); await dialog.getByRole('button', { name: '＋追加', exact: true }).click();
    } else if (operation === 'rename') {
      await row.getByRole('button', { name: '編集', exact: true }).click(); await row.getByLabel('変更後のタグ名').fill('破棄する入力');
      await row.getByRole('button', { name: 'キャンセル', exact: true }).click();
      expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
      await row.getByRole('button', { name: '編集', exact: true }).click(); await row.getByLabel('変更後のタグ名').fill('改名タグ');
      await row.getByRole('button', { name: '保存', exact: true }).click();
    } else {
      await row.getByRole('button', { name: '削除', exact: true }).click(); await page.getByRole('button', { name: 'タグ削除をキャンセル', exact: true }).click();
      expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
      await page.getByRole('button', { name: 'タグ管理', exact: true }).last().click();
      await dialog.getByRole('group', { name: 'タグ「既存クラウドタグ」', exact: true }).getByRole('button', { name: '削除', exact: true }).click();
      await page.getByRole('button', { name: '削除する', exact: true }).click();
    }
    await page.locator('#product-cloud-trash-state').filter({ hasText: '要求の成功を確認' }).waitFor();
    expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot', operation === 'delete' ? 'memo_delete_tag' : 'memo_save_tag']);
    expect(await page.locator('#product-cloud-snapshot').textContent()).toBe('');
    expect(await page.locator('#product-cloud-trash-state').textContent()).toContain('明示再読取');
    const args = await page.evaluate('fixture.stateArgs()') as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(operation === 'delete' ? ['p_expected_revision', 'p_id'] : ['p_expected_revision', 'p_id', 'p_name']);
    expect(args.p_expected_revision).toBe(operation === 'create' ? null : 1);
    expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await context.close(); }
}, 15000);

it.each(['stale', 'unknown'])('新しいcloudタグ管理UIでも%s後の旧追加ボタンから再送しない', async kind => {
  const context = await browser.newContext({ viewport: { width: 390, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, kind === 'unknown' ? 'cloud-tag-unknown' : 'cloud-tag-success');
    await page.locator('#product-cloud-items').waitFor(); await page.getByRole('button', { name: 'タグ管理', exact: true }).last().click();
    const dialog = page.getByRole('dialog', { name: 'クラウドタグ管理', exact: true });
    await dialog.getByLabel('新規タグ名').fill('元の要求');
    await dialog.getByRole('button', { name: '＋追加', exact: true }).evaluate(node => Object.assign(window, { oldTagAdd: node }));
    if (kind === 'unknown') {
      await dialog.getByRole('button', { name: '＋追加', exact: true }).click();
      await page.locator('#product-cloud-trash-state').filter({ hasText: 'UNKNOWN' }).waitFor();
    } else {
      await page.evaluate('fixture.refreshAuth()');
      await expect.poll(() => page.locator('#product-cloud-snapshot').textContent()).toBe('');
    }
    await page.evaluate('oldTagAdd.click()');
    expect(await page.evaluate('fixture.rpcNames')).toEqual(kind === 'unknown' ? ['memo_load_snapshot', 'memo_save_tag'] : ['memo_load_snapshot']);
    expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
  } finally { await context.close(); }
}, 15000);

it.each([1200, 390, 320])('バックアップモーダルの配置と×/Escape・読取中close防止を維持する：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out');
    await page.locator('#new').waitFor();
    const backup = page.getByRole('dialog', { name: 'バックアップ・復元', exact: true });
    const open = page.getByRole('button', { name: 'バックアップ・復元', exact: true });
    await open.click();
    expect(await backup.getByRole('button', { name: '閉じる', exact: true }).count()).toBe(0);
    expect(await backup.locator('[data-close-dialog]').count()).toBe(1);
    const diagnose = backup.getByRole('button', { name: '初期復元の保存状況を診断', exact: true });
    const normal = backup.getByRole('button', { name: '初期復元を終了して通常利用', exact: true });
    const a = (await diagnose.boundingBox())!, b = (await normal.boundingBox())!;
    if (width > 650) {
      expect(b.y).toBe(a.y); expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(24);
    } else expect(b.y - (a.y + a.height)).toBeGreaterThanOrEqual(20);
    expect(await backup.locator('.dialog-heading h2').evaluate(node => getComputedStyle(node).fontSize)).toBe('22px');
    expect(await backup.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/backup-dialog-${width}.png`, root)) });
    const close = backup.getByRole('button', { name: 'バックアップ・復元を閉じる', exact: true });
    await close.click(); expect(await backup.isVisible()).toBe(false);
    await open.click(); await page.keyboard.press('Escape'); expect(await backup.isVisible()).toBe(false);
    await open.click();
    // 実ファイルやStorageを使わず、既存の読取busy/inertガードへ入る。
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function () { return new Promise<ArrayBuffer>(resolve => {
        Object.assign(window, { finishBackupFile: () => { File.prototype.arrayBuffer = original; resolve(new TextEncoder().encode('{}').buffer); } });
      }); };
    });
    await backup.getByLabel('初期復元のバックアップJSON', { exact: true }).setInputFiles({ name: 'fake.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await expect.poll(() => close.evaluate(node => !!node.closest('[inert]'))).toBe(true);
    await close.dispatchEvent('click'); expect(await backup.isVisible()).toBe(true);
    await page.keyboard.press('Escape'); expect(await backup.isVisible()).toBe(true);
    await page.evaluate('finishBackupFile()');
    await expect.poll(() => close.evaluate(node => !!node.closest('[inert]'))).toBe(false);
    await close.click(); expect(await backup.isVisible()).toBe(false);
    expect(await page.evaluate('fixture.calls.writes')).toBe(0);
    expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
  } finally { await context.close(); }
}, 15000);

it('初期復元UNKNOWNから認証画面を閉じて回復操作へ戻れる', async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await fakeProduct(context, 'cloud-edit-signed-out');
    await page.locator('#new').waitFor();
    await page.getByRole('button', { name: 'バックアップ・復元', exact: true }).click();
    const backup = page.getByRole('dialog', { name: 'バックアップ・復元', exact: true });
    const data = { format: 'myhomepage.memo.local-backup', backupVersion: 1, sourceStorageVersion: 3,
      exportedAt: '2026-01-01T00:00:00Z', data: { memos: [], tags: [], memoTags: [], deletedMemoIds: [] } };
    await page.getByLabel('初期復元のバックアップJSON').setInputFiles({ name: 'fake.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await page.getByRole('button', { name: '初期復元の確認へ', exact: true }).click();
    await page.evaluate('fixture.failWrites()');
    await page.getByRole('button', { name: '確認して初期復元', exact: true }).click();
    await backup.getByText(/初期復元の結果は不明/).waitFor();
    await backup.getByRole('button', { name: 'バックアップ・復元を閉じる', exact: true }).click();
    const auth = page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true });
    for (const method of ['button', 'escape']) {
      await page.locator('#product-auth-open').click();
      expect(await auth.getByRole('button', { name: 'ローカルを選択', exact: true }).count()).toBe(0);
      if (method === 'button') await auth.getByRole('button', { name: '閉じる', exact: true }).click(); else await page.keyboard.press('Escape');
      expect(await auth.isVisible()).toBe(false);
    }
    await page.getByRole('button', { name: 'バックアップ・復元', exact: true }).click();
    expect(await backup.getByRole('button', { name: '初期復元の保存状況を診断', exact: true }).isEnabled()).toBe(true);
    expect(await page.evaluate('fixture.rpcNames')).toEqual([]);
    expect(await page.evaluate('fixture.calls.writes')).toBe(1);
  } finally { await context.close(); }
}, 15000);

it('hidden属性だけの変更でもページタイトルが現在のviewへ追従する', async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const url = await prepareProductPreview(context, root, false), page = await context.newPage();
    await page.goto(url); await page.locator('#new').waitFor({ state: 'visible' });
    await expect.poll(() => page.locator('#page-title').textContent()).toBe('メモ一覧');
    await page.evaluate(() => {
      const notice = document.createElement('p'); notice.id = 'voice-scope-probe'; notice.dataset.voiceRoutine = 'true'; notice.textContent = '定型通知の表示範囲を確認';
      document.querySelector('.statuses')!.append(notice);
    });
    expect(await page.locator('#voice-scope-probe').isVisible()).toBe(false);
    // 子要素の追加・削除やinert変更に頼らず、既存viewの表示属性だけを変更する。
    for (const [id, title] of [['detail-view', 'メモ詳細'], ['editor-view', 'メモ編集'], ['list-view', 'メモ一覧']]) {
      await page.evaluate(id => {
        for (const view of ['list-view', 'detail-view', 'editor-view']) document.getElementById(view)!.hidden = view !== id;
      }, id!);
      await expect.poll(() => page.locator('#page-title').textContent()).toBe(title);
      expect(await page.locator('#voice-scope-probe').isVisible()).toBe(id !== 'list-view');
    }
  } finally { await context.close(); }
}, 15000);

it.each([1440, 390])('正本一覧・編集・モーダル：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 950 : 844 }, acceptDownloads: true, serviceWorkers: 'block' });
  try {
    await context.addInitScript(() => {
      Object.defineProperty(window, 'SpeechRecognition', { value: undefined });
      Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined });
    });
    const url = await prepareProductPreview(context, root, false), page = await context.newPage();
    await page.goto(url); await page.locator('#new').waitFor({ state: 'visible' });
    await expect.poll(() => page.locator('#page-title').textContent()).toBe('メモ一覧');
    expect(await page.locator('#product-auth-open').textContent()).toBe('ログイン / 保存先：ローカル');
    if (width === 1440) {
      expect(await page.locator('#memo-app .statuses').isVisible()).toBe(false);
      const boxes = await page.evaluate(() => {
        const box = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { width: r.width, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        const select = getComputedStyle(document.querySelector('#sort')!);
        return { auth: box('#product-auth-open'), backup: box('[data-open-dialog="backup-dialog"]'), reload: box('#reload'),
          heading: box('.tag-controls h2'), manager: box('.tag-controls .section-heading button'),
          trash: box('#trash-view'), clear: box('#clear-tag-filters'), combo: box('#sort'),
          search: box('.tag-search-row'), all: box('#filters-all'), padding: parseFloat(select.paddingRight), appearance: select.appearance,
          voice: getComputedStyle(document.querySelector('#list-voice-slot button')!).backgroundColor };
      });
      expect(boxes.reload.right).toBe(boxes.auth.right); expect(boxes.backup.top).toBeGreaterThan(boxes.auth.bottom);
      expect(boxes.reload.top).toBe(boxes.backup.top); expect(boxes.trash.right).toBeLessThan(boxes.backup.left);
      expect(boxes.backup.right).toBeLessThan(boxes.reload.left); expect(boxes.backup.width).toBe(250); expect(boxes.reload.width).toBe(250);
      expect(boxes.combo.left).toBe(boxes.clear.left); expect(boxes.search.top - boxes.manager.bottom).toBeGreaterThanOrEqual(12);
      expect(Math.abs(boxes.heading.top - boxes.manager.top)).toBeLessThan(15);
      expect(boxes.all.top - boxes.search.bottom).toBeGreaterThanOrEqual(12);
      expect(boxes.padding).toBeGreaterThanOrEqual(40); expect(boxes.appearance).toBe('none');
      expect(boxes.voice).toBe('rgb(189, 40, 59)');
    }
    expect(await page.locator('#list-voice-slot button [aria-hidden=true]').textContent()).toBe('🎙');
    await page.getByRole('button', { name: '音声メモ', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'このブラウザは音声入力に対応していません。' }).waitFor();
    expect(await page.locator('#editor-view').isVisible()).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.getByRole('button', { name: 'バックアップ・復元', exact: true }).count()).toBe(1);
    expect(await page.getByRole('button', { name: 'JSONバックアップを作成' }).isVisible()).toBe(false);
    await page.getByRole('button', { name: 'バックアップ・復元', exact: true }).click();
    const backup = page.getByRole('dialog', { name: 'バックアップ・復元', exact: true });
    expect(await backup.isVisible()).toBe(true);
    expect(await backup.getByLabel('初期復元のバックアップJSON').count()).toBe(1);
    await backup.getByRole('button', { name: 'バックアップ・復元を閉じる', exact: true }).click();
    await page.locator('#new').click();
    await page.locator('#memo-title').fill('画面確認の合成メモ'); await page.locator('#memo-body').fill('日本語の本文を保存します。');
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-editor-${width}.png`, root)) });
    await page.locator('#save').click(); await waitSavedEditor(page);
    expect(await page.locator('#editor-view .editor-saved').isVisible()).toBe(true);
    await page.getByRole('button', { name: '音声で本文へ追記', exact: true }).click();
    expect(await page.getByRole('status').filter({ hasText: 'このブラウザは音声入力に対応していません。' }).isVisible()).toBe(true);
    expect(await page.locator('#editor-view').isVisible()).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-detail-${width}.png`, root)) });
    await page.locator('#back').click();
    expect(await page.locator('#save-status').isVisible()).toBe(false);
    let raw = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
    expect(JSON.parse(raw!).memos[0].title).toBe('画面確認の合成メモ');
    await page.getByRole('button', { name: 'タグ管理', exact: true }).first().click();
    expect(await page.getByRole('dialog', { name: 'タグ管理', exact: true }).isVisible()).toBe(true);
    for (const invalid of ['   ', 'あ'.repeat(31), '禁止\u007f']) {
      await page.locator('#tag-name').fill(invalid); await page.locator('#tag-save').click();
      await expect.poll(() => page.locator('#tag-error').textContent()).toContain('入力を確認');
      expect(await page.getByRole('dialog', { name: 'タグ管理', exact: true }).getByRole('alert').isVisible()).toBe(true);
    }
    await page.locator('#tag-name').fill('仕事'); await page.locator('#tag-save').click();
    await page.locator('#tag-manager-rows').getByText('仕事', { exact: true }).waitFor();
    raw = await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'));
    await page.locator('#tag-manager-rows').getByRole('button', { name: '編集', exact: true }).click();
    await page.getByLabel('変更後のタグ名', { exact: true }).fill('変更をキャンセルする名前');
    await page.locator('#tag-manager-rows').getByRole('button', { name: 'キャンセル', exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(raw);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-tags-${width}.png`, root)) });
    await page.getByRole('dialog', { name: 'タグ管理', exact: true }).getByRole('button', { name: 'タグ管理を閉じる', exact: true }).click();
    await page.getByRole('button', { name: 'バックアップ・復元', exact: true }).click();
    expect(await backup.getByLabel('バックアップJSONを選択').count()).toBe(1);
    expect(await backup.getByLabel('単件回復のバックアップJSON').count()).toBe(1);
    await backup.getByRole('button', { name: 'JSONバックアップを作成' }).click();
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-backup-${width}.png`, root)) });
    expect(await page.evaluate(() => localStorage.getItem('myhomepage.memo.data.v2'))).toBe(raw);
    await backup.getByRole('button', { name: 'バックアップ・復元を閉じる', exact: true }).click();
    // 新旧データではなく、この専用Contextで作ったメモだけを複製して描画用件数を用意する。
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('myhomepage.memo.data.v2')!);
      const memo = data.memos[0];
      data.memos = Array.from({ length: 24 }, (_, index) => ({ ...memo, id: crypto.randomUUID(), title: `合成メモ ${index}`, lastRequestId: null }));
      localStorage.setItem('myhomepage.memo.data.v2', JSON.stringify(data));
    });
    await page.reload(); await page.locator('#cards li').first().waitFor();
    await page.locator('#sort').selectOption('created-asc');
    expect(await page.locator('#sort').inputValue()).toBe('created-asc');
    const top = await page.locator('#search').evaluate(node => node.getBoundingClientRect().top);
    await page.locator('#cards').evaluate(node => { node.scrollTop = 400; });
    expect(await page.locator('#cards').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    expect(await page.locator('#search').evaluate(node => node.getBoundingClientRect().top)).toBe(top);
    await page.locator('#cards button.open-card').first().click();
    await expect.poll(() => page.locator('#page-title').textContent()).toBe('メモ編集');
    await page.locator('#memo-body').fill('未保存の入力'); await page.locator('#back').click();
    await page.getByRole('dialog', { name: '操作の確認', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    expect(await page.locator('#memo-body').inputValue()).toBe('未保存の入力');
    await page.locator('#save').click(); await page.locator('#back').click();
    await expect.poll(() => page.locator('#page-title').textContent()).toBe('メモ一覧');
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-list-${width}.png`, root)) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
}, 15000);

it.each([1200, 992, 900, 800, 650, 390, 320].flatMap(width => ['new', 'saved'].map(kind => ({ width, kind }))))('UAT-06 local/cloud編集画面の構造・縦幅・scrollを統一：$width/$kind', async ({ width, kind }) => {
  const measures: Record<string, Record<string, { x: number; y: number; width: number; height: number }>> = {};
  for (const cloud of [false, true]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    try {
      const page = await fakeProduct(context, cloud ? 'cloud-list-uat-layout' : 'cloud-list-uat-layout-signed-out');
      if (kind === 'new') {
        if (cloud) { await page.locator('#product-cloud-items').waitFor(); await page.locator('.cloud-actions').getByRole('button', { name: '＋ 新規作成', exact: true }).click(); }
        else { await page.locator('#new').waitFor(); await page.locator('#new').click(); }
      } else await page.locator(cloud ? '#product-cloud-items .open-card' : '#cards .open-card').first().click();
      const pane = page.locator(cloud ? '#product-cloud-editor' : '#editor-view'); await pane.waitFor();
      const form = pane.locator('form'), title = cloud ? pane.getByLabel('クラウドのタイトル', { exact: true }) : page.locator('#memo-title');
      const body = cloud ? pane.getByLabel('クラウドの本文', { exact: true }) : page.locator('#memo-body');
      const back = page.locator(cloud ? '.cloud-list-navigation .editor-back' : '#back');
      expect((await back.textContent())?.replace(/\s+/g, ' ')).toContain('< 一覧へ');
      const voice = pane.getByRole('button', { name: '音声で本文へ追記', exact: true });
      await page.mouse.move(0, 0);
      expect(await voice.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(189, 40, 59)');
      expect(await pane.locator('.editor-tag-hint').textContent()).toBe('タグの作成・変更・削除は保存して一覧へ戻ってから行ってください。');
      expect(await pane.locator('.editor-tag-hint').evaluate(node => getComputedStyle(node).fontSize)).toBe('12px');
      expect(await body.getAttribute('rows')).toBe('12');
      const nav = pane.locator(':scope>.detail-actions');
      const previous = nav.getByRole('button', { name: '〈 前のメモ', exact: true }), copy = nav.getByRole('button', { name: '複製', exact: true }), next = nav.getByRole('button', { name: '次のメモ 〉', exact: true });
      const a = (await previous.boundingBox())!, b = (await copy.boundingBox())!, c = (await next.boundingBox())!;
      expect(a.x).toBeLessThan(b.x); expect(b.x + b.width).toBeLessThan(c.x); expect(a.y).toBe(c.y);
      expect(Math.abs(c.x + c.width - (await nav.boundingBox())!.x - (await nav.boundingBox())!.width)).toBeLessThanOrEqual(1);
      const footer = pane.locator('.editor-footer'), stop = footer.getByRole('button', { name: '音声入力を停止', exact: true }), save = footer.getByRole('button', { name: '保存する', exact: true });
      measures[cloud ? 'cloud' : 'local'] = {};
      for (const [name, node] of Object.entries({ pane, back, nav, title, tags: form.locator(':scope>fieldset'), body, voice, footer, stop, save })) measures[cloud ? 'cloud' : 'local']![name] = (await node.boundingBox())!;
      const boxes = measures[cloud ? 'cloud' : 'local']!;
      expect(boxes.stop!.y).toBe(boxes.save!.y);
      expect(boxes.stop!.x).toBe(boxes.footer!.x); expect(boxes.save!.x + boxes.save!.width).toBe(boxes.footer!.x + boxes.footer!.width);
      expect(await pane.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await pane.getByRole('button', { name: 'ゴミ箱へ移動', exact: true }).count()).toBe(0);
      await page.screenshot({ path: fileURLToPath(new URL(`.product/cloud-editor-${kind}-${cloud ? 'cloud' : 'local'}-${width}-top.png`, root)) });
      const scroll = await pane.evaluate(node => { node.scrollTop = node.scrollHeight; return { overflow: node.scrollHeight > node.clientHeight, top: node.scrollTop }; });
      if (scroll.overflow) expect(scroll.top).toBeGreaterThan(0);
      for (const node of [stop, save]) expect(await node.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: fileURLToPath(new URL(`.product/cloud-editor-${kind}-${cloud ? 'cloud' : 'local'}-${width}-bottom.png`, root)) });
      expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
      expect(await page.evaluate('fixture.rpcNames')).toEqual(cloud ? ['memo_load_snapshot'] : []);
      if (cloud) {
        expect(await pane.getByRole('button', { name: '保存結果を照合', exact: true }).isVisible()).toBe(false);
        const reload = page.locator('.cloud-operation-group .list-reload-button'); expect(await reload.isDisabled()).toBe(true);
        await reload.dispatchEvent('click'); expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot']);
      }
    } finally { await context.close(); }
  }
  const local = measures.local!, cloud = measures.cloud!;
  for (const key of ['pane', 'back', 'nav', 'title', 'tags', 'body', 'voice', 'footer', 'stop', 'save']) {
    for (const dimension of ['width', 'height'] as const) expect(Math.abs(cloud[key]![dimension] - local[key]![dimension]), `${key}.${dimension}`).toBeLessThanOrEqual(2);
    expect(Math.abs((cloud[key]!.y - cloud.pane!.y) - (local[key]!.y - local.pane!.y)), `${key}.y`).toBeLessThanOrEqual(2);
  }
}, 20000);

it.each([1200, 992, 900, 800, 650, 390, 320])('UAT-05 cloud一覧を受入済みlocal配置へ統一：幅%s', async width => {
  const measurements: Record<string, { search: { y: number; width: number }; reload: { x: number; y: number; width: number; height: number }; trash: { width: number; height: number }; cards: { y: number; height: number }; sort: { y: number; width: number } }> = {};
  for (const cloud of [false, true]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    try {
      const page = await fakeProduct(context, cloud ? 'cloud-list-uat-layout' : 'cloud-list-uat-layout-signed-out');
      const view = page.locator(cloud ? '#product-cloud-snapshot' : '#list-view');
      const rows = page.locator(cloud ? '#product-cloud-items' : '#cards'); await rows.locator('li').first().waitFor();
      expect(await rows.locator(':scope > li').count()).toBe(21);
      const search = view.getByRole('searchbox', { name: '検索', exact: true });
      const tagSearch = view.getByRole('searchbox', { name: 'タグを検索', exact: true });
      const sort = cloud ? view.getByRole('combobox', { name: '並び替え', exact: true }) : page.locator('#sort');
      const operations = page.locator(cloud ? '#product-session .cloud-operation-group' : '#memo-app .list-operation-group');
      const reload = operations.getByRole('button', { name: '再読み込み', exact: true });
      const trash = operations.getByRole('button', { name: 'ゴミ箱', exact: true });
      expect(await view.getByRole('button', { name: 'すべて', exact: true }).isVisible()).toBe(true);
      expect(await tagSearch.isVisible()).toBe(true);
      measurements[cloud ? 'cloud' : 'local'] = { search: (await search.boundingBox())!, reload: (await reload.boundingBox())!, trash: (await trash.boundingBox())!, cards: (await rows.boundingBox())!, sort: (await sort.boundingBox())! };
      expect(await view.getByRole('button', { name: 'ゴミ箱を空にする', exact: true }).isVisible()).toBe(false);
      await rows.evaluate(node => { node.scrollTop = 250; });
      expect(await rows.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: fileURLToPath(new URL(`.product/cloud-list-unified-${cloud ? 'cloud' : 'local'}-${width}.png`, root)) });
      if (cloud) {
        expect(await page.locator('#product-cloud-state').isVisible()).toBe(false);
        expect(await page.locator('#product-cloud-state').textContent()).toContain('メモ27件・タグ21件');
        const before = await page.evaluate('fixture.rpcNames.slice()');
        await search.fill('Alpha'); expect(await rows.locator(':scope > li').count()).toBe(1);
        await tagSearch.fill('折返し'); await view.getByRole('button', { name: '絞込解除', exact: true }).click();
        await search.fill(''); await sort.selectOption('created-asc');
        expect(await page.evaluate('fixture.rpcNames')).toEqual(before);
        const position = await trash.boundingBox(); await trash.click();
        const normal = operations.getByRole('button', { name: '通常一覧', exact: true });
        expect(await normal.boundingBox()).toEqual(position);
        expect(await view.getByRole('button', { name: 'ゴミ箱を空にする', exact: true }).isVisible()).toBe(true);
        expect(await view.locator('.list-summary').getByRole('button', { name: 'ゴミ箱を空にする', exact: true }).count()).toBe(1);
        await view.getByRole('button', { name: 'ゴミ箱を空にする', exact: true }).click();
        await page.getByRole('button', { name: '一括削除をキャンセル', exact: true }).click();
        expect(await page.evaluate('fixture.rpcNames')).toEqual(before);
        await operations.getByRole('button', { name: '通常一覧', exact: true }).click();
        await reload.click(); await expect.poll(() => page.evaluate('fixture.rpcNames.length')).toBe(2);
        expect(await page.evaluate('fixture.rpcNames')).toEqual(['memo_load_snapshot', 'memo_load_snapshot']);
        await page.evaluate("fixture.snapshotMode('unverified')"); await reload.click();
        await expect.poll(() => page.locator('#product-cloud-state').textContent()).toContain('UNKNOWN');
        expect(await page.locator('#product-cloud-state').isVisible()).toBe(true);
        expect(await page.locator('#product-cloud-snapshot').isVisible()).toBe(false);
        await page.evaluate('fixture.expired()');
        await expect.poll(() => reload.isDisabled()).toBe(true);
        expect(await page.locator('#product-cloud-state').isVisible()).toBe(true);
      }
      expect(await page.evaluate('fixture.calls.writes + fixture.calls.fetch')).toBe(0);
    } finally { await context.close(); }
  }
  const local = measurements.local!, cloud = measurements.cloud!;
  // cloudにはlocal専用backupがないため、スマホで操作群が1行少なくなる場合がある。
  expect(cloud.search.y).toBeLessThanOrEqual(local.search.y + 2);
  expect(Math.abs(cloud.search.width - local.search.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(cloud.sort.width - local.sort.width)).toBeLessThanOrEqual(2);
  if (width > 650) { expect(cloud.reload.width).toBe(local.reload.width); expect(cloud.trash.width).toBe(local.trash.width); expect(cloud.reload.x).toBe(local.reload.x); }
  expect(cloud.reload.height).toBe(local.reload.height); expect(cloud.trash.height).toBe(local.trash.height);
  expect(cloud.cards.height).toBeGreaterThanOrEqual(local.cards.height - 2);
  expect(cloud.cards.y).toBeLessThanOrEqual(local.cards.y + 2);
}, 30000);

it.each([1440, 390])('同じ製品HTMLのfake cloud配置：幅%s', async width => {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
  try {
    // 同じ製品HTML/CSSを使い、SDK/通信だけを既存fake compositionへ差し替える。
    const page = await fakeProduct(context, 'cloud-assign-edit');
    await page.locator('#product-cloud-items').waitFor();
    expect(await page.locator('#product-auth-open').textContent()).toBe('ログアウト / 保存先：クラウド');
    const beforeVoice = await page.evaluate('fixture.rpcNames.slice()');
    await page.getByRole('button', { name: '音声メモ', exact: true }).click();
    await page.locator('.cloud-editor-statuses > [role="status"]').filter({ hasText: 'このブラウザは音声入力に対応していません。' }).waitFor();
    expect(await page.locator('#product-cloud-editor').isVisible()).toBe(false);
    expect(await page.locator('#product-cloud-items').isVisible()).toBe(true);
    expect(await page.evaluate('fixture.rpcNames.slice()')).toEqual(beforeVoice);
    expect(await page.evaluate('fixture.calls.writes')).toBe(0);
    expect(await page.locator('#product-cloud-items .card-meta').first().textContent()).toContain('既存クラウドタグ');
    await page.locator('#product-cloud-snapshot').getByLabel('検索', { exact: true }).fill('クラウド');
    expect(await page.locator('#product-cloud-items .card-meta').first().textContent()).toContain('既存クラウドタグ');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-cloud-${width}.png`, root)) });
    await page.getByRole('button', { name: 'タグ管理', exact: true }).last().click();
    expect(await page.getByRole('dialog', { name: 'クラウドタグ管理', exact: true }).isVisible()).toBe(true);
    const tagDialog = page.getByRole('dialog', { name: 'クラウドタグ管理', exact: true });
    const beforeTag = await page.evaluate('fixture.rpcNames.slice()');
    for (const invalid of ['   ', 'あ'.repeat(31), '禁止\u007f']) {
      await tagDialog.getByLabel('新規タグ名').fill(invalid);
      await tagDialog.getByRole('button', { name: '＋追加', exact: true }).click();
      await tagDialog.getByRole('status').filter({ hasText: 'タグ名を確認してください。' }).waitFor();
    }
    expect(await page.evaluate('fixture.rpcNames.slice()')).toEqual(beforeTag);
    await tagDialog.getByRole('button', { name: 'タグ管理を閉じる', exact: true }).click();
    if (width === 1440) {
      await page.locator('#product-cloud-snapshot').getByLabel('並び替え', { exact: true }).selectOption('created-asc');
      expect(await page.locator('#product-cloud-snapshot').getByLabel('並び替え', { exact: true }).inputValue()).toBe('created-asc');
      const beforeFilter = await page.evaluate('fixture.rpcNames.slice()');
      await page.getByLabel('絞込タグ：既存クラウドタグ', { exact: true }).check();
      expect(await page.locator('#product-cloud-items button.open-card').count()).toBe(1);
      expect(await page.evaluate('fixture.rpcNames.slice()')).toEqual(beforeFilter);
    }
    if (width === 390) {
      const before = await page.evaluate('fixture.rpcNames.slice()');
      await page.locator('#product-cloud-items details summary').first().click();
      await page.locator('#product-cloud-items details').first().getByRole('button', { name: '複製', exact: true }).click();
      expect(await page.evaluate('fixture.rpcNames.slice()')).toEqual(before);
      expect(await page.evaluate('fixture.calls.writes')).toBe(0);
    } else {
      await page.locator('#product-cloud-items button.open-card').first().click();
    }
    expect(await page.getByLabel('クラウドのタイトル', { exact: true }).isVisible()).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL(`.product/layout-cloud-editor-${width}.png`, root)) });
  } finally { await context.close(); }
}, 15000);

import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { chromium, type Browser } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { MEMO_RPC_ORIGIN } from '../src/cloud-rpc-sender';
import { createProductCloudApp } from '../src/product-cloud-app';

const key = 'sb_publishable_synthetic_product_only', email = 'synthetic-product@example.invalid', password = 'synthetic-product-password';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const expires = Math.floor(Date.now() / 1000) + 3600;
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, exp: expires, role: 'authenticated' })}.${encode('synthetic-signature')}`;
const user = { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const session = { access_token: token, refresh_token: 'synthetic-product-refresh', expires_in: 3600, expires_at: expires, token_type: 'bearer', user };
let browser: Browser, html: string, files: Map<string, Buffer>;
beforeAll(async () => {
  execFileSync(process.execPath, ['scripts/build-product.mjs', '--cloud']);
  const root = new URL('../.product/cloud/site/tools/memo/', import.meta.url);
  html = await readFile(new URL('memo.html', root), 'utf8'); files = new Map();
  for (const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)) files.set(`/tools/memo/${match[1]}`, await readFile(new URL(match[1]!, root)));
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

async function fixture(seed = false, fail = false, hold = false, snapshotBody: unknown = { memos: [], tags: [], memoTags: [] }) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(({ seed, session }) => {
    const values = new Map<string, string>(seed ? [['myhomepage.memo.auth.v1', JSON.stringify(session)]] : []);
    const changes: string[] = [], reads: string[] = [];
    Object.defineProperty(window, 'localStorage', { value: { getItem: (k: string) => { reads.push(k); return values.get(k) ?? null; },
      setItem: (k: string, v: string) => { changes.push(k); values.set(k, v); }, removeItem: (k: string) => { changes.push(k); values.delete(k); } } });
    Object.defineProperty(navigator, 'locks', { value: { request: async (name: string, _options: unknown, callback: (lock: unknown) => unknown) => callback({ name, mode: 'exclusive' }) } });
    Object.assign(window, { productProbe: { changes, reads } });
  }, { seed, session });
  const requests: { path: string; method: string; redirect?: string }[] = [], logs: string[] = [];
  let release: (() => void) | undefined;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === MEMO_RPC_ORIGIN) {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET' } });
      requests.push({ path: url.pathname, method: request.method() });
      let body: unknown;
      if (url.pathname === '/auth/v1/token') body = fail ? { error_code: 'invalid_credentials', message: `${email} ${password} ${token}` } : session;
      else if (url.pathname === '/auth/v1/user') body = user;
      else if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
      else if (url.pathname === '/rest/v1/rpc/memo_load_snapshot') {
        if (hold) await new Promise<void>(resolve => { release = resolve; });
        body = snapshotBody;
      } else throw new Error('Unexpected synthetic product request');
      return route.fulfill({ status: fail && url.pathname === '/auth/v1/token' ? 400 : 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    }
    if (url.origin !== 'https://product.test') return route.abort();
    if (url.pathname === '/tools/memo/memo.html') return route.fulfill({ contentType: 'text/html', body: html });
    const file = files.get(url.pathname);
    return file ? route.fulfill({ contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css', body: file }) : route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on('console', event => logs.push(event.text())); page.on('pageerror', event => logs.push(event.message));
  await page.goto('https://product.test/tools/memo/memo.html');
  const configure = async () => {
    await page.getByLabel('開発用publishable key', { exact: true }).fill(key);
    await page.getByRole('button', { name: '承認済みクラウド接続を開始', exact: true }).click();
    await page.locator('#product-session').waitFor({ state: 'attached' });
    if (!seed) await page.locator('#product-auth-open').click();
  };
  const login = async () => {
    if (!await page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true }).isVisible()) await page.locator('#product-auth-open').click();
    await page.getByLabel('ログイン用メールアドレス').fill(email); await page.getByLabel('ログイン用パスワード').fill(password);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  };
  const privateOutput = async () => (await page.locator('body').innerHTML()) + page.url() + JSON.stringify(logs);
  return { page, context, requests, configure, login, privateOutput, release: () => release?.() };
}

it('通常entryのcloud候補は設定操作までAuth/RPCを生成せず、キー入力や不正値だけでは通信しない', async () => {
  const f = await fixture();
  try {
    await f.page.getByLabel('開発用publishable key').fill('secret-not-publishable');
    expect(f.requests).toEqual([]);
    await f.page.getByRole('button', { name: '承認済みクラウド接続を開始' }).click();
    expect(await f.page.getByLabel('開発用publishable key').inputValue()).toBe(''); expect(f.requests).toEqual([]);
    expect(await f.page.evaluate('productProbe.changes')).toEqual([]);
    expect(await f.page.evaluate('productProbe.reads')).toEqual([]);
  } finally { await f.context.close(); }
});
it.each([false, true])('実SDK＋注入HTTPでlogin/restore(seed=%s)→D05→validated-httpのsnapshot内容検証へ進む', async seed => {
  const f = await fixture(seed);
  try {
    await f.configure();
    if (!seed) {
      if (!await f.page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true }).isVisible()) await f.page.locator('#product-auth-open').click(); await f.page.getByText('未ログイン', { exact: true }).waitFor(); expect(f.requests).toEqual([]); await f.login();
    }
    await f.page.getByText(/クラウド読取成功/).waitFor();
    expect(f.requests.filter(x => x.path.startsWith('/rest/'))).toEqual([{ path: '/rest/v1/rpc/memo_load_snapshot', method: 'POST' }]);
    expect(await f.page.locator('#product-session').textContent()).toContain('保存先：クラウド');
    expect(await f.page.getByText(/クラウド読取成功/).count()).toBe(1);
    const changes = await f.page.evaluate('productProbe.changes') as string[];
    expect(changes.every(k => k.startsWith('myhomepage.memo.auth.v1'))).toBe(true);
    const output = await f.privateOutput();
    for (const secret of [key, email, password, token, session.refresh_token, id]) expect(output).not.toContain(secret);
    await f.page.locator('#product-auth-open').click();
    await f.page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    if (!await f.page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true }).isVisible()) await f.page.locator('#product-auth-open').click(); await f.page.getByText('未ログイン', { exact: true }).waitFor();
    expect(await f.page.locator('#product-session').textContent()).toContain('保存先：ローカル');
    expect(f.requests.filter(x => x.path.startsWith('/rest/'))).toHaveLength(1);
  } finally { await f.context.close(); }
});
it('正常HTTPでもsnapshot schema不正はUNKNOWNで停止し、再送・local書込しない', async () => {
  const f = await fixture(true, false, false, { privateError: `${email} ${password} ${token}` });
  try {
    await f.configure(); await f.page.getByText(/UNKNOWN：読取結果/).waitFor();
    expect(await f.page.getByText(/クラウド読取成功/).count()).toBe(0);
    expect(f.requests.filter(x => x.path.startsWith('/rest/'))).toEqual([{ path: '/rest/v1/rpc/memo_load_snapshot', method: 'POST' }]);
    expect((await f.page.evaluate('productProbe.changes') as string[]).every(k => k.startsWith('myhomepage.memo.auth.v1'))).toBe(true);
    for (const secret of [email, password, token]) expect(await f.privateOutput()).not.toContain(secret);
  } finally { await f.context.close(); }
});
it('providerの秘密付き認証拒否は固定表示だけにしRPCを開始しない', async () => {
  const f = await fixture(false, true);
  try {
    await f.configure(); if (!await f.page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true }).isVisible()) await f.page.locator('#product-auth-open').click(); await f.page.getByText('未ログイン', { exact: true }).waitFor(); await f.login();
    await f.page.getByText(/認証を確認できません/).waitFor();
    expect(f.requests.filter(x => x.path.startsWith('/rest/'))).toEqual([]);
    for (const secret of [key, email, password, token]) expect(await f.privateOutput()).not.toContain(secret);
  } finally { await f.context.close(); }
});
it('生成entryからの遅いRPCは再loginのgeneration変更後に成功反映せず再送しない', async () => {
  const f = await fixture(true, false, true);
  try {
    await f.configure(); await f.page.getByText(/クラウド読取中/).waitFor();
    await vi.waitFor(() => expect(f.requests.filter(x => x.path.startsWith('/rest/'))).toHaveLength(1));
    await f.login(); await f.page.getByText(/認証が更新されました/).waitFor();
    const received = f.page.waitForResponse(`${MEMO_RPC_ORIGIN}/rest/v1/rpc/memo_load_snapshot`); f.release();
    await (await received).finished();
    // 旧contextは無効なので、遅い応答の文言で新世代の案内も上書きしない。
    expect(await f.page.locator('#product-cloud-state').textContent()).toContain('認証が更新されました');
    expect(f.requests.filter(x => x.path.startsWith('/rest/'))).toHaveLength(1);
    expect(await f.page.getByText(/クラウド読取成功/).count()).toBe(0);
  } finally { f.release(); await f.context.close(); }
});
it('BFCache退避は未開始の接続入口を保持し、設定値を空にして復帰後も明示開始を待つ', async () => {
  const f = await fixture();
  try {
    await f.page.getByLabel('開発用publishable key').fill(key);
    await f.page.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })); window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))');
    expect(await f.page.getByLabel('開発用publishable key').inputValue()).toBe('');
    expect(await f.page.getByRole('button', { name: '承認済みクラウド接続を開始' }).isEnabled()).toBe(true);
    expect(f.requests).toEqual([]); expect(await f.page.evaluate('productProbe.changes')).toEqual([]);
    await f.configure(); if (!await f.page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true }).isVisible()) await f.page.locator('#product-auth-open').click(); await f.page.getByText('未ログイン', { exact: true }).waitFor();
    expect(f.requests).toEqual([]);
  } finally { await f.context.close(); }
});
it('BFCache復帰後も同じSDK/Auth UIを使い、再生成せず明示loginとlogoutを続けられる', async () => {
  const f = await fixture();
  try {
    await f.configure(); if (!await f.page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true }).isVisible()) await f.page.locator('#product-auth-open').click(); await f.page.getByText('未ログイン', { exact: true }).waitFor();
    await f.page.locator('#product-session').evaluate(node => Object.assign(window, { cachedProductSession: node }));
    await f.page.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })); window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))');
    expect(await f.page.evaluate('cachedProductSession === document.querySelector("#product-session")')).toBe(true);
    expect(f.requests).toEqual([]);
    await f.login(); await f.page.getByText(/クラウド読取成功/).waitFor();
    expect(f.requests.filter(x => x.path.startsWith('/rest/'))).toHaveLength(1);
    await f.page.locator('#product-auth-open').click();
    await f.page.getByRole('button', { name: 'ログアウト', exact: true }).click(); if (!await f.page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true }).isVisible()) await f.page.locator('#product-auth-open').click(); await f.page.getByText('未ログイン', { exact: true }).waitFor();
    expect(await f.page.locator('#product-session').textContent()).toContain('保存先：ローカル');
  } finally { await f.context.close(); }
});
it('BFCache退避/復帰はcloud dirty draftと離脱確認を維持し、Auth/RPC/local writeを追加しない', async () => {
  const f = await fixture(true);
  try {
    await f.configure(); await f.page.getByText(/クラウド読取成功/).waitFor();
    await f.page.getByRole('button', { name: '＋ 新規作成', exact: true }).click();
    await f.page.getByLabel('クラウドのタイトル', { exact: true }).fill('退避前draft');
    await f.page.getByLabel('クラウドの本文', { exact: true }).fill('保持する本文');
    const before = [...f.requests], changes = await f.page.evaluate('productProbe.changes');
    await f.page.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })); window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))');
    expect(await f.page.getByLabel('クラウドのタイトル', { exact: true }).inputValue()).toBe('退避前draft');
    expect(await f.page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('保持する本文');
    await f.page.locator('#product-auth-open').click();
    await f.page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await f.page.getByRole('button', { name: 'ログアウトをキャンセル', exact: true }).click();
    expect(await f.page.getByLabel('クラウドの本文', { exact: true }).inputValue()).toBe('保持する本文');
    expect(f.requests).toEqual(before); expect(await f.page.evaluate('productProbe.changes')).toEqual(changes);
  } finally { await f.context.close(); }
});
it('通常pagehideのdisposeでSDK/session購読・UIを終了し、旧ボタンで再通信しない', async () => {
  const f = await fixture();
  try {
    await f.configure(); if (!await f.page.getByRole('dialog', { name: 'ログイン / 保存先', exact: true }).isVisible()) await f.page.locator('#product-auth-open').click(); await f.page.getByText('未ログイン', { exact: true }).waitFor();
    await f.page.getByRole('button', { name: 'ログイン', exact: true }).evaluate(node => Object.assign(window, { oldProductLogin: node }));
    await f.page.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })); oldProductLogin.click()');
    expect(await f.page.locator('#product-session').count()).toBe(0); expect(f.requests).toEqual([]);
  } finally { await f.context.close(); }
});
it('cloud候補だけCSPのtrusted originを許可し、生成JSへ入力値を埋め込まない', () => {
  expect(html).toContain(`connect-src ${MEMO_RPC_ORIGIN};`);
  const code = [...files].filter(([name]) => name.endsWith('.js')).map(([, data]) => data.toString()).join('');
  for (const secret of [key, email, password, token]) expect(code).not.toContain(secret);
  expect(code).not.toContain('requirePersistencePermit');
});
it.each([{ secure: false }, { topLevel: false }, { url: 'https://product.test/other.html' }])('製品page境界不一致はSDK/Storage/HTTPより前に拒否：%j', overrides => {
  const getStorage = vi.fn(), fetch = vi.fn(), getItem = vi.fn();
  expect(() => createProductCloudApp({} as Document, { url: 'https://product.test/tools/memo/memo.html', secure: true, topLevel: true,
    getStorage, getLocks: () => undefined, createId: () => id, now: () => '', ...overrides }, key,
  { getItem, setItem: vi.fn(), removeItem: vi.fn() }, fetch)).toThrow();
  expect(getStorage).not.toHaveBeenCalled(); expect(getItem).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

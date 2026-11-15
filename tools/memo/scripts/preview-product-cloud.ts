import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createProfileOwner, prepareProfileBase } from '../tests/persistence/profile-guard';
import { initializeContext, runOwnedCase } from '../tests/persistence/lifecycle';
import { MEMO_RPC_ORIGIN } from '../src/cloud-rpc-sender';

// .product/cloud/preview.mjsにbuildする。設定/資格情報のCLI入力・env読取は持たない。
if (process.argv.length !== 2) throw new Error('Custom preview arguments forbidden');
const root = new URL('../../', import.meta.url), pageOrigin = 'https://memo-product.localhost';
const { verifyAuthArtifact } = await import(new URL('scripts/auth-sdk-patch.mjs', root).href);
await verifyAuthArtifact(fileURLToPath(root), fileURLToPath(new URL('.product/cloud/memo-app.js', root)));
const site = new URL('.product/cloud/site/tools/memo/', root);
const html = await readFile(new URL('memo.html', site), 'utf8');
const assets = new Map<string, { body: Buffer; contentType: string }>();
assets.set('/tools/memo/memo.html', { body: Buffer.from(html), contentType: 'text/html' });
for (const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)) {
  assets.set(`/tools/memo/${match[1]}`, { body: await readFile(new URL(match[1]!, site)), contentType: match[1]!.endsWith('.js') ? 'text/javascript' : 'text/css' });
}
for (const name of ['css/style.css', 'css/bootstrap-4.0.0.css', 'js/jquery-3.5.0.min.js', 'js/popper.min.js', 'js/menuScroll.js', 'js/shared-menu.js']) {
  assets.set(`/${name}`, { body: await readFile(new URL(`../../${name}`, root)), contentType: name.endsWith('.js') ? 'text/javascript' : 'text/css' });
}
const owner = await createProfileOwner(await prepareProfileBase(fileURLToPath(root))), profile = await owner.create();
await runOwnedCase(owner, profile, async () => {
  await initializeContext(() => chromium.launchPersistentContext(profile, { headless: false, serviceWorkers: 'block', acceptDownloads: false,
    args: ['--disable-background-networking', '--disable-sync', '--no-first-run'] }), async context => {
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === MEMO_RPC_ORIGIN) return route.continue(); // path/method/8RPCは既存Auth/senderが検証する。
      if (url.origin !== pageOrigin || !['GET', 'HEAD'].includes(route.request().method())) return route.abort();
      const asset = assets.get(url.pathname);
      return asset ? route.fulfill({ contentType: asset.contentType, headers: { 'Cache-Control': 'no-store' }, body: asset.body }) : route.abort();
    });
    const page = await context.newPage();
    // HTTPSの製品originをローカル資産から応答し、公開・HTTPサーバー・証明書変更を行わない。
    await page.goto(`${pageOrigin}/tools/memo/memo.html`);
    await new Promise<void>(resolve => context.once('close', () => resolve()));
  });
}, () => { process.stderr.write('Product preview stopped; owned profile preserved. No automatic retry.\n'); });

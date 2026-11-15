import { readFile } from 'node:fs/promises';
import type { BrowserContext } from '@playwright/test';
import { MEMO_RPC_ORIGIN } from '../src/cloud-rpc-sender';

export const PRODUCT_PREVIEW_ORIGIN = 'https://memo-product.localhost';
export const PRODUCT_PREVIEW_PATH = '/tools/memo/memo.html';

/** localだけdead proxyを併用する。cloudの既存HTTPS通信設定は変更しない。 */
export function productPreviewOptions(cloud: boolean) {
  return { headless: false, serviceWorkers: 'block' as const, acceptDownloads: false,
    args: ['--disable-background-networking', '--disable-sync', '--no-first-run'],
    ...(!cloud ? { proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1' } } : {}) };
}

/** 製品候補と既存共通資産だけを配信する。任意URLをファイルパスへ変換しない。 */
export async function prepareProductPreview(context: BrowserContext, root: URL, cloud: boolean) {
  const site = new URL(cloud ? '.product/cloud/site/tools/memo/' : '.product/site/tools/memo/', root);
  const html = await readFile(new URL('memo.html', site), 'utf8');
  const assets = new Map<string, { body: Buffer; contentType: string }>();
  assets.set(PRODUCT_PREVIEW_PATH, { body: Buffer.from(html), contentType: 'text/html' });
  for (const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^\"]+)"/g)) {
    assets.set(`/tools/memo/${match[1]}`, { body: await readFile(new URL(match[1]!, site)),
      contentType: match[1]!.endsWith('.js') ? 'text/javascript' : 'text/css' });
  }
  for (const name of ['css/style.css', 'css/bootstrap-4.0.0.css', 'js/jquery-3.5.0.min.js', 'js/popper.min.js', 'js/menuScroll.js', 'js/shared-menu.js']) {
    assets.set(`/${name}`, { body: await readFile(new URL(`../../${name}`, root)),
      contentType: name.endsWith('.js') ? 'text/javascript' : 'text/css' });
  }
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (cloud && url.origin === MEMO_RPC_ORIGIN) return route.continue();
    if (url.origin !== PRODUCT_PREVIEW_ORIGIN || !['GET', 'HEAD'].includes(route.request().method())) return route.abort();
    const asset = assets.get(url.pathname);
    return asset ? route.fulfill({ contentType: asset.contentType, headers: {
      'Cache-Control': 'no-store',
      ...(!cloud ? { 'Content-Security-Policy': "connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'" } : {}),
    }, body: asset.body }) : route.abort();
  });
  return `${PRODUCT_PREVIEW_ORIGIN}${PRODUCT_PREVIEW_PATH}`;
}

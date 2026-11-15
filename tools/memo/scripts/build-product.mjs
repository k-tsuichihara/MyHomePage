import { build } from 'esbuild';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { productHtml } from './product-html.mjs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildAuthBrowser } from './auth-sdk-patch.mjs';

const root = new URL('../', import.meta.url);
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--cloud')) throw new Error('Invalid product build mode');
const cloud = args[0] === '--cloud';
let cloudManifest;
if (cloud) {
  try { await unlink(new URL('.product/cloud/memo-app.js.patch.json', root)); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
}
const origin = (await readFile(new URL('src/cloud-rpc-sender.ts', root), 'utf8')).match(/^export const MEMO_RPC_ORIGIN = '([^']+)';/m)?.[1];
if (!origin || new URL(origin).origin !== origin || !origin.startsWith('https://')) throw new Error('Missing trusted memo origin');
for (const maintenance of cloud ? [false] : [false, true]) {
const out = new URL(cloud ? '.product/cloud/memo-app.js' : maintenance ? '.product/maintenance-app.js' : '.product/memo-app.js', root);
const define = { __MEMO_MAINTENANCE__: String(maintenance), __MEMO_PRODUCT_CLOUD__: String(cloud) };
const authenticated = cloud ? await buildAuthBrowser({ root: fileURLToPath(root), entryPoint: fileURLToPath(new URL('src/product-entry.ts', root)),
  outfile: fileURLToPath(out), write: false, define }) : null;
const result = authenticated ? { metafile: authenticated.metafile, outputFiles: [{ contents: authenticated.code }] } : await build({
  entryPoints: [fileURLToPath(new URL('src/product-entry.ts', root))],
  outfile: fileURLToPath(out), bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
  sourcemap: false, metafile: true, write: false,
  define,
});
const forbidden = Object.keys(result.metafile.inputs).filter(path => {
  const normalized = path.replaceAll('\\', '/');
  return cloud ? /(?:^|\/)(?:tests|memo-db-test|browser-auth|browser-local-adapter|readonly-trial)(?:[/.|-]|$)/i.test(normalized)
    : /(?:^|\/)(?:auth-|browser-auth|cloud-|readonly-trial)|node_modules|supabase/i.test(normalized);
});
if (forbidden.length || result.outputFiles.length !== 1) {
  throw new Error(`Product local bundle boundary rejected: ${forbidden.join(', ')}`);
}
await mkdir(new URL(cloud ? '.product/cloud/' : '.product/', root), { recursive: true });
await writeFile(out, result.outputFiles[0].contents);
if (authenticated) cloudManifest = authenticated.manifest;
let html = productHtml(await readFile(new URL('memo.html', root), 'utf8'),
  await readFile(new URL('scripts/product-ui.html', root), 'utf8'));
if (maintenance) html = html.replace(/<main>[\s\S]*?<\/main>/, '<main><section class="memo-page"><div class="memo-shell"><h1>メモツール保守版</h1><p id="product-status" role="status">未起動・書込停止</p></div></section></main>');
const candidate = new URL(maintenance ? '.product/maintenance/tools/memo/' : '.product/site/tools/memo/', root);
const delivery = cloud ? new URL('.product/cloud/site/tools/memo/', root) : candidate;
await mkdir(new URL('js/', delivery), { recursive: true });
await mkdir(new URL('css/', delivery), { recursive: true });
if (cloud) html = html.replace('</head>', `<meta http-equiv="Content-Security-Policy" content="connect-src ${origin};">\n</head>`);
const assets = [
  ['js/memo-app.js', result.outputFiles[0].contents],
  ...await Promise.all(['memo.css', 'memo-product.css'].map(async name =>
    [`css/${name}`, await readFile(new URL(`css/${name}`, root))])),
];
for (const [name, bytes] of assets) {
  const digest = createHash('sha256').update(bytes).digest();
  const hashed = name.replace(/\.(js|css)$/, `.${digest.toString('hex')}.$1`);
  await writeFile(new URL(hashed, delivery), bytes);
  html = html.replace(`="${name}"`, `="${hashed}" integrity="sha256-${digest.toString('base64')}" crossorigin="anonymous"`);
}
await writeFile(new URL('memo.html', delivery), html);
}
await build({ entryPoints: [fileURLToPath(new URL('scripts/preview-product-cloud.ts', root))],
  outfile: fileURLToPath(new URL(cloud ? '.product/cloud/preview.mjs' : '.product/local/preview.mjs', root)), bundle: true, packages: 'external',
  platform: 'node', format: 'esm', target: 'node22', define: { __MEMO_PREVIEW_CLOUD__: String(cloud) } });
if (cloudManifest) await writeFile(new URL('.product/cloud/memo-app.js.patch.json', root), JSON.stringify(cloudManifest));

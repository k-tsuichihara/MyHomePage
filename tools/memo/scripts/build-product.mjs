import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { productHtml } from './product-html.mjs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const out = new URL('.product/memo-app.js', root);
const result = await build({
  entryPoints: [fileURLToPath(new URL('src/product-entry.ts', root))],
  outfile: fileURLToPath(out), bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
  sourcemap: false, metafile: true, write: false,
});
const forbidden = Object.keys(result.metafile.inputs).filter(path => {
  const normalized = path.replaceAll('\\', '/');
  return /(?:^|\/)(?:auth-|browser-auth|cloud-|readonly-trial)|node_modules|supabase/i.test(normalized);
});
if (forbidden.length || result.outputFiles.length !== 1) {
  throw new Error(`Product local bundle boundary rejected: ${forbidden.join(', ')}`);
}
await mkdir(new URL('.product/', root), { recursive: true });
await writeFile(out, result.outputFiles[0].contents);
let html = productHtml(await readFile(new URL('memo.html', root), 'utf8'),
  await readFile(new URL('tests/browser/preview.html', root), 'utf8'));
const candidate = new URL('.product/site/tools/memo/', root);
await mkdir(new URL('js/', candidate), { recursive: true });
await mkdir(new URL('css/', candidate), { recursive: true });
const assets = [
  ['js/memo-app.js', result.outputFiles[0].contents],
  ...await Promise.all(['memo.css', 'memo-product.css'].map(async name =>
    [`css/${name}`, await readFile(new URL(`css/${name}`, root))])),
];
for (const [name, bytes] of assets) {
  const digest = createHash('sha256').update(bytes).digest();
  const hashed = name.replace(/\.(js|css)$/, `.${digest.toString('hex')}.$1`);
  await writeFile(new URL(hashed, candidate), bytes);
  html = html.replace(`="${name}"`, `="${hashed}" integrity="sha256-${digest.toString('base64')}" crossorigin="anonymous"`);
}
await writeFile(new URL('memo.html', candidate), html);

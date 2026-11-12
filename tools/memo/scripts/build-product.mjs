import { build } from 'esbuild';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { productHtml } from './product-html.mjs';
import { fileURLToPath } from 'node:url';

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
const html = productHtml(await readFile(new URL('memo.html', root), 'utf8'),
  await readFile(new URL('tests/browser/preview.html', root), 'utf8'));
const candidate = new URL('.product/site/tools/memo/', root);
await mkdir(new URL('js/', candidate), { recursive: true });
await mkdir(new URL('css/', candidate), { recursive: true });
await writeFile(new URL('memo.html', candidate), html);
await writeFile(new URL('js/memo-app.js', candidate), result.outputFiles[0].contents);
for (const name of ['memo.css', 'memo-product.css']) {
  await copyFile(new URL(`css/${name}`, root), new URL(`css/${name}`, candidate));
}

import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
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

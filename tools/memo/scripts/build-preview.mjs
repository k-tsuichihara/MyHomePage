import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// 公開用JSとは別に生成する。正式HTMLや旧JSはコピーも上書きもしない。
const root = new URL('../', import.meta.url);
await mkdir(new URL('.preview/', root), { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL('tests/browser/preview.ts', root))],
  outfile: fileURLToPath(new URL('.preview/preview.js', root)), bundle: true, platform: 'browser',
  format: 'esm', target: 'es2022', sourcemap: false });
for (const name of ['preview.html', 'preview.css']) {
  await copyFile(new URL(`tests/browser/${name}`, root), new URL(`.preview/${name}`, root));
}

import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// メモリ専用入口・公開資産とは別の出力先だけを利用する。
const root = new URL('../', import.meta.url);
await mkdir(new URL('.persistence/', root), { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL('tests/persistence/entry.ts', root))], outfile: fileURLToPath(new URL('.persistence/preview.js', root)), bundle: true, platform: 'browser', format: 'esm', target: 'es2022' });
await copyFile(new URL('tests/persistence/preview.html', root), new URL('.persistence/preview.html', root));
await copyFile(new URL('tests/browser/preview.css', root), new URL('.persistence/preview.css', root));
await build({ entryPoints: [fileURLToPath(new URL('tests/persistence/run.ts', root))], outfile: fileURLToPath(new URL('.persistence/run.mjs', root)), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22' });

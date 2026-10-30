import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url), out = new URL('.format/', root);
await mkdir(out, { recursive: true });
await copyFile(new URL('tests/format/preview.html', root), new URL('preview.html', out));
await build({ entryPoints: [fileURLToPath(new URL('tests/format/entry.ts', root))], outfile: fileURLToPath(new URL('format.js', out)), bundle: true, platform: 'browser', format: 'esm', target: 'es2022' });
await build({ entryPoints: [fileURLToPath(new URL('tests/format/run.ts', root))], outfile: fileURLToPath(new URL('run.mjs', out)), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22' });

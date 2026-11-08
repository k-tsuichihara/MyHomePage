import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildAuthBrowser } from './auth-sdk-patch.mjs';

const root = new URL('../', import.meta.url);
await mkdir(new URL('.auth-browser/', root), { recursive: true });
await buildAuthBrowser({ root: fileURLToPath(root), entryPoint: fileURLToPath(new URL('tests/auth-browser/entry.ts', root)),
  outfile: fileURLToPath(new URL('.auth-browser/auth.js', root)) });
await copyFile(new URL('tests/auth-browser/preview.html', root), new URL('.auth-browser/preview.html', root));
await build({ entryPoints: [fileURLToPath(new URL('tests/auth-browser/run.ts', root))],
  outfile: fileURLToPath(new URL('.auth-browser/run.mjs', root)), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22' });

import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildAuthBrowser } from './auth-sdk-patch.mjs';
const root = new URL('../', import.meta.url);
await mkdir(new URL('.readonly-trial/', root), { recursive: true });
await buildAuthBrowser({ root: fileURLToPath(root), entryPoint: fileURLToPath(new URL('tests/readonly-trial-browser/entry.ts', root)), outfile: fileURLToPath(new URL('.readonly-trial/readonly-trial.js', root)) });
await copyFile(new URL('tests/readonly-trial-browser/preview.html', root), new URL('.readonly-trial/preview.html', root));

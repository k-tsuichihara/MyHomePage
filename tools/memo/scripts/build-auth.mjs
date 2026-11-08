import { fileURLToPath } from 'node:url';
import { buildAuthBrowser } from './auth-sdk-patch.mjs';

await buildAuthBrowser({ root: fileURLToPath(new URL('../', import.meta.url)),
  entryPoint: fileURLToPath(new URL('../src/auth-sdk.ts', import.meta.url)),
  outfile: fileURLToPath(new URL('../.preview/auth-check/auth-sdk.js', import.meta.url)) });

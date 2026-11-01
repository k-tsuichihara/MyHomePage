import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// 実transportもAuthも含まない入口だけを固定出力先へ束ねる。
const root = new URL('../', import.meta.url);
await mkdir(new URL('.cloud-live/', root), { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL('tests/cloud-live/offline-entry.ts', root))],
  outfile: fileURLToPath(new URL('.cloud-live/offline.mjs', root)), bundle: true, platform: 'node', format: 'esm', target: 'node22' });

import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/run-human-gate.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.human-gate/run.mjs',
  external: ['@playwright/test'],
  sourcemap: false,
});

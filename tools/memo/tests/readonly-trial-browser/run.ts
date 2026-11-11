import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
// @ts-expect-error Node's strip-types runner resolves explicit .ts imports at runtime.
import { createProfileOwner, prepareProfileBase } from '../persistence/profile-guard.ts';
// @ts-expect-error Node's strip-types runner resolves explicit .ts imports at runtime.
import { initializeContext, runOwnedCase } from '../persistence/lifecycle.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const build = await import(new URL('../../scripts/build-readonly-trial-browser.mjs', import.meta.url).href);
void build;
const owner = await createProfileOwner(await prepareProfileBase(root));
const assets = new Map([['/', ['preview.html', 'text/html']], ['/readonly-trial.js', ['readonly-trial.js', 'text/javascript']]]);
let origin = '';
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  if (req.headers.host !== origin.slice(7) || !['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(403).end(); return; }
  const asset = assets.get(req.url ?? ''); if (!asset) { res.writeHead(404).end(); return; }
  try { const body = await readFile(new URL(`../../.readonly-trial/${asset[0]}`, import.meta.url)); res.setHeader('Content-Type', `${asset[1]}; charset=utf-8`); res.writeHead(200).end(req.method === 'HEAD' ? undefined : body); }
  catch { res.writeHead(503).end(); }
});
await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const address = server.address(); if (!address || typeof address === 'string') throw new Error('loopback unavailable');
origin = `http://127.0.0.1:${address.port}`;
const profile = await owner.create();
await runOwnedCase(owner, profile, async () => {
  await initializeContext(() => chromium.launchPersistentContext(profile, { headless: true, serviceWorkers: 'block', acceptDownloads: false,
    proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1' }, args: ['--disable-background-networking', '--disable-sync', '--no-first-run'] }), async context => {
    await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await context.addInitScript(({ origin, runId }) => Object.defineProperty(window, '__readonlyPermit', { value: Object.freeze({ origin, runId }) }), { origin, runId: owner.runId });
    const page = await context.newPage(); await page.goto(origin); await page.waitForFunction(() => !!window.__readonlyTrial);
    const initial = await page.locator('#status').textContent(); if (!initial?.includes('idle')) throw new Error('unexpected initial state');
    await page.locator('#auth').click(); await page.locator('#load').click();
    await context.close();
  });
}, value => process.stderr.write(`${JSON.stringify(value)}\n`));
await new Promise<void>(resolve => server.close(() => resolve()));
process.stdout.write('readonly trial browser: offline PASS\n');

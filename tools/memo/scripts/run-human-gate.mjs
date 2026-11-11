import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createProfileOwner, prepareProfileBase } from '../tests/persistence/profile-guard.ts';
import { initializeContext } from '../tests/persistence/lifecycle.ts';
import { MEMO_RPC_ORIGIN } from '../src/cloud-rpc-sender.ts';

const root = new URL('../', import.meta.url);
const projectRef = 'yohoppqflnhhvqypwhfv';
const publishableKey = process.env.MEMO_PUBLISHABLE_KEY;
if (!publishableKey || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) throw new Error('MEMO_PUBLISHABLE_KEY is required');
const owner = await createProfileOwner(await prepareProfileBase(root));
const profile = await owner.create();
const files = new Map([['/', ['human-gate.html', 'text/html']], ['/human-gate.html', ['human-gate.html', 'text/html']], ['/human-gate.js', ['human-gate.js', 'text/javascript']]]);
let origin = '';
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self'; connect-src ${MEMO_RPC_ORIGIN}; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  if (req.headers.host !== origin.slice(7) || !['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(403).end(); return; }
  const asset = files.get(req.url ?? ''); if (!asset) { res.writeHead(404).end(); return; }
  try { const body = await readFile(new URL(`../.readonly-trial/${asset[0]}`, import.meta.url)); res.setHeader('Content-Type', `${asset[1]}; charset=utf-8`); res.writeHead(200).end(req.method === 'HEAD' ? undefined : body); } catch { res.writeHead(503).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const address = server.address(); if (!address || typeof address === 'string') throw new Error('loopback unavailable');
origin = `http://127.0.0.1:${address.port}`;
await initializeContext(() => chromium.launchPersistentContext(profile, { headless: false, serviceWorkers: 'block', acceptDownloads: false,
  args: ['--disable-background-networking', '--disable-sync', '--no-first-run'] }), async context => {
  await context.route('**/*', route => { const url = new URL(route.request().url()); return url.origin === origin || url.origin === MEMO_RPC_ORIGIN ? route.continue() : route.abort(); });
  await context.addInitScript(({ origin, runId, projectRef, authOrigin, publishableKey }) => Object.defineProperty(window, '__humanGateConfig', { value: Object.freeze({ projectRef, authOrigin, publishableKey, permit: Object.freeze({ origin, runId }) }) }), { origin, runId: owner.runId, projectRef, authOrigin: MEMO_RPC_ORIGIN, publishableKey });
  const page = await context.newPage(); await page.goto(`${origin}/human-gate.html`);
  console.log(`Human Gate: ${origin}/human-gate.html`); console.log('通信開始はAuth開始ボタン押下後のみです。終了はブラウザを閉じてください。');
  await new Promise(resolve => context.on('close', resolve));
});
await new Promise(resolve => server.close(resolve));

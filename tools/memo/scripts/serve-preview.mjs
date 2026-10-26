import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// 要求URLをファイルパスへ変換しない。生成した三資産だけを固定表から配信する。
const port = 4173;
const origin = `http://127.0.0.1:${port}`;
const files = new Map([
  ['/', ['preview.html', 'text/html; charset=utf-8']],
  ['/preview.html', ['preview.html', 'text/html; charset=utf-8']],
  ['/preview.js', ['preview.js', 'text/javascript; charset=utf-8']],
  ['/preview.css', ['preview.css', 'text/css; charset=utf-8']],
]);
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'none'; font-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  if (request.headers.host !== `127.0.0.1:${port}` || (request.headers.origin && request.headers.origin !== origin)) {
    response.writeHead(403).end(); return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
  const asset = files.get((request.url ?? '').split('?')[0]);
  if (!asset) { response.writeHead(404).end(); return; }
  try {
    const content = await readFile(new URL(`../.preview/${asset[0]}`, import.meta.url));
    response.setHeader('Content-Type', asset[1]); response.writeHead(200).end(request.method === 'HEAD' ? undefined : content);
  } catch { response.writeHead(503).end(); }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`Memo memory preview: ${origin}\n`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());

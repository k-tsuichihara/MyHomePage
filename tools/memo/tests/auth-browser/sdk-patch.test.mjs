import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { requireVersions, replaceDebugInitializer, patchLocksSource, inspectInstalledSdk,
  buildAuthBrowser, requireArtifact, requireSingleModule, SOURCE_PATH, SOURCE_SHA256, INITIALIZER, sha256 } from '../../scripts/auth-sdk-patch.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const target = join(root, SOURCE_PATH);
const source = await readFile(target);
let compiled;
const compile = () => compiled ??= buildAuthBrowser({ root, entryPoint: target, outfile: join(root, '.auth-browser/locks-test.js'), write: false });

test('実supabase-js/auth-jsを別々に検証し、元SDKのSHAを維持', async () => {
  await inspectInstalledSdk(root); assert.equal(sha256(source), SOURCE_SHA256);
});
for (const pair of [['2.111.0', '2.119.0'], ['2.119.0', '2.111.0'], ['2.119.0', undefined]])
  test(`片方だけの版不一致でも停止 ${pair.join('/')}`, () => assert.throws(() => requireVersions(...pair)));
test('初期化式だけをfalseへ置換し、前後の全コードが不変', () => {
  const before = source.toString('utf8'), after = patchLocksSource(source, target, target), at = before.indexOf(INITIALIZER);
  assert.equal(after, before.slice(0, at) + 'false' + before.slice(at + INITIALIZER.length));
  assert.equal(sha256(source), SOURCE_SHA256);
});
test('想定外パスは内容が同じでも停止', () => assert.throws(() => patchLocksSource(source, target + '.copy', target)));
test('同じ版でも元ファイル1バイト変更を拒否', () => assert.throws(() => patchLocksSource(Buffer.concat([source, Buffer.from(' ')]), target, target)));
test('置換0件を拒否', () => assert.throws(() => replaceDebugInitializer('export const internals = { debug: false };')));
test('置換複数件を拒否', () => assert.throws(() => replaceDebugInitializer(INITIALIZER + '\n' + INITIALIZER)));
for (const count of [0, 2]) test(`適用件数${count}は成果物を受理しない`, () =>
  assert.throws(() => requireSingleModule({ [SOURCE_PATH]: {} }, count, root, target, '')));
test('別経路の同モジュール混入を拒否', () => assert.throws(() => requireSingleModule({
  [SOURCE_PATH]: {}, 'node_modules/other/node_modules/@supabase/auth-js/dist/module/lib/locks.js': {},
}, 1, root, target, '')));
test('CommonJS版に自動適用しない', () => assert.throws(() => requireSingleModule({
  'node_modules/@supabase/auth-js/dist/main/lib/locks.js': {},
}, 1, root, target, '')));
test('未適用初期化式を含む成果物は拒否', () => assert.throws(() => requireSingleModule({
  [SOURCE_PATH]: {},
}, 1, root, target, "globalThis.localStorage.getItem('supabase.gotrue-js.locks.debug')")));
test('メモリ内ビルドの記録と成果物が一致', async () => {
  const result = await compile(); requireArtifact(result.manifest, result.code);
  assert.equal(sha256(await readFile(target)), SOURCE_SHA256);
});
test('古い・書換え済み成果物を拒否', async () => {
  const { manifest, code } = await compile(); assert.throws(() => requireArtifact(manifest, Buffer.concat([code, Buffer.from(' ')])));
});
test('未知のパッチ記録を拒否', async () => {
  const { manifest, code } = await compile(); assert.throws(() => requireArtifact({ ...manifest, patchId: 'other' }, code));
});

async function loadLocks(request = async (_name, _options, fn) => fn({ name: 'synthetic-lock' })) {
  const { code } = await compile();
  const iife = await transform(Buffer.from(code).toString('utf8'), { format: 'iife', globalName: 'locksModule' });
  let gets = 0;
  const context = { window: {}, document: {}, navigator: { locks: { request } }, AbortController, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    get localStorage() { gets++; throw new Error('Must not obtain Storage'); } };
  runInNewContext(iife.code, context);
  assert.equal(gets, 0);
  return context.locksModule;
}
test('ブラウザ相当のimportはStorage取得0件、debug初期値false', async () => {
  const locks = await loadLocks(); assert.equal(locks.internals.debug, false);
  assert.equal(typeof locks.navigatorLock, 'function'); assert.equal(typeof locks.processLock, 'function');
});
test('navigatorLockは実行主体へexclusive取得を委譲', async () => {
  let calls = 0;
  const locks = await loadLocks(async (_name, options, fn) => {
    calls++; assert.equal(options.mode, 'exclusive'); assert.equal(options.ifAvailable, true);
    return fn({ name: 'synthetic-lock' });
  });
  assert.equal(await locks.navigatorLock('synthetic-lock', 0, async () => 7), 7); assert.equal(calls, 1);
});
test('navigatorLockの取得不可・例外型を維持', async () => {
  const locks = await loadLocks(async (_name, _options, fn) => fn(null));
  await assert.rejects(locks.navigatorLock('synthetic-lock', 0, async () => 7), e =>
    e instanceof locks.NavigatorLockAcquireTimeoutError && e.isAcquireTimeout === true);
});
test('processLockは同名処理を直列化し、例外後も解放', async () => {
  const locks = await loadLocks(); let release; const order = [];
  const first = locks.processLock('synthetic-lock', -1, async () => {
    order.push('first'); await new Promise(resolve => { release = resolve; }); throw new Error('synthetic');
  });
  const rejected = assert.rejects(first, /synthetic/);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  const second = locks.processLock('synthetic-lock', -1, async () => { order.push('second'); });
  for (let i = 0; i < 12; i++) await Promise.resolve(); assert.deepEqual(order, ['first']);
  release(); await rejected; await second; assert.deepEqual(order, ['first', 'second']);
});
test('processLockの待機タイムアウトを維持', async () => {
  const locks = await loadLocks(); let release;
  const first = locks.processLock('timeout-lock', -1, () => new Promise(resolve => { release = resolve; }));
  for (let i = 0; i < 12; i++) await Promise.resolve();
  try { await assert.rejects(locks.processLock('timeout-lock', 1, async () => {}), e => e instanceof locks.ProcessLockAcquireTimeoutError); }
  finally { release(); await first; }
});

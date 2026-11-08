import { build } from 'esbuild';
import { readFile, realpath, lstat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const SUPABASE_VERSION = '2.119.0';
export const AUTH_VERSION = '2.119.0';
export const SOURCE_PATH = 'node_modules/@supabase/auth-js/dist/module/lib/locks.js';
export const SOURCE_SHA256 = 'dff51f514d51045d15216c9c76239290b15a646f12e34449234960622e0366ff';
export const PATCH_ID = 'memo-auth-lock-debug-init-v1';
export const INITIALIZER = "!!(globalThis &&\n        supportsLocalStorage() &&\n        globalThis.localStorage &&\n        globalThis.localStorage.getItem('supabase.gotrue-js.locks.debug') === 'true')";
const fail = () => { throw new Error('Auth SDK patch verification failed'); };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);

export function requireVersions(supabase, auth) {
  if (supabase !== SUPABASE_VERSION || auth !== AUTH_VERSION) fail();
}
/** 公開SDKの既知の式だけを置換し、前後の全バイト列を保持する。 */
export function replaceDebugInitializer(source) {
  const at = source.indexOf(INITIALIZER);
  if (at < 0 || source.indexOf(INITIALIZER, at + INITIALIZER.length) !== -1) fail();
  return source.slice(0, at) + 'false' + source.slice(at + INITIALIZER.length);
}
export function patchLocksSource(bytes, actualPath, expectedPath) {
  if (canonical(actualPath) !== canonical(expectedPath) || sha256(bytes) !== SOURCE_SHA256) fail();
  const source = bytes.toString('utf8'), patched = replaceDebugInitializer(source), at = source.indexOf(INITIALIZER);
  if (patched.slice(0, at) !== source.slice(0, at)
    || patched.slice(at + 5) !== source.slice(at + INITIALIZER.length)) fail();
  return patched;
}
async function checkedFile(path) {
  if (!(await lstat(path)).isFile() || canonical(await realpath(path)) !== canonical(path)) fail();
  return readFile(path);
}
export async function inspectInstalledSdk(root) {
  root = resolve(root);
  const supabase = JSON.parse(await checkedFile(join(root, 'node_modules/@supabase/supabase-js/package.json')));
  const auth = JSON.parse(await checkedFile(join(root, 'node_modules/@supabase/auth-js/package.json')));
  requireVersions(supabase.version, auth.version);
  if (supabase.name !== '@supabase/supabase-js' || auth.name !== '@supabase/auth-js'
    || supabase.module !== 'dist/index.mjs' || auth.module !== 'dist/module/index.js'
    || supabase.dependencies?.['@supabase/auth-js'] !== AUTH_VERSION) fail();
  const pkg = JSON.parse(await readFile(join(root, 'package.json')));
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json')));
  if (pkg.dependencies?.['@supabase/supabase-js'] !== SUPABASE_VERSION
    || lock.packages?.['node_modules/@supabase/supabase-js']?.version !== SUPABASE_VERSION
    || lock.packages?.['node_modules/@supabase/auth-js']?.version !== AUTH_VERSION) fail();
  const target = join(root, SOURCE_PATH);
  if (sha256(await checkedFile(target)) !== SOURCE_SHA256) fail();
  return { root, target };
}
export function requireSingleModule(inputs, count, root, target, code) {
  const modules = Object.keys(inputs).filter(path => /(?:^|[\\/])(?:lib[\\/])?locks\.[cm]?js$/.test(path));
  const authModules = modules.filter(path => /(?:^|[\\/])@supabase[\\/]auth-js[\\/]/.test(path));
  if (count !== 1 || authModules.length !== 1 || canonical(resolve(root, authModules[0])) !== canonical(target)
    || code.includes('supabase.gotrue-js.locks.debug')) fail();
}
function artifactManifest(code) {
  return { patchId: PATCH_ID, supabaseVersion: SUPABASE_VERSION, authVersion: AUTH_VERSION,
    sourcePath: SOURCE_PATH, sourceSha256: SOURCE_SHA256, replacements: 1, bundleSha256: sha256(code) };
}
export function requireArtifact(manifest, code) {
  if (!manifest || JSON.stringify(manifest) !== JSON.stringify(artifactManifest(code))) fail();
}
/** すべての検査後だけ出力する。元SDKの書換え・別形式への自動パッチはしない。 */
export async function buildAuthBrowser({ root, entryPoint, outfile, write = true }) {
  const installed = await inspectInstalledSdk(root);
  let count = 0;
  const result = await build({ absWorkingDir: installed.root, entryPoints: [entryPoint], outfile, write: false,
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022', metafile: true,
    plugins: [{ name: PATCH_ID, setup(builder) {
      builder.onLoad({ filter: /[\\/]@supabase[\\/]auth-js[\\/].*[\\/]locks\.[cm]?js$/ }, async args => {
        const contents = patchLocksSource(await checkedFile(args.path), args.path, installed.target);
        count++; if (count !== 1) fail();
        return { contents, loader: 'js', resolveDir: dirname(args.path) };
      });
    } }],
  });
  if (result.outputFiles.length !== 1) fail();
  const code = result.outputFiles[0].contents;
  requireSingleModule(result.metafile.inputs, count, installed.root, installed.target, Buffer.from(code).toString('utf8'));
  await inspectInstalledSdk(installed.root);
  const manifest = artifactManifest(code);
  if (write) {
    await mkdir(dirname(outfile), { recursive: true });
    await writeFile(outfile, code);
    await writeFile(`${outfile}.patch.json`, JSON.stringify(manifest));
  }
  return { code, manifest };
}
/** 現在の固定SDK・パッチ記録と成果物の一致を、ブラウザ起動前に確認する。ソースの鮮度証明ではない。 */
export async function verifyAuthArtifact(root, outfile) {
  await inspectInstalledSdk(root);
  requireArtifact(JSON.parse(await readFile(`${outfile}.patch.json`, 'utf8')), await checkedFile(outfile));
}

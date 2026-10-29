import { lstat, realpath, mkdir, mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

const fail = (): never => { throw new Error('Profile ownership check failed; no deletion performed'); };
const canonical = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;

/** 祖先も含めてリンク／junction経由を拒否する。パス文字列のprefix比較だけで所有を判定しない。 */
export async function verifyDirectory(path: string): Promise<void> {
  const absolute = resolve(path), parent = dirname(absolute);
  if (parent !== absolute) await verifyDirectory(parent);
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink() || canonical(await realpath(absolute)) !== canonical(absolute)) fail();
}
async function verifyTree(path: string): Promise<void> {
  for (const entry of await readdir(path)) {
    const child = join(path, entry), info = await lstat(child);
    if (info.isSymbolicLink()) fail();
    if (info.isDirectory()) await verifyTree(child);
    else if (!info.isFile()) fail();
  }
}

/** 呼出側から削除パスを受けない。生成したprofileだけを私有リストで追跡し、親は再帰削除しない。 */
export async function createProfileOwner(base: string) {
  await verifyDirectory(base);
  const runRoot = await mkdtemp(join(resolve(base), 'memo-run-'));
  await verifyDirectory(runRoot);
  const runId = randomUUID(), owned = new Map<string, { marker: string; dev: number; ino: number }>();
  return {
    runId,
    async create() {
      await verifyDirectory(runRoot);
      const profile = await mkdtemp(join(runRoot, 'profile-'));
      const marker = JSON.stringify({ runId, profile, owner: randomUUID() });
      await writeFile(join(profile, '.memo-test-owner.json'), marker, { flag: 'wx' });
      const info = await lstat(profile); owned.set(profile, { marker, dev: info.dev, ino: info.ino });
      return profile;
    },
    async verify(profile: string) {
      const record = owned.get(profile), path = resolve(profile), rel = relative(runRoot, path);
      if (!record) return fail();
      if (path !== profile || dirname(path) !== runRoot || isAbsolute(rel) || rel.startsWith('..')) fail();
      await verifyDirectory(path);
      const info = await lstat(path), markerPath = join(path, '.memo-test-owner.json');
      const markerInfo = await lstat(markerPath);
      if (info.dev !== record.dev || info.ino !== record.ino || !markerInfo.isFile() || markerInfo.isSymbolicLink()
        || await readFile(markerPath, 'utf8') !== record.marker) fail();
    },
    async dispose(profile: string, beforeFinalCheck?: () => Promise<void>) {
      await this.verify(profile);
      // Chromium終了後だけ呼ぶ。全木のリンク検査後に所有と根を再確認する。
      await verifyTree(profile); await this.verify(profile);
      // 故障注入はテストだけ。最終検査も原子的な削除保護とは扱わない。
      await beforeFinalCheck?.();
      await verifyTree(profile); await this.verify(profile);
      await rm(profile, { recursive: true, force: false });
      try { await lstat(profile); throw new Error('Profile disposal not verified'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await verifyDirectory(runRoot); owned.delete(profile);
    },
  };
}

/** 固定の試験用親だけを作成する。既存junctionを辿って作成しない。 */
export async function prepareProfileBase(workspace: string) {
  await verifyDirectory(workspace);
  const base = join(resolve(workspace), '.browser-profiles');
  try { await mkdir(base); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  await verifyDirectory(base); return base;
}

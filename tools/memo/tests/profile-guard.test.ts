import { it, expect } from 'vitest';
import { join } from 'node:path';
import { readFile, writeFile, lstat, symlink, unlink } from 'node:fs/promises';
import { createProfileOwner, prepareProfileBase } from './persistence/profile-guard';

it('自分が生成したprofileだけを検証・破棄できる', async () => {
  const owner = await createProfileOwner(await prepareProfileBase(process.cwd())); const profile = await owner.create();
  await owner.verify(profile); await expect(owner.dispose(join(profile, '..'))).rejects.toThrow('ownership');
  await expect(owner.dispose(process.cwd())).rejects.toThrow('ownership');
  await owner.dispose(profile); await expect(lstat(profile)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('所有記録を変更したら削除せず停止する', async () => {
  const owner = await createProfileOwner(await prepareProfileBase(process.cwd())); const profile = await owner.create();
  const marker = join(profile, '.memo-test-owner.json'), original = await readFile(marker, 'utf8');
  await writeFile(marker, '{}'); await expect(owner.dispose(profile)).rejects.toThrow('ownership');
  expect((await lstat(profile)).isDirectory()).toBe(true);
  // このテスト自身が生成した所有記録だけを戻し、通常の所有検証を通して後片付けする。
  await writeFile(marker, original); await owner.dispose(profile);
});
it('子孫のjunction／symlinkを検出したら外側の対象も削除しない', async () => {
  const owner = await createProfileOwner(await prepareProfileBase(process.cwd()));
  const profile = await owner.create(), target = await owner.create(), link = join(profile, 'synthetic-link');
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(owner.dispose(profile)).rejects.toThrow('ownership');
  expect((await lstat(target)).isDirectory()).toBe(true); expect((await lstat(profile)).isDirectory()).toBe(true);
  // 自分が今作ったリンクだけを解除。リンク先の再帰削除は行わない。
  await unlink(link); await owner.dispose(profile); await owner.dispose(target);
});
it('最初の検査後に直接の子へ差し込んだリンクも最終検査で拒否する', async () => {
  const owner = await createProfileOwner(await prepareProfileBase(process.cwd()));
  const profile = await owner.create(), target = await owner.create(), link = join(profile, 'late-link');
  const targetMarker = await readFile(join(target, '.memo-test-owner.json'), 'utf8');
  await expect(owner.dispose(profile, () => symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir'))).rejects.toThrow('ownership');
  expect((await lstat(profile)).isDirectory()).toBe(true);
  expect(await readFile(join(target, '.memo-test-owner.json'), 'utf8')).toBe(targetMarker);
  await unlink(link); await owner.dispose(profile); await owner.dispose(target);
  await expect(lstat(profile)).rejects.toMatchObject({ code: 'ENOENT' });
});

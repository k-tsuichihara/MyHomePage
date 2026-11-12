import { expect, it } from 'vitest';
import { createLocalMemoStore } from '../src/local-memo-store';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';
import { saveFixture, request } from './local-save-fixtures';

it('製品の初回明示保存でv3を生成し、loadだけでは書き込まない', async () => {
  const f = saveFixture(null);
  const store = createLocalMemoStore({ ...f.deps, initialVersion: 3 });
  expect(await store.load()).toEqual({ kind: 'empty' });
  expect(f.storage.writes).toEqual([]);
  expect((await store.save({ ...request(), expectedRevision: null, tagIds: [] })).kind).toBe('saved');
  const raw = JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!);
  expect(raw.version).toBe(3); expect(raw.deletedMemoIds).toEqual([]);
  expect(f.storage.values.has(OLD_STORAGE_KEY)).toBe(false);
});

it('製品設定でも既存v2を通常保存で自動更新しない', async () => {
  const f = saveFixture();
  const store = createLocalMemoStore({ ...f.deps, initialVersion: 3 });
  expect((await store.save(request())).kind).toBe('saved');
  expect(JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!).version).toBe(2);
});

it('旧キーが存在する場合は新規v3を生成しない', async () => {
  const f = saveFixture(null); f.storage.values.set(OLD_STORAGE_KEY, '[]');
  const store = createLocalMemoStore({ ...f.deps, initialVersion: 3 });
  expect(await store.save({ ...request(), expectedRevision: null, tagIds: [] })).toMatchObject({ kind: 'rejected', reason: 'migration-required' });
  expect(f.storage.values.get(OLD_STORAGE_KEY)).toBe('[]');
  expect(f.storage.values.has(NEW_STORAGE_KEY)).toBe(false);
});

it('不正な既存値は空領域として初期化しない', async () => {
  const f = saveFixture(null); f.storage.values.set(NEW_STORAGE_KEY, '{');
  const store = createLocalMemoStore({ ...f.deps, initialVersion: 3 });
  expect(await store.save({ ...request(), expectedRevision: null, tagIds: [] })).toMatchObject({ kind: 'rejected', reason: 'invalid-data' });
  expect(f.storage.values.get(NEW_STORAGE_KEY)).toBe('{');
  expect(f.storage.writes).toEqual([]);
});

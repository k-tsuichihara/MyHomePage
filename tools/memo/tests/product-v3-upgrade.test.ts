import { expect, it } from 'vitest';
import { createProductV3Upgrade } from '../src/product-v3-upgrade';
import { saveFixture } from './local-save-fixtures';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';

it('退避後の明示更新だけを実行し、元データと旧キーを保持する', async () => {
  const f = saveFixture(); const raw = f.storage.values.get(NEW_STORAGE_KEY)!;
  const service = createProductV3Upgrade(f.deps);
  await service.confirm(); expect(f.storage.writes).toHaveLength(0);
  expect((await service.prepare()).kind).toBe('prepared');
  expect(f.storage.writes).toHaveLength(0);
  await Promise.all([service.confirm(), service.confirm()]);
  expect(service.getState()).toBe('updated');
  expect(f.storage.writes).toHaveLength(1);
  expect(JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!)).toEqual({ ...JSON.parse(raw), version: 3, deletedMemoIds: [] });
  f.storage.values.set(OLD_STORAGE_KEY, '[]');
  expect(() => service.storage.getItem(NEW_STORAGE_KEY)).toThrow();
  expect(service.getState()).toBe('legacy-changed');
  expect(() => service.storage.setItem(NEW_STORAGE_KEY, raw)).toThrow();
  expect(f.storage.writes).toHaveLength(1);
});

it.each([NEW_STORAGE_KEY, OLD_STORAGE_KEY])('退避後の%s変更では未書込拒否', async key => {
  const f = saveFixture(); const service = createProductV3Upgrade(f.deps);
  await service.prepare(); f.storage.values.set(key, 'changed'); await service.confirm();
  expect(service.getState()).toBe('rejected'); expect(f.storage.writes).toHaveLength(0);
});

it('書込後例外はunknown、再送/巻戻しなし、現在診断は可能', async () => {
  const f = saveFixture();
  const service = createProductV3Upgrade({ ...f.deps, storage: {
    getItem: key => f.storage.getItem(key),
    setItem(key, value) { f.storage.setItem(key, value); throw new Error('synthetic'); },
  } });
  await service.prepare(); await service.confirm();
  expect(service.getState()).toBe('unknown');
  await service.confirm(); await service.prepare();
  expect(f.storage.writes).toHaveLength(1);
  expect(await service.diagnose()).toBe('v3');
  expect(service.getState()).toBe('unknown');
  expect(() => service.storage.setItem(NEW_STORAGE_KEY, '{}')).toThrow();
});

it('読戻し不一致はunknownで自動修復しない', async () => {
  const f = saveFixture(); let written = false;
  const service = createProductV3Upgrade({ ...f.deps, storage: {
    getItem: key => written && key === NEW_STORAGE_KEY ? '{}' : f.storage.getItem(key),
    setItem(key, value) { f.storage.setItem(key, value); written = true; },
  } });
  await service.prepare(); await service.confirm();
  expect(service.getState()).toBe('unknown'); expect(f.storage.writes).toHaveLength(1);
});

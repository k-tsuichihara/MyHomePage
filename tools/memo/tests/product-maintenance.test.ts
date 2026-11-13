import { expect, it } from 'vitest';
import { showProductMaintenance } from '../src/product-maintenance';
import { saveFixture } from './local-save-fixtures';
import { NEW_STORAGE_KEY } from '../src/local-migration';

it.each(['v2', 'v3', 'invalid', 'empty'])('保守表示%sは既存loadを使い無書込', async mode => {
  const f = saveFixture();
  if (mode === 'v3') f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify({ ...JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!), version: 3, deletedMemoIds: [] }));
  if (mode === 'invalid') f.storage.values.set(NEW_STORAGE_KEY, '{');
  if (mode === 'empty') f.storage.values.clear();
  const before = [...f.storage.values]; const status = { textContent: '' };
  await showProductMaintenance({ getElementById: () => status } as unknown as Document, f.storage, f.locks);
  expect(status.textContent).toContain('書込停止');
  if (mode === 'v2' || mode === 'v3') expect(status.textContent).toContain(`検証済み${mode}`);
  else expect(status.textContent).toContain('自動修復・削除は行いません');
  expect([...f.storage.values]).toEqual(before); expect(f.storage.writes).toEqual([]);
});

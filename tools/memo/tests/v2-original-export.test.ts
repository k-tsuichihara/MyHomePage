import { expect, it } from 'vitest';
import { createV2OriginalExport } from '../src/v2-original-export';
import { saveFixture } from './local-save-fixtures';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';

it.each([null, ' 旧原値\n😀 '])('v2原文字列と旧値%sを無変更で退避する', async legacy => {
  const f = saveFixture(); if (legacy !== null) f.storage.values.set(OLD_STORAGE_KEY, legacy);
  const raw = f.storage.values.get(NEW_STORAGE_KEY)!;
  const result = await createV2OriginalExport(f.deps)();
  expect(result.kind).toBe('prepared');
  if (result.kind !== 'prepared') throw new Error('expected prepared');
  const value = JSON.parse(result.json);
  expect(value.values).toEqual({ [OLD_STORAGE_KEY]: legacy, [NEW_STORAGE_KEY]: raw });
  expect(result.bytes).toBe(new TextEncoder().encode(result.json).length);
  expect(f.storage.writes).toEqual([]);
});

it('診断中の原値変化を拒否する', async () => {
  const f = saveFixture(); let reads = 0;
  const result = await createV2OriginalExport({ ...f.deps, storage: { getItem(key) {
    const raw = f.storage.getItem(key); return ++reads === 4 ? raw + ' ' : raw;
  } } })();
  expect(result).toEqual({ kind: 'failed', reason: 'snapshot-changed' });
  expect(f.storage.writes).toEqual([]);
});

it('v3をv2原値として出力しない', async () => {
  const f = saveFixture(); const value = JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!);
  f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify({ ...value, version: 3, deletedMemoIds: [] }));
  expect(await createV2OriginalExport(f.deps)()).toEqual({ kind: 'failed', reason: 'invalid-data' });
  expect(f.storage.writes).toEqual([]);
});

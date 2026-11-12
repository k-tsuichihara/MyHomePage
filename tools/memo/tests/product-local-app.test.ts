import { describe, expect, it, vi } from 'vitest';
import { createProductLocalApp } from '../src/product-local-app';
import type { ProductLocalViews } from '../src/product-local-app';
import { NEW_STORAGE_KEY } from '../src/local-migration';

describe('product local composition', () => {
  it('正常v3は入場でき、dispose後のUI操作は書き込まない', async () => {
    const raw = JSON.stringify({ version: 3, migration: { status: 'not-required' }, memos: [], tags: [], memoTags: [], deletedMemoIds: [] });
    const write = vi.fn();
    let migration!: Parameters<ProductLocalViews['mountMigration']>[1];
    let memo!: Parameters<ProductLocalViews['mountMemo']>[1];
    let enter!: () => Promise<boolean>;
    let backup!: Parameters<NonNullable<ProductLocalViews['mountBackup']>>[1];
    const backupDispose = vi.fn();
    const app = createProductLocalApp({} as Document, {
      storage: { getItem: key => key === NEW_STORAGE_KEY ? raw : null, setItem: write },
      locks: { request: async (_name, _options, callback) => callback() },
      createId: () => '00000000-0000-4000-8000-000000000001', now: () => '2026-11-12T00:00:00.000Z',
    }, {
      mountMigration: (_doc, port, next) => { migration = port; enter = next; },
      mountMemo: (_doc, port) => { memo = port; return () => {}; },
      mountBackup: (_doc, prepare) => { backup = prepare; return backupDispose; },
    });
    await migration.inspect();
    expect(await enter()).toBe(true);
    expect((await backup()).kind).toBe('prepared');
    app.dispose();
    expect(backupDispose).toHaveBeenCalledTimes(1);
    expect(await backup()).toEqual({ kind: 'failed', reason: 'read-failure' });
    expect(await memo.dispatch({ kind: 'new' })).toEqual({ kind: 'blocked', reason: 'disposed' });
    await migration.inspect(); await migration.confirm(0);
    expect(write).not.toHaveBeenCalled();
  });
  it('ready前の入場を拒否し、移行readyと通常load成功後だけメモUIを接続する', async () => {
    const values = new Map<string, string>();
    let enter!: () => Promise<boolean>;
    const dispose = vi.fn();
    const views: ProductLocalViews = {
      mountMigration: vi.fn((_doc, _controller, next) => { enter = next; }),
      mountMemo: vi.fn(() => dispose),
    };
    const app = createProductLocalApp({} as Document, {
      storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } },
      locks: { request: async (_name, _options, callback) => callback() },
      createId: () => '00000000-0000-4000-8000-000000000001', now: () => '2026-11-12T00:00:00.000Z',
    }, views);
    expect(views.mountMemo).not.toHaveBeenCalled();
    expect(await enter()).toBe(false);
    expect(app.controller.getState().read.kind).toBe('idle');
    expect(views.mountMemo).not.toHaveBeenCalled();
    await app.migration.inspect();
    expect(app.migration.getState().kind).toBe('ready');
    expect(await enter()).toBe(true);
    expect(views.mountMemo).toHaveBeenCalledTimes(1);
    app.dispose(); app.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

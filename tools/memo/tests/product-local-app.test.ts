import { describe, expect, it, vi } from 'vitest';
import { createProductLocalApp } from '../src/product-local-app';
import type { ProductLocalViews } from '../src/product-local-app';

describe('product local composition', () => {
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

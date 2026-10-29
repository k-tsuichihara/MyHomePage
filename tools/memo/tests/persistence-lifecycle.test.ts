import { it, expect, vi } from 'vitest';
import { initializeContext, runOwnedCase } from './persistence/lifecycle';

it('初期化例外ではContextを一回閉じる', async () => {
  const close = vi.fn(async () => {}), error = new Error('Synthetic initialization failure');
  await expect(initializeContext(async () => ({ close }), async () => { throw error; })).rejects.toBe(error);
  expect(close).toHaveBeenCalledTimes(1);
});
it('Context生成自体の失敗は初期化せず伝える', async () => {
  const initialize = vi.fn(), error = new Error('Synthetic launch failure');
  await expect(initializeContext(async () => { throw error; }, initialize)).rejects.toBe(error); expect(initialize).not.toHaveBeenCalled();
});
it('終了失敗も隠さず両方の原因を保持する', async () => {
  await expect(initializeContext(async () => ({ close: async () => { throw new Error('close'); } }), async () => { throw new Error('initialize'); })).rejects.toBeInstanceOf(AggregateError);
});
it.each([true, false])('ケース失敗は削除せず、所有再確認とパスを報告：%s', async valid => {
  const error = new Error('PRIVATE payload'), report = vi.fn(), dispose = vi.fn(async () => {});
  let checks = 0;
  const owner = { runId: 'synthetic-run', dispose, async verify() { if (++checks > 1 && !valid) throw new Error('ownership'); } };
  await expect(runOwnedCase(owner, '/synthetic/owned-profile', async () => { throw error; }, report)).rejects.toBe(error);
  expect(dispose).not.toHaveBeenCalled(); expect(report).toHaveBeenCalledExactlyOnceWith({ event: 'PRESERVED', runId: 'synthetic-run', profile: '/synthetic/owned-profile', ownership: valid ? 'verified' : 'unverified' });
  expect(JSON.stringify(report.mock.calls)).not.toContain('PRIVATE');
});
it('成功したケースだけdisposeする', async () => {
  const dispose = vi.fn(async () => {}), report = vi.fn();
  await runOwnedCase({ runId: 'test', verify: async () => {}, dispose }, '/synthetic/owned-profile', async () => {}, report);
  expect(dispose).toHaveBeenCalledExactlyOnceWith('/synthetic/owned-profile'); expect(report).not.toHaveBeenCalled();
});

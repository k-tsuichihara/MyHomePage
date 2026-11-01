import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createTestHttpTransport, DEV_ORIGIN, RPC_KEYS } from './cloud-live/http-transport';
import type { FetchPort } from './cloud-live/http-transport';
import { createOfflineRunner, PHASES } from './cloud-live/runner';
import type { Manifest, Phase } from './cloud-live/runner';
import { A, B, M, T, manifest, runOffline, syntheticReplies } from './cloud-live/offline-scenario';
import { INPUT_VECTORS, TAG_VECTORS, PRIMITIVE_VECTORS, sqlVectorPlan } from './cloud-live/vectors';
import { normalizeMemoInput, tagKey } from '../src/input';
import { instant, revision, uuid, uuidKey } from '../src/read-primitives';
import { createCloudRpcAdapter } from '../src/cloud-rpc-adapter';
import { createSyntheticPort } from './cloud-live/synthetic-port';
const fresh = () => createSyntheticPort(syntheticReplies());

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const config = () => ({ origin: DEV_ORIGIN, publishableKey: 'sb_publishable_SYNTHETIC_ONLY', accessToken: 'synthetic.payload.signature' });
function http(status = 200, text = '{}') {
  return vi.fn<FetchPort>(async url => ({ status, url, redirected: false, text: async () => text }));
}
async function through(runner: ReturnType<typeof createOfflineRunner>, end: Phase) {
  for (const phase of PHASES) { await runner.run(phase, runner.authorize(phase)); if (phase === end) break; }
  return runner.evidence();
}
describe('テスト専用HTTP境界（偽fetchのみ）', () => {
  it('固定Project Refは既存CLIと一致し、実設定は読まない', () => {
    const cli = readFileSync(new URL('../../memo-db-test/cli.mjs', import.meta.url), 'utf8');
    expect(DEV_ORIGIN).toBe(`https://${cli.match(/const DEV_SANDBOX_PROJECT_REF = '([a-z]+)'/)![1]}.supabase.co`);
  });
  it.each(['http://yohoppqflnhhvqypwhfv.supabase.co', `${DEV_ORIGIN}/`, `${DEV_ORIGIN}:443`, `${DEV_ORIGIN}?x=1`,
    `${DEV_ORIGIN}#x`, 'https://example.com', 'https://user:pass@yohoppqflnhhvqypwhfv.supabase.co'])('origin境界%sを送信前拒否', origin => {
    const fetchPort = http(); expect(() => createTestHttpTransport({ ...config(), origin }, fetchPort)).toThrow('boundary'); expect(fetchPort).not.toHaveBeenCalled();
  });
  it('キー形式・header改行・未注入fetchは送信前拒否', () => {
    const fetchPort = http();
    expect(() => createTestHttpTransport({ ...config(), publishableKey: 'sb_secret_SYNTHETIC' }, fetchPort)).toThrow('boundary');
    expect(() => createTestHttpTransport({ ...config(), accessToken: 'a.b.c\r\nsecret' }, fetchPort)).toThrow('boundary');
    expect(() => createTestHttpTransport(config(), undefined as unknown as FetchPort)).toThrow('boundary'); expect(fetchPort).not.toHaveBeenCalled();
  });
  it('8RPCのパスと引数だけをPOST1回/redirect:error/15秒signalで送る', async () => {
    const fetchPort = http(), timeout = vi.spyOn(AbortSignal, 'timeout');
    const transport = createTestHttpTransport(config(), fetchPort);
    expect(Object.values(RPC_KEYS).every(Object.isFrozen)).toBe(true);
    for (const [rpc, keys] of Object.entries(RPC_KEYS)) {
      const args = Object.fromEntries(keys.map(key => [key, key.endsWith('ids') || key === 'p_revisions' ? [] : null]));
      const result = await transport(rpc as keyof typeof RPC_KEYS, args);
      expect(result).toEqual({ provenance: 'unverified', status: 200, body: {} });
      expect(fetchPort).toHaveBeenLastCalledWith(`${DEV_ORIGIN}/rest/v1/rpc/${rpc}`, expect.objectContaining({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal), body: JSON.stringify(args) }));
    }
    expect(fetchPort).toHaveBeenCalledTimes(8); expect(timeout.mock.calls).toEqual(Array(8).fill([15000]));
  });
  it('任意RPC・未知引数・toJSONや非JSON値を未通信で拒否する', async () => {
    const fetchPort = http(), transport = createTestHttpTransport(config(), fetchPort);
    await expect(transport('../auth/v1/token' as never, {})).rejects.toThrow('boundary');
    await expect(transport('memo_load_snapshot', { extra: '秘密' })).rejects.toThrow('boundary');
    await expect(transport('memo_delete_tag', { p_id: undefined, p_expected_revision: NaN } as never)).rejects.toThrow('boundary');
    expect(fetchPort).not.toHaveBeenCalled();
  });
  it.each([[200, '{"status":"previously-applied-deleted"}'], [200, 'null'], [204, ''],
    [500, '{"code":"P0002","message":"memo not found"}'], [409, '{"code":"PT409","message":"memo revision conflict"}']] as const)
  ('HTTP%sのstatus/bodyは保持するが出所を認定しない', async (status, text) => {
    const result = await createTestHttpTransport(config(), http(status, text))('memo_load_snapshot', {});
    expect(result).toEqual({ provenance: 'unverified', status, body: status === 204 ? undefined : JSON.parse(text) });
  });
  it.each([301, 302, 307, 308])('HTTP%sで追従・再試行しない', async status => {
    const fetchPort = http(status); await expect(createTestHttpTransport(config(), fetchPort)('memo_load_snapshot', {})).rejects.toThrow('redirect'); expect(fetchPort).toHaveBeenCalledTimes(1);
  });
  it('応答URLの変更やredirectedを拒否する', async () => {
    for (const response of [{ status: 200, url: 'https://example.com', redirected: false }, { status: 200, url: `${DEV_ORIGIN}/rest/v1/rpc/memo_load_snapshot`, redirected: true }])
      await expect(createTestHttpTransport(config(), async () => ({ ...response, text: async () => '{}' }))('memo_load_snapshot', {})).rejects.toThrow('redirect');
  });
  it('通信断・本文障害・JSON解析失敗は固定理由だけで、再送しない', async () => {
    const secret = 'SYNTHETIC_SECRET';
    const ports: [FetchPort, string][] = [
      [async () => { throw Error(secret); }, 'communication'],
      [async url => ({ status: 200, url, redirected: false, text: async () => { throw Error(secret); } }), 'body'],
      [http(200, secret), 'json'], [http(204, '{}'), 'json'],
    ];
    for (const [port, reason] of ports) {
      const fetchPort = vi.fn(port); let caught: unknown;
      try { await createTestHttpTransport(config(), fetchPort)('memo_load_snapshot', {}); } catch (error) { caught = error; }
      expect(caught).toMatchObject({ reason, message: `Test transport stopped: ${reason}` }); expect(String(caught)).not.toContain(secret);
      expect(fetchPort).toHaveBeenCalledTimes(1);
    }
  });
  it.each(['fetch', 'body'] as const)('%s中のtimeoutも応答内容を漏らさない', async stage => {
    const controller = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fail = () => { controller.abort(); throw Error('SYNTHETIC_SECRET'); };
    const port: FetchPort = async url => stage === 'fetch' ? fail() : ({ status: 200, url, redirected: false, text: async () => fail() });
    await expect(createTestHttpTransport(config(), port)('memo_load_snapshot', {})).rejects.toMatchObject({ reason: 'timeout', message: 'Test transport stopped: timeout' });
  });
});

describe('一回限りの段階実行と停止', () => {
  it('実HTTP関数や同形の偽ポートはofflineへ接続できない', () => {
    const fakeFetch = http(), transport = createTestHttpTransport(config(), fakeFetch);
    expect(() => createOfflineRunner(manifest(), transport as never)).toThrow('synthetic');
    expect(() => createOfflineRunner(manifest(), { calls: () => [] })).toThrow('synthetic');
    expect(fakeFetch).not.toHaveBeenCalled();
  });
  it('無指定は通信なし、許可なしなら0回で停止', async () => {
    const simulate = fresh(), runner = createOfflineRunner(manifest(), simulate);
    expect((await runner.run()).at(-1)).toMatchObject({ outcome: 'STOP', reason: 'permission' }); expect(simulate.calls()).toHaveLength(0);
  });
  it('全段階・全8RPCを固定manifestの上限内で実行する', async () => {
    const simulate = fresh(), runner = createOfflineRunner(manifest(), simulate);
    const events = await through(runner, 'delete'); expect(events).toHaveLength(10); expect(events.every(e => e.outcome === 'PASS')).toBe(true);
    expect(simulate.calls()).toHaveLength(10); expect(new Set(simulate.calls()).size).toBe(8);
    expect(events.at(-1)).toMatchObject({ calls: 3, changeBudget: 3 });
  });
  it.each(['forged', 'other-run', 'other-phase', 'reused'] as const)('%s許可は流用できない', async mode => {
    const simulate = fresh(), runner = createOfflineRunner(manifest(), simulate), permit = runner.authorize('read');
    let target = runner, phase: Phase = 'read', token = permit;
    if (mode === 'forged') token = {};
    if (mode === 'other-run') target = createOfflineRunner(manifest(), simulate);
    if (mode === 'other-phase') phase = 'write';
    if (mode === 'reused') await runner.run('read', permit);
    const before = simulate.calls().length; expect((await target.run(phase, token)).at(-1)).toMatchObject({ outcome: 'STOP', reason: 'permission' });
    expect(simulate.calls()).toHaveLength(before);
  });
  it('再許可・段階飛ばしを禁止する', () => {
    const runner = createOfflineRunner(manifest(), fresh()); runner.authorize('read');
    expect(() => runner.authorize('read')).toThrow('permission'); expect(() => runner.authorize('delete')).toThrow('permission');
  });
  it.each(['calls', 'changes', 'targets'] as const)('%s上限違反は次の送信前に停止する', async limit => {
    const base = manifest(), plan: Manifest = { ...base, phases: { ...base.phases, write: { ...base.phases.write,
      ...(limit === 'calls' ? { maxCalls: 1 } : limit === 'changes' ? { maxChanges: 1 } : { targets: [] }) } } };
    const simulate = fresh(), runner = createOfflineRunner(plan, simulate); await through(runner, 'read');
    const result = await runner.run('write', runner.authorize('write'));
    expect(result.at(-1)).toMatchObject({ outcome: 'STOP', reason: limit === 'targets' ? 'target' : 'budget' });
    const calls = simulate.calls().length; await runner.run('delete'); expect(simulate.calls()).toHaveLength(calls);
  });
  it('入力manifestの後続変更を反映しない', async () => {
    const input = manifest(), runner = createOfflineRunner(input, fresh());
    (input.phases.read as { maxCalls: number }).maxCalls = 0;
    expect((await through(runner, 'read')).every(e => e.outcome === 'PASS')).toBe(true);
  });
  it('A/B同一ユーザーと任意case文字列は開始前拒否', () => {
    expect(() => createOfflineRunner({ ...manifest(), users: { A, B: A } }, fresh())).toThrow();
    const base = manifest(); expect(() => createOfflineRunner({ ...base, steps: [{ ...base.steps[0]!, id: '秘密' }] }, fresh())).toThrow();
  });
  it('一括対象数より少ない変更上限を許可しない', () => {
    const base = manifest(), step = base.steps.find(s => s.id === 'D03')!;
    expect(() => createOfflineRunner({ ...base, steps: [{ ...step, args: { p_ids: [M, T], p_revisions: [1, 1] }, maxChanges: 1 }] }, fresh())).toThrow('manifest');
  });
  it.each(['read', 'write', 'conflict'] as const)('%s許可に削除RPCを混在させない', phase => {
    const base = manifest(), step = base.steps.find(s => s.id === 'D01')!;
    expect(() => createOfflineRunner({ ...base, steps: [{ ...step, phase }] }, fresh())).toThrow('manifest');
  });
  it('非同期再入は未送信で停止し、進行中の1要求以上に拡大しない', async () => {
    let finish!: () => void;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const simulate = createSyntheticPort(syntheticReplies().map((reply, i) => i === 0 ? { ...reply, wait } : reply));
    const runner = createOfflineRunner(manifest(), simulate), permit = runner.authorize('read'), pending = runner.run('read', permit);
    expect((await runner.run('read', permit)).at(-1)).toMatchObject({ reason: 'busy' });
    finish(); await pending;
    expect(simulate.calls()).toHaveLength(1); expect(() => runner.authorize('write')).toThrow();
  });
  it.each(['unknown', 'owner', 'unexpected-success', 'comparison'] as const)('%s後は書込を追加せずサニタイズ証跡だけを返す', async fault => {
    const simulate = createSyntheticPort(syntheticReplies().map(reply => {
      if (reply.rpc !== 'memo_save_tag') return reply;
      if (fault === 'unknown') return { rpc: reply.rpc, fail: true };
      if (fault === 'owner') return { rpc: reply.rpc, response: { provenance: 'single-rpc', status: 200, body: { id: T, user_id: B, name: 'Tag', created_at: '2026-11-02T00:00:00Z', revision: 1 } } };
      return reply;
    }));
    const base = manifest(), plan: Manifest = { ...base, steps: base.steps.map(s => s.id !== 'W01' ? s : { ...s,
      expected: fault === 'unexpected-success' ? { kind: 'rejected', reason: 'constraint' } : fault === 'comparison' ? { kind: 'ok', value: 'SYNTHETIC_SECRET' } : s.expected }) };
    const runner = createOfflineRunner(plan, simulate); await through(runner, 'read'); const events = await runner.run('write', runner.authorize('write'));
    expect(events.at(-1)).toMatchObject({ outcome: 'STOP' }); expect(simulate.calls()).toHaveLength(3);
    const printed = JSON.stringify(events); for (const privateValue of ['SYNTHETIC_SECRET', A, M, '合成本文', 'p_name', 'Authorization']) expect(printed).not.toContain(privateValue);
    await runner.run('delete'); expect(simulate.calls()).toHaveLength(3);
  });
  it('receipt/no-record/500P0002も既存adapterを通して判定する', async () => {
    for (const [body, status, expected] of [[null, 200, { kind: 'ok', valueKind: 'no-record' }],
      [{ status: 'previously-applied-deleted' }, 200, { kind: 'ok', valueKind: 'previously-applied-deleted' }],
      [{ code: 'P0002', message: 'memo not found' }, 500, { kind: 'rejected', reason: 'not-found' }]] as const) {
      const base = manifest(), step = base.steps.find(s => s.id === (status === 500 ? 'W02' : 'W04'))!;
      const plan: Manifest = { ...base, steps: [{ ...step, phase: 'write', expected }] };
      const runner = createOfflineRunner(plan, createSyntheticPort([{ rpc: step.rpc, response: { provenance: 'single-rpc', status, body } }]));
      await through(runner, 'write'); expect(runner.evidence().at(-1)).toMatchObject({ outcome: 'PASS' });
    }
  });
  it('未認定HTTP境界をadapterへ渡すとunknownで止まり、拒否へ格上げしない', async () => {
    const adapter = createCloudRpcAdapter(A, createTestHttpTransport(config(), http(500, '{"code":"P0002","message":"memo not found"}')));
    expect(await adapter.deleteTag(T, 1)).toMatchObject({ kind: 'unknown', reason: 'unverified-response' });
  });
});

describe('共通ベクトルと通信なし入口', () => {
  it.each(INPUT_VECTORS)('$idは正式入力規則の期待値と一致する', vector => {
    if (vector.normalized === null) expect(() => normalizeMemoInput(vector.title, vector.body)).toThrow();
    else expect(normalizeMemoInput(vector.title, vector.body)).toEqual(vector.normalized);
  });
  it.each(TAG_VECTORS)('tagKey($name)は$key', vector => expect(tagKey(vector.name)).toBe(vector.key));
  it('UUID/日時/revisionの受理・拒否を照合し、SQL側は未実行と明示する', () => {
    for (const [values, validator] of [[PRIMITIVE_VECTORS.uuid, uuid], [PRIMITIVE_VECTORS.instant, instant], [PRIMITIVE_VECTORS.revision, (raw: unknown) => revision(raw, true)]] as const) {
      values.accept.forEach(value => expect(() => validator(value)).not.toThrow()); values.reject.forEach(value => expect(() => validator(value)).toThrow());
    }
    expect(uuidKey(PRIMITIVE_VECTORS.uuid.accept[0])).toBe(uuidKey(PRIMITIVE_VECTORS.uuid.accept[1]));
    expect(sqlVectorPlan().every(v => v.sqlStatus === 'not-run')).toBe(true);
    expect(sqlVectorPlan().find(v => v.id === 'trim-edges')).toMatchObject({ rawExpected: 'reject', normalizedLane: { title: '題' } });
  });
  it('offline入口は実fetch/Auth/設定/HTTP境界を含まない依存グラフで動く', async () => {
    const forbidden = vi.fn(() => { throw Error('External access forbidden'); }); vi.stubGlobal('fetch', forbidden);
    expect((await runOffline()).every(e => e.outcome === 'PASS')).toBe(true); expect(forbidden).not.toHaveBeenCalled();
    const result = await build({ entryPoints: [fileURLToPath(new URL('./cloud-live/offline-entry.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, metafile: true });
    const paths = Object.keys(result.metafile!.inputs).join('\n');
    expect(paths).not.toMatch(/http-transport|cli\.mjs|\.env|auth/i);
    const code = result.outputFiles[0]!.text; expect(code).not.toContain('process.env'); expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toContain(DEV_ORIGIN); expect(code).toContain('Only fixed offline execution is allowed');
  });
});

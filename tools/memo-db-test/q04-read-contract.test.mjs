import test from 'node:test';
import assert from 'node:assert/strict';
import { createQ04ReadCheck, Q04_READ_LIMITS } from './q04-read-contract.mjs';
import { DEV_SANDBOX_PROJECT_REF } from './cli.mjs';

const origin = `https://${DEV_SANDBOX_PROJECT_REF}.supabase.co`;
const secret = 'secret-email@example.invalid PASSWORD JWT APIKEY UUID raw-provider-message';
const credentials = { email: 'synthetic@example.invalid', password: secret };
const userId = '10000000-0000-4000-8000-000000000001';
const response = (url, status, data) => ({ url, status, redirected: false, text: async () => JSON.stringify(data) });
function fixture(overrides = {}) {
  const calls = [], records = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
    assert.ok(init.signal); assert.equal(init.signal.aborted, false);
    if (url.includes('/auth/')) {
      assert.deepEqual(JSON.parse(init.body), credentials);
      return response(url, 200, { access_token: secret, user: { id: userId } });
    }
    if (url.endsWith('/memo_load_snapshot')) return response(url, 200, { memos: [], tags: [], memoTags: [] });
    const name = url.split('/').at(-1);
    return response(url, init.headers.Authorization ? 403 : 401,
      { code: '42501', message: `permission denied for function ${name}` });
  };
  const check = createQ04ReadCheck({ origin, key: 'sb_publishable_synthetic', fetchImpl: fake,
    record: async value => records.push(value), ...overrides });
  return { check, calls, records, fake };
}

test('import/construction/approval refusal do not send; preflight fails closed', async () => {
  const f = fixture(); assert.equal(f.calls.length, 0);
  assert.equal((await f.check.run(credentials)).reason, 'approval-required');
  assert.equal(f.calls.length, 0);
  for (const config of [{ origin: 'https://example.invalid' }, { key: 'service_role' },
    { totalMs: 30001 }, { requestMs: 15001 }]) {
    const f = fixture(config);
    assert.equal((await f.check.run(credentials, true)).reason, 'preflight');
    assert.equal(f.calls.length, 0);
  }
});

test('one Auth, four anon/four authenticated denials and one snapshot; write/retry zero', async () => {
  const f = fixture();
  const result = await f.check.run(credentials, true);
  assert.equal(result.state, 'passed'); assert.equal(result.authCalls, 1);
  assert.equal(result.rpcCalls, Q04_READ_LIMITS.rpc); assert.equal(result.verifiedDenials, 8);
  assert.equal(result.writeRpcCalls, 0); assert.equal(result.retryCount, 0);
  assert.equal(result.singleRpc, 'unverified');
  assert.equal(f.calls.length, 10);
  const helpers = f.calls.slice(1, 9);
  assert.ok(helpers.slice(0, 4).every(c => !Object.hasOwn(c.init.headers, 'Authorization')));
  assert.ok(helpers.slice(4).every(c => Object.hasOwn(c.init.headers, 'Authorization')));
  assert.deepEqual(helpers.slice(0, 4).map(c => JSON.parse(c.init.body)),
    [{}, { s: ' Q04 ' }, { s: 'Q04', field: 'title' }, { s: 'Q04' }]);
  assert.equal(f.calls.filter(c => c.url.endsWith('memo_load_snapshot')).length, 1);
  const publicOutput = JSON.stringify([result, f.records]);
  for (const banned of [credentials.email, credentials.password, 'sb_publishable_synthetic', userId, origin]) {
    assert.ok(!publicOutput.includes(banned));
  }
  assert.equal((await f.check.run(credentials, true)).reason, 'already-used');
  assert.equal(f.calls.length, 10);
});

for (const [status, data, expected] of [
  [200, true, 'failed'], [401, { code: '42501', message: 'unauthenticated' }, 'unknown'],
  [404, { code: 'PGRST202', message: secret }, 'unknown'], [500, { message: secret }, 'unknown'],
]) test(`unexpected helper status ${status} stops without retry or snapshot`, async () => {
  const baseline = fixture(); let sent = 0;
  const f = fixture({ fetchImpl: async (url, init) => {
    sent++; return sent === 1 ? baseline.fake(url, init) : response(url, status, data);
  } });
  const result = await f.check.run(credentials, true);
  assert.equal(result.state, expected); assert.equal(sent, 2);
  assert.equal(result.rpcCalls, 1); assert.equal(result.writeRpcCalls, 0);
  assert.ok(!JSON.stringify([result, f.records]).includes(secret));
});

test('Auth failure prevents every RPC and does not publish error/credential values', async () => {
  let sent = 0;
  const f = fixture({ fetchImpl: async url => { sent++; return response(url, 400, { message: secret }); } });
  const result = await f.check.run(credentials, true);
  assert.equal(result.reason, 'auth-failed'); assert.equal(result.rpcCalls, 0); assert.equal(sent, 1);
  assert.ok(!JSON.stringify([result, f.records]).includes(secret));
});

for (const kind of ['network', 'body', 'redirect', 'url']) test(`${kind}: UNKNOWN with no subsequent calls`, async () => {
  let sent = 0;
  const f = fixture({ fetchImpl: async url => {
    sent++;
    if (kind === 'network') throw new TypeError(secret);
    const r = response(url, 200, {});
    if (kind === 'body') r.text = async () => secret;
    if (kind === 'redirect') r.redirected = true;
    if (kind === 'url') r.url = 'https://example.invalid/?' + secret;
    return r;
  } });
  const result = await f.check.run(credentials, true);
  assert.equal(result.state, 'unknown'); assert.equal(sent, 1);
  assert.equal(result.rpcCalls, 0); assert.ok(!JSON.stringify([result, f.records]).includes(secret));
});

for (const scope of ['request', 'total']) test(`${scope} deadline aborts hanging fetch and blocks a second run`, async () => {
  let sent = 0, signal;
  const f = fixture({ requestMs: scope === 'request' ? 10 : 1000, totalMs: scope === 'total' ? 10 : 1000,
    fetchImpl: async (_url, init) => { sent++; signal = init.signal; return new Promise(() => {}); } });
  const result = await f.check.run(credentials, true);
  assert.equal(result.state, 'unknown'); assert.equal(result.reason, 'timeout');
  assert.equal(signal.aborted, true); assert.equal(sent, 1);
  await f.check.run(credentials, true); assert.equal(sent, 1);
});

test('record failure before sending stops with zero network, and final record failure prevents PASS', async () => {
  const f = fixture({ record: async () => { throw new Error(secret); } });
  const result = await f.check.run(credentials, true);
  assert.equal(result.state, 'stopped'); assert.equal(result.reason, 'record-failed'); assert.equal(f.calls.length, 0);
  const g = fixture({ record: async value => { if (value.state === 'passed') throw new Error(secret); } });
  const final = await g.check.run(credentials, true);
  assert.equal(final.state, 'unknown'); assert.equal(final.reason, 'record-failed');
});

test('snapshot malformed or another owner stops; raw data never enters records/results', async () => {
  for (const data of [{ memos: null }, { memos: [{ id: 'synthetic-id', user_id: secret }], tags: [], memoTags: [] }]) {
    const baseline = fixture();
    const f = fixture({ fetchImpl: (url, init) => url.endsWith('memo_load_snapshot')
      ? response(url, 200, data) : baseline.fake(url, init) });
    const result = await f.check.run(credentials, true);
    assert.equal(result.state, 'unknown'); assert.equal(result.reason, 'snapshot-invalid');
    assert.ok(!JSON.stringify([result, f.records]).includes(secret));
  }
});

test('pre-send recording failure after Auth never calls a helper; STOP/UNKNOWN cannot resume', async () => {
  const f = fixture({ record: async value => { if (value.authCalls === 1) throw new Error(secret); } });
  const result = await f.check.run(credentials, true);
  assert.equal(result.reason, 'record-failed'); assert.equal(result.rpcCalls, 0);
  assert.equal(f.calls.length, 1);
  await f.check.run(credentials, true); assert.equal(f.calls.length, 1);
});

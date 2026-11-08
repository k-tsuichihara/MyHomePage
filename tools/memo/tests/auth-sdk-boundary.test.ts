import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoSdkAuth } from '../src/auth-sdk';

// 製品APIに試験入口を追加せず、実SDKに渡るfetchだけを試験内で捕捉する。
const captured = vi.hoisted(() => ({ fetch: undefined as typeof globalThis.fetch | undefined }));
vi.mock('@supabase/supabase-js', async importOriginal => {
  const sdk = await importOriginal<typeof import('@supabase/supabase-js')>();
  return { ...sdk, createClient: (...args: Parameters<typeof sdk.createClient>) => {
    captured.fetch = args[2]?.global?.fetch; return sdk.createClient(...args);
  } };
});

const origin = 'https://memo-boundary.invalid';
let client: ReturnType<typeof createMemoSdkAuth>;
let transport: ReturnType<typeof vi.fn<typeof fetch>>;
const safe = (input: Parameters<typeof fetch>[0], init?: RequestInit) => captured.fetch!(input, init);
const response = () => new Response(JSON.stringify({ marker: 'synthetic' }), { headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External fetch forbidden'); }));
  vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {});
  transport = vi.fn<typeof fetch>(async () => response());
  client = createMemoSdkAuth({ url: origin, publicKey: 'sb_publishable_synthetic_only' },
    { getItem: () => null, setItem: () => {}, removeItem: () => {} }, transport);
});
afterEach(async () => {
  await client.dispose(); expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('Auth通信許可の境界', () => {
  it.each([
    ['GET', '/auth/v1/user'], ['POST', '/auth/v1/token?grant_type=password'],
    ['POST', '/auth/v1/token?grant_type=refresh_token'], ['POST', '/auth/v1/logout?scope=local'],
  ])('SDKの許可リクエスト %s %s', async (method, path) => {
    expect((await safe(origin + path, { method })).status).toBe(200); expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![1]?.redirect).toBe('error');
  });
  it.each([
    'https://other.invalid/auth/v1/user', 'http://memo-boundary.invalid/auth/v1/user',
    `${origin}:444/auth/v1/user`, 'https://user:synthetic@memo-boundary.invalid/auth/v1/user',
    `${origin}/auth/v1/user#extra`, `${origin}/auth/v1/user/`, `${origin}/auth/v1/USER`,
    `${origin}/auth/v1/%75ser`, `${origin}//auth/v1/user`, `${origin}/auth/v1/user/extra`,
    `${origin}/rest/v1/rpc/memo_load_snapshot`, `${origin}/auth/v1/signup`,
    `${origin}/auth/v1/user?extra=1`, `${origin}/auth/v1/user?`, `${origin}/auth/v1/token`, `${origin}/auth/v1/logout`,
    `${origin}/auth/v1/token?grant_type=password&extra=1`,
    `${origin}/auth/v1/token?grant_type=password&grant_type=password`,
    `${origin}/auth/v1/token?grant_type=%70assword`, `${origin}/auth/v1/token?grant_type=client_credentials`,
    `${origin}/auth/v1/logout?scope=global`, `${origin}/auth/v1/logout?scope=others`,
    `${origin}/auth/v1/logout?scope=local&scope=local`, 'invalid-url',
  ])('対象外URLを通信前に拒否 %#', async url => {
    const method = url.includes('/token') || url.includes('/logout') ? 'POST' : 'GET';
    await expect(safe(url, { method })).rejects.toThrow('Memo Auth transport unavailable');
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(['DELETE', 'PUT', 'POST', 'HEAD'])('userへの未許可method %s', async method => {
    await expect(safe(`${origin}/auth/v1/user`, { method })).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
  });
  it('URLオブジェクトを受け付ける', async () => {
    await safe(new URL(`${origin}/auth/v1/user`)); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('Requestとinitのmethod上書きを、実際に送る形式へ正規化して判定する', async () => {
    await safe(new Request(`${origin}/auth/v1/user`, { method: 'POST' }), { method: 'GET' });
    const [input, init] = transport.mock.calls[0]!;
    expect(input).toBeInstanceOf(Request); expect((input as Request).method).toBe('GET'); expect(init?.method).toBeUndefined();
  });
  it('許可Requestでもinitで未許可methodへ変更すれば送信しない', async () => {
    await expect(safe(new Request(`${origin}/auth/v1/user`), { method: 'DELETE' })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('Requestのbodyとheadersを失わずに転送する', async () => {
    transport.mockImplementationOnce(async input => {
      expect(input).toBeInstanceOf(Request); const request = input as Request;
      expect(request.headers.get('Content-Type')).toBe('application/json');
      expect(await request.json()).toEqual({ email: 'synthetic@example.invalid', password: 'synthetic' });
      return response();
    });
    await safe(new Request(`${origin}/auth/v1/token?grant_type=password`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'synthetic@example.invalid', password: 'synthetic' }) }));
  });
  it('Request風の任意オブジェクトを許可しない', async () => {
    const input = { url: `${origin}/auth/v1/user`, toString: () => 'https://other.invalid/auth/v1/user' };
    await expect(safe(input as unknown as Request)).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
  });
  it('initのgetterを再評価してmethodをすり替えさせない', async () => {
    let reads = 0;
    await safe(`${origin}/auth/v1/user`, { get method() { return ++reads === 1 ? 'GET' : 'DELETE'; } });
    expect(reads).toBe(1); expect((transport.mock.calls[0]![0] as Request).method).toBe('GET');
  });
  it('GETとbodyの不正な組合せを通信前に拒否', async () => {
    await expect(safe(`${origin}/auth/v1/user`, { method: 'GET', body: 'synthetic' })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([`${origin}/auth/v1/../v1/user`, `${origin}:443/auth/v1/user`, ` ${origin}/auth/v1/user`])('SDKが発行しない非正規文字列を拒否 %#', async url => {
    await expect(safe(url)).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
  });
  it('入力プロパティ取得例外に含まれる値を外へ出さない', async () => {
    await expect(safe(`${origin}/auth/v1/user`, { get method(): string { throw new Error('synthetic-private'); } }))
      .rejects.toThrow('Memo Auth transport unavailable'); expect(transport).not.toHaveBeenCalled();
  });
  it('Request側の中断済みsignalも通信前に拒否する', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(safe(new Request(`${origin}/auth/v1/user`, { signal: abort.signal }))).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('リダイレクト・応答の境界', () => {
  it.each([301, 302, 303, 307, 308])('HTTP %sは追従せず拒否', async status => {
    transport.mockResolvedValueOnce(new Response(null, { status, headers: { Location: 'https://other.invalid' } }));
    await expect(safe(`${origin}/auth/v1/user`, { redirect: 'follow' })).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1); expect(transport.mock.calls[0]![1]?.redirect).toBe('error');
  });
  it('200でもredirected応答を拒否する', async () => {
    const r = response(); Object.defineProperty(r, 'redirected', { value: true }); transport.mockResolvedValueOnce(r);
    await expect(safe(`${origin}/auth/v1/user`)).rejects.toThrow();
  });
  it('応答URLが要求と異なる場合は拒否する', async () => {
    const r = response(); Object.defineProperty(r, 'url', { value: 'https://other.invalid/auth/v1/user' }); transport.mockResolvedValueOnce(r);
    await expect(safe(`${origin}/auth/v1/user`)).rejects.toThrow();
  });
  it('204はbodyなし、JSON応答は解析可能な形で返す', async () => {
    transport.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const r = await safe(`${origin}/auth/v1/logout?scope=local`, { method: 'POST' }); expect(await r.text()).toBe('');
    expect(await (await safe(`${origin}/auth/v1/user`)).json()).toEqual({ marker: 'synthetic' });
  });
  it('エラー応答はstatusを維持し本文を固定理由へ置換する', async () => {
    transport.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'synthetic-private', error_code: 'invalid_credentials' }), { status: 400 }));
    const r = await safe(`${origin}/auth/v1/token?grant_type=password`, { method: 'POST' });
    expect(r.status).toBe(400); expect(await r.json()).toEqual({ message: 'Memo Auth request failed', error_code: 'invalid_credentials' });
  });
  it('JSON解析失敗の本文断片を外へ出さない', async () => {
    transport.mockResolvedValueOnce(new Response('synthetic-private-invalid-json'));
    await expect(safe(`${origin}/auth/v1/user`)).rejects.toThrow('Memo Auth transport unavailable');
  });
});

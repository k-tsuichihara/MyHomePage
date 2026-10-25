import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

// Supabaseのdev-sandboxで確認したProject Refだけを設定する。
// 空のままでは認証情報の入力・通信ともに行わない。
const DEV_SANDBOX_PROJECT_REF = 'yohoppqflnhhvqypwhfv';

export async function loadConfig() {
  if (!/^[a-z]{20}$/.test(DEV_SANDBOX_PROJECT_REF)) {
    throw new Error('cli.mjsのDEV_SANDBOX_PROJECT_REFに、dev-sandboxのProject Refを設定してください。');
  }
  let source;
  try {
    source = await readFile(new URL('.env.local', import.meta.url), 'utf8');
  } catch {
    throw new Error('専用の.env.localを作成してください。');
  }
  const values = new Map();
  for (const raw of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z_]+)\s*=\s*(.*)$/.exec(line);
    if (!match || !['SUPABASE_PROJECT_URL', 'SUPABASE_PUBLISHABLE_KEY'].includes(match[1]) || values.has(match[1])) {
      throw new Error('.env.localの形式または設定名が不正です。');
    }
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values.set(match[1], value);
  }
  let url;
  try { url = new URL(values.get('SUPABASE_PROJECT_URL')); } catch {
    throw new Error('Project URLの形式が不正です。');
  }
  if (url.protocol !== 'https:' || url.hostname !== `${DEV_SANDBOX_PROJECT_REF}.supabase.co` || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('接続先が固定したdev-sandboxのProject URLと一致しません。通信を停止しました。');
  }
  const key = values.get('SUPABASE_PUBLISHABLE_KEY');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key ?? '')) {
    throw new Error('sb_publishable_形式のPublishable keyだけを使用できます。');
  }
  return { origin: url.origin, key };
}

export function readPassword() {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    let password = '';
    const cleanup = () => {
      input.off('data', onData);
      input.off('end', onEnd);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
    };
    const onEnd = () => { cleanup(); reject(new Error('入力が終了しました。')); };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003' || character === '\u0004') {
          password = ''; cleanup(); reject(new Error('入力を中止しました。')); return;
        }
        if (character === '\r' || character === '\n') {
          cleanup(); resolve(password); password = ''; return;
        }
        if (character === '\u007f' || character === '\b') {
          password = Array.from(password).slice(0, -1).join('');
        } else if (character >= ' ' && character !== '\u001b') password += character;
      }
    };
    process.stdout.write('パスワード（非表示）: ');
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.on('data', onData);
    input.once('end', onEnd);
    input.resume();
  });
}

export async function requestJson(url, options) {
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('request failed');
  return response.json();
}

async function main() {
  const { origin, key } = await loadConfig();
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('非表示入力のため、対話型ターミナルから実行してください。');
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let email;
  try { email = (await prompt.question('テストユーザーのメールアドレス: ')).trim(); }
  finally { prompt.close(); }
  if (!email) throw new Error('メールアドレスを入力してください。');
  let password = await readPassword();
  let token;
  try {
    const result = await requestJson(`${origin}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (typeof result?.access_token !== 'string' || !result.access_token) throw new Error('invalid auth response');
    token = result.access_token;
    console.log('認証: 成功');
  } catch {
    console.log('認証: 失敗');
    process.exitCode = 1;
    return;
  } finally { password = ''; email = ''; }
  try {
    const data = await requestJson(`${origin}/rest/v1/rpc/memo_load_snapshot`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!data || !Array.isArray(data.memos) || !Array.isArray(data.tags) || !Array.isArray(data.memoTags)) throw new Error('invalid snapshot');
    console.log('RPC: 成功');
    console.log(`memos: ${data.memos.length}`);
    console.log(`tags: ${data.tags.length}`);
    console.log(`memoTags: ${data.memoTags.length}`);
  } catch {
    console.log('RPC: 失敗');
    process.exitCode = 1;
  } finally { token = undefined; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  // 設定・対話入力のエラーのみ。通信例外やレスポンスは出力しない。
  console.error(error.message);
  process.exitCode = 1;
});

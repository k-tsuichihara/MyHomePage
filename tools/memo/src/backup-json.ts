/** 外部JSONの構文・重複キー・深度を値の構築前に走査する。入力断片を例外へ含めない。 */
export class BackupInputError extends Error {
  constructor(readonly code: string) { super(`Backup rejected: ${code}`); }
}
export const MAX_IMPORT_BYTES = 10_485_760;
export function parseBackupBytes(bytes: Uint8Array): unknown {
  const fail = (code = 'json'): never => { throw new BackupInputError(code); };
  if (bytes.byteLength > MAX_IMPORT_BYTES) fail('size');
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail('bom');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return fail('utf8'); }
  let i = 0;
  const ws = () => { while (/[\x20\t\r\n]/.test(text[i] ?? '\0')) i++; };
  function string(): string {
    const start = i++;
    while (i < text.length) {
      const char = text[i++]!;
      if (char === '"') {
        try { return JSON.parse(text.slice(start, i)) as string; } catch { return fail(); }
      }
      if (char.charCodeAt(0) < 0x20) fail();
      if (char === '\\') {
        const escape = text[i++];
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i, i + 4))) fail();
          i += 4;
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) fail();
      }
    }
    return fail();
  }
  function value(depth: number): void {
    ws(); const char = text[i];
    if (char === '{' || char === '[') {
      if (depth >= 32) fail('depth');
      const object = char === '{', end = object ? '}' : ']'; i++; ws();
      const keys = new Set<string>();
      if (text[i] === end) { i++; return; }
      while (true) {
        ws();
        if (object) {
          if (text[i] !== '"') fail();
          const key = string();
          if (keys.has(key)) fail('duplicate-key');
          if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('unsafe-key');
          keys.add(key); ws(); if (text[i++] !== ':') fail();
        }
        value(depth + 1); ws();
        if (text[i] === end) { i++; return; }
        if (text[i++] !== ',') fail();
      }
    }
    if (char === '"') { string(); return; }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(i));
    if (!token) fail();
    i += token![0].length;
  }
  value(0); ws(); if (i !== text.length) fail();
  try { return JSON.parse(text) as unknown; } catch { return fail(); }
}

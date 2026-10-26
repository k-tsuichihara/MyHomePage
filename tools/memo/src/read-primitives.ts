/** 利用者のデータを診断メッセージに混入させず、固定コードで拒否理由を伝える。 */
export class ReadValidationError extends Error {
  constructor(readonly code: 'structure' | 'json' | 'text' | 'uuid' | 'instant' | 'revision' | 'integrity') {
    super(`Invalid memo data: ${code}`);
    this.name = 'ReadValidationError';
  }
}
export function reject(code: ReadValidationError['code']): never { throw new ReadValidationError(code); }

/**
 * 検証中の例外を、入力のキー・値や元例外を含まないReadValidationErrorに統一する。
 * アクセサ・Proxy由来の例外も対象だが、それらの副作用を隔離するものではない。
 */
export function guarded<T>(operation: () => T): T {
  try { return operation(); }
  catch (error) {
    // 同じエラー型でも外部で生成された可能性があるため、messageやcauseを引き継がない。
    let code: ReadValidationError['code'] = 'structure';
    try {
      if (error instanceof ReadValidationError
        && ['structure', 'json', 'text', 'uuid', 'instant', 'revision', 'integrity'].includes(error.code)) {
        code = error.code;
      }
    } catch { /* 信頼できない例外プロパティの取得失敗も、元の内容を報告しない。 */ }
    return reject(code);
  }
}
/** JSON構文エラーには入力断片が含まれ得るため、元例外を捨てて全体を拒否する。 */
export function parseJson(raw: string): unknown {
  if (typeof raw !== 'string') return reject('json');
  try { return JSON.parse(raw) as unknown; }
  catch { return reject('json'); }
}

/**
 * 指定キーだけを持つプレーンなデータオブジェクトを要求し、浅いコピーを返す。
 * 欠落・未知項目・アクセサは黙って捨てずに拒否し、検証中にgetterを呼ばない。
 * 子オブジェクトはここでは共有されるため、呼出側で検証・再構築する必要がある。
 */
export function record(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) return reject('structure');
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(descriptors).length !== keys.length) return reject('structure');
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return reject('structure');
    result[key] = descriptor.value as unknown;
  }
  return result;
}
/** 疎配列・追加プロパティ・アクセサを拒否する。要素の検証と再構築は呼出側の責務。 */
export function array(raw: unknown): unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype) return reject('structure');
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(descriptors).length !== raw.length + 1) return reject('structure');
  const result: unknown[] = [];
  for (let i = 0; i < raw.length; i++) {
    const descriptor = descriptors[String(i)];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return reject('structure');
    result.push(descriptor.value as unknown);
  }
  return result;
}
export function string(raw: unknown): string {
  return typeof raw === 'string' ? raw : reject('structure');
}
/**
 * ハイフン付き8-4-4-4-12形式を検証し、原文字列を返す。
 * version・variantは限定せず、旧データの非UUID IDには使用しない。
 */
export function uuid(raw: unknown): string {
  const value = string(raw);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/i.test(value)
    ? value : reject('uuid');
}
/** 検証済みUUIDの比較専用。保存値や返却値の表記は変更しない。 */
export const uuidKey = (value: string): string => value.toLowerCase();
/**
 * 承認済みプロファイルの日時を検証し、タイムゾーンや精度を変換せず原文字列を返す。
 * 年0001〜9999、実在日、時00〜23、分秒00〜59、小数秒は任意の1〜6桁。
 * Zまたは±HH:mm（HHは00〜23、mmは00〜59）を必須とし、地域との対応は検証しない。
 * Date.parseによる補正に頼らず、閏秒・24:00・拡張年・不正暦日を拒否する。
 */
export function instant(raw: unknown): string {
  const value = string(raw);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))(?![\s\S])/.exec(value);
  if (!match) return reject('instant');
  const [, y, mo, d, h, mi, s, oh, om] = match;
  const year = Number(y), month = Number(mo), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]!
    || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59
    || (oh !== undefined && (Number(oh) > 23 || Number(om) > 59))) return reject('instant');
  return value;
}
/**
 * 正の安全整数だけを受理する。db=trueでは先頭ゼロなし十進文字列も許可する。
 * Numberへの変換は範囲検証だけに使用し、DBの文字列revisionはそのまま返す。
 */
export function revision(raw: unknown, db = false): number | string {
  if (db && typeof raw === 'string' && /^[1-9][0-9]*(?![\s\S])/.test(raw)
    && Number.isSafeInteger(Number(raw)) && Number(raw) >= 1) return raw;
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) return reject('revision');
  return raw;
}
export function nullable<T>(raw: unknown, validate: (raw: unknown) => T): T | null {
  return raw === null ? null : validate(raw);
}
/** 重複を除去して成功扱いにせず、呼出元のデータ全体を拒否するための検査。 */
export function unique(keys: string[]): Set<string> {
  const set = new Set(keys);
  if (set.size !== keys.length) return reject('integrity');
  return set;
}

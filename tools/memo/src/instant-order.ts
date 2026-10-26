import { instant } from './read-primitives';

/**
 * 受理済み日時を0001-01-01 UTC基準の整数マイクロ秒へ変換する比較専用関数。
 * Dateの年0〜99の補正やミリ秒への丸めを避ける。保存文字列は変更しない。
 */
export function instantOrderKey(input: unknown): bigint {
  const value = instant(input);
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  const preceding = year - 1;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const months = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const days = preceding * 365 + Math.floor(preceding / 4) - Math.floor(preceding / 100) + Math.floor(preceding / 400)
    + months.slice(0, month - 1).reduce((sum, count) => sum + count, 0) + day - 1;
  const suffix = /^(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value.slice(19))!;
  const offset = suffix[2] === 'Z' ? 0 : (Number(suffix[4]) * 60 + Number(suffix[5])) * 60 * (suffix[3] === '+' ? 1 : -1);
  // 秒の整数はこの年範囲で安全整数内。マイクロ秒への拡張だけをBigIntで行う。
  const seconds = days * 86400 + Number(value.slice(11, 13)) * 3600 + Number(value.slice(14, 16)) * 60 + Number(value.slice(17, 19)) - offset;
  return BigInt(seconds) * 1000000n + BigInt((suffix[1] ?? '').padEnd(6, '0'));
}

export function compareInstants(left: unknown, right: unknown): -1 | 0 | 1 {
  const a = instantOrderKey(left), b = instantOrderKey(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

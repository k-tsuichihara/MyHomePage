import { normalizeMemoInput, normalizeTagName } from './input';
import type { MemoItemV1 } from './read-types';
import { array, guarded, instant, parseJson, record, reject, string, unique } from './read-primitives';

/**
 * 保存済みタイトル・本文を補正せず検証する。
 * 新規入力の整形関数は適合性の確認にだけ使い、整形で値が変わる場合は拒否する。
 * 空タイトルを「無題」に置換したり、前後空白を削って移行したりしない。
 */
export function persistedMemo(title: unknown, body: unknown): { title: string; body: string } {
  const t = string(title), b = string(body);
  try {
    const normalized = normalizeMemoInput(t, b);
    if (!t || normalized.title !== t || normalized.body !== b) return reject('text');
  } catch { return reject('text'); }
  return { title: t, body: b };
}
/** タグ名も整形後の値と一致する場合だけ受理し、元の表示名を保持する。 */
export function persistedTag(raw: unknown): string {
  const name = string(raw);
  try { if (normalizeTagName(name) !== name) return reject('text'); }
  catch { return reject('text'); }
  return name;
}
/**
 * 旧形式の1件を検証し、入力とは独立したオブジェクトを返す。
 * 旧IDは非空文字列だけを要求する。UUID再発行・保存は後続の移行処理で行う。
 * 未知項目や不正値は修復せず、実値を含まないReadValidationErrorで拒否する。
 */
export function validateLegacyMemoUnchanged(input: unknown): MemoItemV1 {
  return guarded(() => {
    const row = record(input, ['id', 'title', 'text', 'createdAt', 'updatedAt']);
    const id = string(row.id);
    if (!id) return reject('structure');
    const { title, body } = persistedMemo(row.title, row.text);
    return { id, title, text: body, createdAt: instant(row.createdAt), updatedAt: instant(row.updatedAt) };
  });
}
/**
 * 全件の検証と旧IDの重複検査に成功した場合だけ、順序を保持した新しい配列を返す。
 * 不正な行を除外して移行するとデータ欠落に気づけないため、1件でも不正なら全体を拒否する。
 */
export function validateLegacyData(input: unknown): MemoItemV1[] {
  return guarded(() => {
    const result = array(input).map(validateLegacyMemoUnchanged);
    unique(result.map(row => row.id));
    return result;
  });
}
/** 渡されたJSON文字列だけを解析・全件検証する。実localStorageにはアクセスしない。 */
export function parseLegacyJson(raw: string): MemoItemV1[] { return validateLegacyData(parseJson(raw)); }

/** 合成値のみ。SQL側は未実行であり、期待SQLSTATEやDB原表記を捏造しない。 */
export const INPUT_VECTORS = [
  { id: 'title-limit', title: '題'.repeat(100), body: '', normalized: { title: '題'.repeat(100), body: '' } },
  { id: 'title-over', title: '題'.repeat(101), body: '', normalized: null },
  { id: 'body-limit', title: '境界', body: '😀'.repeat(10000), normalized: { title: '境界', body: '😀'.repeat(10000) } },
  { id: 'body-over', title: '境界', body: '😀'.repeat(10001), normalized: null },
  { id: 'trim-edges', title: '\u3000 題\u00a0', body: ' \t本文\n', normalized: { title: '題', body: ' \t本文\n' } },
  { id: 'untitled', title: ' ', body: '本文', normalized: { title: '無題', body: '本文' } },
  { id: 'empty', title: ' ', body: '\t', normalized: null },
  { id: 'cr', title: '題', body: '\r', normalized: null },
  { id: 'nul', title: '題', body: '\u0000', normalized: null },
  { id: 'surrogate', title: '題', body: '\ud800', normalized: null },
] as const;
export const TAG_VECTORS = [
  { name: 'Work', key: 'work' }, { name: 'Ä', key: 'Ä' }, { name: 'ä', key: 'ä' },
  { name: 'İ', key: 'İ' }, { name: 'e\u0301', key: 'e\u0301' },
] as const;
export const PRIMITIVE_VECTORS = {
  uuid: { accept: ['abcdef01-2345-0000-ffff-000000000001', 'ABCDEF01-2345-0000-FFFF-000000000001'], reject: ['bad', 'abcdef0123450000ffff000000000001'] },
  instant: { accept: ['2024-02-29T23:59:59.123456+09:00', '0001-01-01T00:00:00Z'], reject: ['2023-02-29T00:00:00Z', '2024-01-01T24:00:00Z', '2024-01-01T00:00:60Z'] },
  revision: { accept: [1, '9007199254740991'], reject: [0, '9007199254740992', '01'] },
} as const;
/** 後続SQL実行器へ渡す計画。新規入力の整形結果とDB生値拒否を別レーンにする。 */
export function sqlVectorPlan() {
  return INPUT_VECTORS.map(vector => ({ id: vector.id, sqlStatus: 'not-run' as const,
    normalizedLane: vector.normalized, rawLane: { title: vector.title, body: vector.body },
    rawExpected: vector.normalized !== null && vector.normalized.title === vector.title && vector.normalized.body === vector.body ? 'accept' : 'reject' }));
}

import { describe, expect, it } from 'vitest';
import { parseLegacyJson, validateLegacyData, validateLegacyMemoUnchanged } from '../src/legacy-validation';
import { parseLocalV2Json, validateLocalV2 } from '../src/local-validation';
import { instant, ReadValidationError, revision, uuid } from '../src/read-primitives';
import { validateCloudSnapshot, validateMemoData } from '../src/snapshot-validation';
import type { Memo } from '../src/types';

// Synthetic identifiers only. Expectations come from review8 + approved second-phase profile.
const ID = 'abcdef01-2345-0000-0000-000000000001';
const TAG = 'abcdef01-2345-ffff-ffff-000000000002';
const USER = 'abcdef01-2345-0000-0000-000000000003';
const OTHER = 'abcdef01-2345-0000-0000-000000000004';
const DATE = '2024-02-29T23:59:59.123456+23:59';
const legacy = () => ({ id: 'memo-old', title: '旧メモ', text: ' \t本文\n ', createdAt: DATE, updatedAt: DATE });
const memo = (): Memo => ({ id: ID, title: 'メモ', body: ' \t本文\n ', createdAt: DATE, updatedAt: DATE,
  pinnedAt: null, deletedAt: null, revision: 1, lastRequestId: null });
const tag = () => ({ id: TAG, name: 'Tag', createdAt: DATE, revision: 1 });
const data = () => ({ memos: [memo()], tags: [tag()], memoTags: [{ memoId: ID, tagId: TAG }] });
const local = () => ({ version: 2, migration: { status: 'not-required' }, ...data() });
const dbMemo = () => ({ id: ID, user_id: USER, title: 'メモ', body: ' \t本文\n ', created_at: DATE, updated_at: DATE,
  pinned_at: null, deleted_at: null, revision: '9007199254740991' as string | number, last_request_id: null });
const dbTag = () => ({ id: TAG, user_id: USER, name: 'Tag', created_at: DATE, revision: 1 as string | number });
const cloud = () => ({ memos: [dbMemo()], tags: [dbTag()], memoTags: [{ user_id: USER, memo_id: ID, tag_id: TAG }] });
function frozen<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
function rejected(operation: () => unknown): void { expect(operation).toThrow(ReadValidationError); }

describe('approved ISO profile: calendar + numeric fields, unchanged strings', () => {
  it.each(['0001-01-01T00:00:00Z', '9999-12-31T23:59:59Z', '2000-02-29T00:00:00Z',
    '2024-02-29T00:00:00.1Z', DATE, '2026-10-26T12:34:56.123-23:59',
    '2026-10-26T12:34:56+00:00', '2026-10-26T12:34:56-00:00'])('accepts %s', value => {
    expect(instant(value)).toBe(value);
  });
  it.each(['0000-01-01T00:00:00Z', '1900-02-29T00:00:00Z', '2023-02-29T00:00:00Z',
    '2024-04-31T00:00:00Z', '2024-00-01T00:00:00Z', '2024-13-01T00:00:00Z',
    '2024-01-00T00:00:00Z', '2024-01-32T00:00:00Z', '2024-01-01T24:00:00Z',
    '2024-01-01T00:60:00Z', '2024-01-01T23:59:60Z', '2024-01-01', '2024-01-01T00:00:00',
    '2024-01-01 00:00:00Z', '2024-01-01t00:00:00z', '+002024-01-01T00:00:00Z',
    '2024-01-01T00:00:00.Z', '2024-01-01T00:00:00.1234567Z', '2024-01-01T00:00:00+24:00',
    '2024-01-01T00:00:00+00:60', '2024-01-01T00:00:00+0900', '2024-01-01T00:00:00Z\n', null, 0])('rejects %s', value => rejected(() => instant(value)));
});
describe('UUID and safe revision contracts', () => {
  it.each([ID, ID.toUpperCase(), TAG, '00000000-0000-0000-0000-000000000000'])('preserves %s without version/variant limits', value => expect(uuid(value)).toBe(value));
  it.each([ID.replaceAll('-', ''), `{${ID}}`, ` ${ID}`, `${ID}\n`, 'memo-old', null, 123])('rejects %s', value => rejected(() => uuid(value)));
  it.each([1, 9007199254740991])('local revision accepts %s', value => expect(revision(value)).toBe(value));
  it.each([0, -1, 1.5, NaN, Infinity, 9007199254740992, '1', null])('local revision rejects %s', value => rejected(() => revision(value)));
  it.each(['1', '9007199254740991', 1, 9007199254740991])('DB preserves revision %s', value => expect(revision(value, true)).toBe(value));
  it.each(['0', '-1', '01', '+1', '1.0', '1e0', '1 ', '1\n', '9007199254740992', '', null])('DB rejects %s', value => rejected(() => revision(value, true)));
});
describe('legacy: unchanged values, full-array rejection', () => {
  it('preserves non UUID IDs, order and exact text/date', () => {
    const input = frozen([legacy(), { ...legacy(), id: 'MEMO-old', title: 'e\u0301' }]);
    expect(validateLegacyData(input)).toEqual(input);
    expect(parseLegacyJson(JSON.stringify(input))).toEqual(input);
  });
  it.each(['', ' title', 'title ', '\ttitle', 'x\ny', 'x\ty', 'x\u2028y', '\ud800', 'x'.repeat(101)])('rejects persisted title without repair', title => rejected(() => validateLegacyData([{ ...legacy(), title }])));
  it.each(['\u0000', '\r', '\u007f', '\udfff', 'x'.repeat(10001)])('rejects body controls/limits', text => rejected(() => validateLegacyData([{ ...legacy(), text }])));
  it.each([9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197,
    8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279])('does not trim persisted edge U+%s', cp => {
    const edge = String.fromCodePoint(cp);
    rejected(() => validateLegacyMemoUnchanged({ ...legacy(), title: `${edge}title` }));
    rejected(() => validateLegacyMemoUnchanged({ ...legacy(), title: `title${edge}` }));
    rejected(() => validateMemoData({ ...data(), tags: [{ ...tag(), name: `${edge}tag` }] }));
  });
  it('checks every C0/C1 codepoint in persisted titles and bodies', () => {
    const points = [...Array.from({ length: 32 }, (_, i) => i), ...Array.from({ length: 33 }, (_, i) => i + 127)];
    for (const cp of points) {
      const text = `x${String.fromCodePoint(cp)}y`;
      rejected(() => validateLegacyMemoUnchanged({ ...legacy(), title: text }));
      if (cp === 9 || cp === 10) expect(validateLegacyMemoUnchanged({ ...legacy(), text }).text).toBe(text);
      else rejected(() => validateLegacyMemoUnchanged({ ...legacy(), text }));
    }
  });
  it('accepts codepoint bounds, body blank/empty and combining representations', () => {
    expect(validateLegacyMemoUnchanged({ ...legacy(), title: '😀'.repeat(100), text: '😀'.repeat(10000) }).text).toHaveLength(20000);
    expect(validateLegacyMemoUnchanged({ ...legacy(), text: '' }).text).toBe('');
    expect(validateLegacyMemoUnchanged({ ...legacy(), text: ' \t\n ' }).text).toBe(' \t\n ');
  });
  it('rejects duplicate IDs and a later invalid row without changing input', () => {
    const input = frozen([legacy(), legacy()]);
    rejected(() => validateLegacyData(input));
    expect(input).toEqual([legacy(), legacy()]);
    rejected(() => validateLegacyData([legacy(), { ...legacy(), id: '' }]));
  });
  it.each([null, {}, [null], [{ ...legacy(), extra: 1 }], [{ ...legacy(), id: 1 }]])('rejects structure', value => rejected(() => validateLegacyData(value)));
  it.each(Object.keys(legacy()))('requires %s', key => {
    const row: Record<string, unknown> = { ...legacy() }; delete row[key];
    rejected(() => validateLegacyMemoUnchanged(row));
  });
  it.each(['{', 'null', '{}', '[1]'])('rejects malformed or wrong JSON shape', raw => rejected(() => parseLegacyJson(raw)));
});
describe('v2 states and legacySnapshot responsibility', () => {
  it('returns a distinct not-required branch and JSON entry', () => {
    const expected = { kind: 'validated-not-required', value: local() };
    expect(validateLocalV2(local())).toEqual(expected);
    expect(parseLocalV2Json(JSON.stringify(local()))).toEqual(expected);
  });
  it.each(['pending', 'complete'])('validates nested legacy JSON for %s, no migration comparison', status => {
    const raw = JSON.stringify([legacy()]);
    const result = validateLocalV2({ ...local(), migration: { status, legacySnapshot: raw } });
    expect(result.kind).toBe(`validated-${status}`);
    if (result.kind === 'validated-not-required') throw new Error('Unexpected fixture branch');
    expect(result.value.migration.legacySnapshot).toBe(raw);
    expect(result.legacyItems).toEqual([legacy()]);
    expect(result.value.memos[0]!.title).toBe('メモ'); // complete may have later edits
  });
  it.each([{ status: 'pending' }, { status: 'complete', legacySnapshot: '[' },
    { status: 'pending', legacySnapshot: JSON.stringify([{ ...legacy(), title: '' }]) },
    { status: 'complete', legacySnapshot: null }, { status: 'not-required', legacySnapshot: '[]' },
    { status: 'other' }, { status: 'not-required', extra: true }, null])('rejects migration metadata', migration => rejected(() => validateLocalV2({ ...local(), migration })));
  it('rejects wrong version, missing root fields and unknown root fields', () => {
    rejected(() => validateLocalV2({ ...local(), version: '2' }));
    rejected(() => validateLocalV2({ ...local(), extra: 1 }));
    for (const key of Object.keys(local())) {
      const row: Record<string, unknown> = { ...local() }; delete row[key];
      rejected(() => validateLocalV2(row));
    }
    rejected(() => parseLocalV2Json('{private-value'));
  });
});
describe('local and DB collection integrity / all fields', () => {
  it('accepts empty collections; null is never empty', () => {
    const empty = { memos: [], tags: [], memoTags: [] };
    expect(validateMemoData(empty)).toEqual(empty);
    expect(validateCloudSnapshot(empty, USER)).toEqual(empty);
    rejected(() => validateCloudSnapshot(null, USER));
  });
  it('accepts UUID case equivalence in owner and references, preserving spelling', () => {
    const input = cloud(); input.memos[0]!.id = ID.toUpperCase(); input.tags[0]!.user_id = USER.toUpperCase();
    expect(validateCloudSnapshot(input, USER.toUpperCase())).toEqual(input);
    const own = data(); own.memoTags[0]!.memoId = ID.toUpperCase();
    expect(validateMemoData(own)).toEqual(own);
  });
  it('does not invent chronology or pin/trash exclusion constraints', () => {
    const input = data(); input.memos[0] = { ...memo(), createdAt: '9999-01-01T00:00:00Z', pinnedAt: DATE, deletedAt: DATE, lastRequestId: OTHER };
    expect(validateMemoData(input)).toEqual(input);
  });
  it('memo and tag UUID namespaces are independent', () => {
    const input = data(); input.tags[0]!.id = ID; input.memoTags[0]!.tagId = ID;
    expect(validateMemoData(input)).toEqual(input);
  });
  for (const mode of ['local', 'db'] as const) {
    const fixture = () => mode === 'local' ? data() : cloud();
    const validate = (input: unknown) => mode === 'local' ? validateMemoData(input) : validateCloudSnapshot(input, USER);
    for (const collection of ['memos', 'tags', 'memoTags'] as const) {
      it(`${mode} ${collection}: every own field required, unknown and wrong types rejected`, () => {
        const row = fixture()[collection][0]!;
        for (const key of Object.keys(row)) {
          const input = fixture();
          const changed = { ...row } as Record<string, unknown>; delete changed[key];
          (input[collection] as unknown[])[0] = changed;
          rejected(() => validate(input));
          (input[collection] as unknown[])[0] = { ...row, [key]: false };
          rejected(() => validate(input));
        }
        const input = fixture(); (input[collection] as unknown[])[0] = { ...row, future_column: 1 };
        rejected(() => validate(input));
      });
      it(`${mode} ${collection}: rejects duplicates, including UUID case aliases`, () => {
        const input = fixture();
        const row = input[collection][0]!;
        (input[collection] as unknown[]).push(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' ? v.toUpperCase() : v])));
        rejected(() => validate(input));
      });
    }
    it(`${mode}: rejects dangling memo/tag relations`, () => {
      for (const key of mode === 'local' ? ['memoId', 'tagId'] : ['memo_id', 'tag_id']) {
        const input = fixture();
        (input.memoTags as unknown[])[0] = { ...input.memoTags[0], [key]: OTHER };
        rejected(() => validate(input));
      }
    });
    it(`${mode}: ASCII tag keys unique, non ASCII distinct`, () => {
      const input = fixture(); (input.tags as unknown[]).push({ ...input.tags[0]!, id: OTHER, name: 'tAG' });
      rejected(() => validate(input));
      input.tags[0]!.name = 'Ä'; input.tags[1]!.name = 'ä';
      expect(validate(input).tags).toHaveLength(2);
    });
    it(`${mode}: tags retain codepoint bounds and persisted whitespace rules`, () => {
      for (const name of ['', ' Tag', 'Tag ', 'x\ny', '\ud800', '😀'.repeat(31)]) {
        const input = fixture(); input.tags[0]!.name = name; rejected(() => validate(input));
      }
      const input = fixture(); input.tags[0]!.name = '😀'.repeat(30);
      expect(validate(input).tags[0]!.name).toBe('😀'.repeat(30));
    });
    it(`${mode}: accepts reordered object keys and frozen input`, () => {
      const input = fixture();
      input.memos[0] = Object.fromEntries(Object.entries(input.memos[0]!).reverse()) as typeof input.memos[0];
      expect(validate(frozen(input))).toEqual(input);
    });
  }
  it.each(['memos', 'tags', 'memoTags'] as const)('rejects foreign owner in %s', collection => {
    const input = cloud(); input[collection][0]!.user_id = OTHER;
    rejected(() => validateCloudSnapshot(input, USER));
  });
  it('preserves raw DB fields and revision representations', () => {
    const input = cloud(); input.tags[0]!.revision = '12';
    const result = validateCloudSnapshot(input, USER);
    expect(result).toEqual(input);
    expect(result.memos[0]).not.toHaveProperty('createdAt');
    expect(result.memos[0]!.revision).toBe('9007199254740991');
    expect(result.tags[0]!.revision).toBe('12');
  });
});
describe('detachment, non destruction and private errors', () => {
  it('copies every local collection, nested metadata and legacy row', () => {
    const input = { ...local(), migration: { status: 'pending', legacySnapshot: JSON.stringify([legacy()]) } };
    const result = validateLocalV2(input), expected = structuredClone(result);
    input.memos[0]!.title = 'changed'; input.tags[0]!.name = 'changed'; input.memoTags[0]!.memoId = OTHER;
    input.memos.push(memo()); input.tags.length = 0; input.memoTags.length = 0;
    input.migration.status = 'complete'; input.migration.legacySnapshot = '[]';
    expect(result).toEqual(expected);
  });
  it('copies DB collections and legacy array rows', () => {
    const input = cloud(), result = validateCloudSnapshot(input, USER), expected = structuredClone(result);
    input.memos[0]!.body = 'changed'; input.tags[0]!.name = 'changed'; input.memoTags[0]!.memo_id = OTHER;
    input.memos.length = 0; input.tags.length = 0; input.memoTags.length = 0;
    expect(result).toEqual(expected);
    const old = [legacy()], copy = validateLegacyData(old), oldExpected = structuredClone(copy);
    old[0]!.text = 'changed'; old.length = 0;
    expect(copy).toEqual(oldExpected);
  });
  it('direct memo-data and single-legacy entry points also detach their outputs', () => {
    const input = data(), copy = validateMemoData(input), expected = structuredClone(copy);
    input.memos[0]!.title = 'changed'; input.tags[0]!.name = 'changed'; input.memoTags[0]!.tagId = OTHER;
    expect(copy).toEqual(expected);
    const row = legacy(), oldCopy = validateLegacyMemoUnchanged(row), oldExpected = structuredClone(oldCopy);
    row.title = 'changed'; expect(oldCopy).toEqual(oldExpected);
  });
  it('rejects accessors without invoking them, inherited objects, sparse/augmented arrays and symbols', () => {
    let called = false;
    const row = { ...legacy(), get title() { called = true; return 'private'; } };
    rejected(() => validateLegacyMemoUnchanged(row)); expect(called).toBe(false);
    rejected(() => validateLegacyMemoUnchanged(Object.create(legacy())));
    rejected(() => validateLegacyData(new Array(1)));
    rejected(() => validateLegacyData(Object.assign([legacy()], { extra: true })));
    rejected(() => validateLegacyMemoUnchanged({ ...legacy(), [Symbol('private')]: 1 }));
  });
  it('failed validation does not mutate frozen input', () => {
    const input = frozen({ ...local(), memos: [{ ...memo(), title: ' bad' }] });
    const before = structuredClone(input);
    rejected(() => validateLocalV2(input)); expect(input).toEqual(before);
  });
  it('errors never include content, unknown keys or parser snippets', () => {
    const secret = 'SENSITIVE-SYNTHETIC-CONTENT';
    for (const operation of [
      () => parseLegacyJson(`{"${secret}`),
      () => validateLegacyData([{ ...legacy(), title: ` ${secret}`, text: secret }]),
      () => validateLocalV2({ ...local(), migration: { status: 'pending', legacySnapshot: secret } }),
      () => validateCloudSnapshot({ ...cloud(), [secret]: secret }, USER),
      () => validateMemoData({ ...data(), tags: [{ ...tag(), name: ` ${secret}` }] }),
    ]) {
      try { operation(); throw new Error('Expected rejection'); }
      catch (error) {
        expect(error).toBeInstanceOf(ReadValidationError);
        expect(String(error)).not.toContain(secret);
        expect(JSON.stringify(error)).not.toContain(secret);
        expect((error as Error).cause).toBeUndefined();
      }
    }
  });
  it('does not forward an externally thrown error message', () => {
    const injected = new ReadValidationError('structure'); injected.message = 'PRIVATE-SYNTHETIC';
    const input = new Proxy({}, { getPrototypeOf() { throw injected; } });
    try { validateLegacyMemoUnchanged(input); throw new Error('Expected rejection'); }
    catch (error) { expect(error).toBeInstanceOf(ReadValidationError); expect(String(error)).not.toContain('PRIVATE-SYNTHETIC'); }
  });
});

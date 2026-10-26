import { describe, expect, it } from 'vitest';
import { InputValidationError, normalizeMemoInput, normalizeTagName, tagKey } from '../src/input';

// Independently enumerated from review8 spec §2 and SQL memo_edge_spaces.
const edgePoints = [9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196,
  8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279];

describe('review8 §2: trim only the explicit title/tag edge set', () => {
  it.each(edgePoints)('U+%i is removed at title/tag edges, but retained in body', (cp) => {
    const c = String.fromCodePoint(cp);
    expect(normalizeMemoInput(`${c}A${c}`, 'body')).toEqual({ title: 'A', body: 'body' });
    expect(normalizeTagName(`${c}Tag${c}`)).toBe('Tag');
    if (cp === 11 || cp === 12 || cp === 13) {
      expect(() => normalizeMemoInput('title', `${c}body${c}`)).toThrow(InputValidationError);
    } else expect(normalizeMemoInput('title', `${c}body${c}`).body).toBe(`${c}body${c}`);
  });
  it.each([0x85, 0x180e, 0x200b])('U+%i is not silently trimmed', (cp) => {
    const value = String.fromCodePoint(cp);
    if (cp === 0x85) expect(() => normalizeTagName(`${value}A`)).toThrow(InputValidationError);
    else expect(normalizeTagName(`${value}A${value}`)).toBe(`${value}A${value}`);
  });
  it('retains internal spaces and never NFC-normalizes', () => {
    const text = ' e\u0301  日本語\u00a0x ';
    expect(normalizeMemoInput(text, text)).toEqual({ title: 'e\u0301  日本語\u00a0x', body: text });
    expect(normalizeTagName(' e\u0301 ')).toBe('e\u0301');
    expect(normalizeTagName('e\u0301')).not.toBe(normalizeTagName('é'));
  });
});

describe('review8 §2 / SQL char_length: code point boundaries after title/tag trim', () => {
  for (const character of ['a', '日', '😀', '\u0301']) {
    it(`title 100 accepted / 101 rejected: ${character}`, () => {
      expect(normalizeMemoInput(` ${character.repeat(100)} `, '').title).toBe(character.repeat(100));
      expect(() => normalizeMemoInput(character.repeat(101), '')).toThrow(InputValidationError);
    });
    it(`body 10000 accepted / 10001 rejected: ${character}`, () => {
      expect(normalizeMemoInput('t', character.repeat(10000)).body).toBe(character.repeat(10000));
      expect(() => normalizeMemoInput('t', character.repeat(10001))).toThrow(InputValidationError);
    });
    it(`tag 30 accepted / 31 rejected: ${character}`, () => {
      expect(normalizeTagName(` ${character.repeat(30)} `)).toBe(character.repeat(30));
      expect(() => normalizeTagName(character.repeat(31))).toThrow(InputValidationError);
    });
  }
  it('combining sequences count as two code points, not one grapheme', () => {
    expect(normalizeMemoInput('e\u0301'.repeat(50), '').title).toBe('e\u0301'.repeat(50));
    expect(() => normalizeMemoInput('e\u0301'.repeat(50) + 'x', '')).toThrow(InputValidationError);
  });
  it('body whitespace is retained and counts toward the limit', () => {
    expect(normalizeMemoInput('t', ' '.repeat(10000)).body).toHaveLength(10000);
    expect(() => normalizeMemoInput('t', ' '.repeat(10001))).toThrow(InputValidationError);
  });
});

describe('review8 §2 / SQL memo_valid_text: forbidden controls', () => {
  const controls = [...Array.from({ length: 32 }, (_, i) => i),
    ...Array.from({ length: 33 }, (_, i) => 127 + i), 0x2028, 0x2029];
  it.each(controls)('U+%i in the middle: title/tag reject; body permits only LF/TAB and U+2028/U+2029', (cp) => {
    const value = `a${String.fromCodePoint(cp)}b`;
    expect(() => normalizeMemoInput(value, '')).toThrow(InputValidationError);
    expect(() => normalizeTagName(value)).toThrow(InputValidationError);
    if ([9, 10, 0x2028, 0x2029].includes(cp)) expect(normalizeMemoInput('t', value).body).toBe(value);
    else expect(() => normalizeMemoInput('t', value)).toThrow(InputValidationError);
  });
  it('CRLF is rejected rather than converted, including at body edges', () => {
    for (const value of ['\r\ntext', 'text\r\n', 'a\r\nb']) {
      expect(() => normalizeMemoInput('t', value)).toThrow(InputValidationError);
    }
  });
});

describe('review8 §2 / §6: reject lone surrogates before storage/API', () => {
  it.each(['\ud800', '\udbff', '\udc00', '\udfff', '\ud800a', 'a\udc00', '\udc00\ud800'])('rejects malformed UTF-16 %#', (value) => {
    expect(() => normalizeMemoInput(value, 'body')).toThrow(InputValidationError);
    expect(() => normalizeMemoInput('t', value)).toThrow(InputValidationError);
    expect(() => normalizeTagName(value)).toThrow(InputValidationError);
  });
  it('preserves valid surrogate pairs and noncharacters not forbidden by the contract', () => {
    expect(normalizeMemoInput('😀', '😀\uffff')).toEqual({ title: '😀', body: '😀\uffff' });
  });
});

describe('review8 §2: title fallback belongs to new-input normalization, not SQL', () => {
  it.each(['', ' ', '\t\n\ufeff'])('empty title gets 無題 only when body has content %#', (title) => {
    expect(normalizeMemoInput(title, ' body\n')).toEqual({ title: '無題', body: ' body\n' });
    expect(() => normalizeMemoInput(title, ' \t\n\ufeff')).toThrow(InputValidationError);
  });
  it('an explicit title permits an empty or whitespace-only body', () => {
    expect(normalizeMemoInput('無題', '')).toEqual({ title: '無題', body: '' });
    expect(normalizeMemoInput(' t ', '\t \n')).toEqual({ title: 't', body: '\t \n' });
  });
  it.each(edgePoints)('tag containing only U+%i is rejected', (cp) => {
    expect(() => normalizeTagName(String.fromCodePoint(cp))).toThrow(InputValidationError);
  });
});

describe('review8 §2 / SQL memo_tag_key: translate only ASCII A-Z', () => {
  it.each([
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'],
    ['Mix-123_日本語', 'mix-123_日本語'], ['İ', 'İ'], ['Ä', 'Ä'], ['ä', 'ä'],
    ['é', 'é'], ['e\u0301', 'e\u0301'], ['😀Z', '😀z'], [' A ', ' a '],
  ])('%s → %s', (value, expected) => { expect(tagKey(value)).toBe(expected); });
  it('does not merge non-ASCII case or canonical variants', () => {
    expect(tagKey('İ')).not.toBe(tagKey('i'));
    expect(tagKey('Ä')).not.toBe(tagKey('ä'));
    expect(tagKey('é')).not.toBe(tagKey('e\u0301'));
  });
});

describe('runtime type boundary and safe errors', () => {
  it.each([null, undefined, 1, {}, [], true])('does not coerce non-string input %#', (value) => {
    const input = value as unknown as string;
    expect(() => normalizeMemoInput(input, 'body')).toThrow(InputValidationError);
    expect(() => normalizeMemoInput('t', input)).toThrow(InputValidationError);
    expect(() => normalizeTagName(input)).toThrow(InputValidationError);
    expect(() => tagKey(input)).toThrow(InputValidationError);
  });
  it('errors identify field/reason without including input contents', () => {
    try { normalizeMemoInput('title', 'private-body\u0000'); }
    catch (error) {
      expect(error).toBeInstanceOf(InputValidationError);
      expect(error).toMatchObject({ field: 'body', reason: 'control' });
      expect(String(error)).not.toContain('private-body');
      return;
    }
    throw new Error('Expected rejection');
  });
});

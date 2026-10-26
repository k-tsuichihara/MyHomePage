import type { ValidatedMemoInput } from './types';

type Field = 'title' | 'body' | 'tag';
type Reason = 'type' | 'surrogate' | 'control' | 'length' | 'empty';

/** No input contents are included in the error message. */
export class InputValidationError extends Error {
  constructor(readonly field: Field, readonly reason: Reason) {
    super(`Invalid ${field}: ${reason}`);
    this.name = 'InputValidationError';
  }
}

// review8 spec §2 / SQL memo_edge_spaces. Do not substitute trim() or \s.
const EDGES = /^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$/gu;
const withoutEdges = (value: string): string => value.replace(EDGES, '');

function requireString(value: string, field: Field): void {
  if (typeof value !== 'string') throw new InputValidationError(field, 'type');
}

function validateText(value: string, field: Field): void {
  let count = 0;
  for (const character of value) {
    const cp = character.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) throw new InputValidationError(field, 'surrogate');
    if ((cp <= 0x1f && !(field === 'body' && (cp === 9 || cp === 10)))
      || (cp >= 0x7f && cp <= 0x9f)
      || (field !== 'body' && (cp === 0x2028 || cp === 0x2029))) {
      throw new InputValidationError(field, 'control');
    }
    count++;
  }
  const limit = field === 'body' ? 10000 : field === 'title' ? 100 : 30;
  if (count > limit) throw new InputValidationError(field, 'length');
}

/** New input only; never use this to repair or migrate legacy data. */
export function normalizeMemoInput(title: string, body: string): ValidatedMemoInput {
  requireString(title, 'title');
  requireString(body, 'body');
  const normalizedTitle = withoutEdges(title);
  validateText(normalizedTitle, 'title');
  validateText(body, 'body');
  if (!normalizedTitle && !withoutEdges(body)) throw new InputValidationError('title', 'empty');
  return { title: normalizedTitle || '無題', body };
}

export function normalizeTagName(name: string): string {
  requireString(name, 'tag');
  const normalized = withoutEdges(name);
  validateText(normalized, 'tag');
  if (!normalized) throw new InputValidationError('tag', 'empty');
  return normalized;
}

/** SQL memo_tag_key equivalent: ASCII fold only, no trim/normalization/validation. */
export function tagKey(name: string): string {
  requireString(name, 'tag');
  return name.replace(/[A-Z]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 32));
}

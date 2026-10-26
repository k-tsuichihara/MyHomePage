import type * as Read from '../src/read-types';
import type * as Design from '../doc/v1.1.0/memo_v1_1_types_review8';
import { validateLocalV2 } from '../src/local-validation';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
export type ReadDesignCompatibility = [
  Expect<Equal<Read.MemoItemV1, Design.MemoItemV1>>,
  Expect<Equal<Read.MemoStorageV2, Design.MemoStorageV2>>,
  Expect<Equal<Read.DbMemoRow, Design.DbMemoRow>>,
  Expect<Equal<Read.DbTagRow, Design.DbTagRow>>,
  Expect<Equal<Read.DbMemoTagRow, Design.DbMemoTagRow>>,
  Expect<Equal<Read.CloudSnapshot, Design.CloudSnapshot>>,
];

// Compile-only proof: pending cannot be passed to the normal-use branch without narrowing.
type Usable = Exclude<Read.LocalV2ValidationResult, { kind: 'validated-pending' }>;
export function checkNarrowing(input: unknown, use: (result: Usable) => void): void {
  const result = validateLocalV2(input);
  // @ts-expect-error Structural success alone is insufficient for normal use.
  use(result);
  if (result.kind !== 'validated-pending') use(result);
}

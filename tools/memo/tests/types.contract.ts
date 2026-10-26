// Compile-time checks against the formal design. No runtime import or side effects.
import type * as Domain from '../src/types';
import type * as Design from '../doc/v1.1.0/memo_v1_1_types_review8';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
export type DesignCompatibility = [
  Expect<Equal<Domain.UUID, Design.UUID>>,
  Expect<Equal<Domain.ISOInstant, Design.ISOInstant>>,
  Expect<Equal<Domain.Memo, Design.Memo>>,
  Expect<Equal<Domain.Tag, Design.Tag>>,
  Expect<Equal<Domain.MemoTagRelation, Design.MemoTagRelation>>,
  Expect<Equal<Domain.MemoData, Design.MemoData>>,
  Expect<Equal<Domain.ValidatedMemoInput, Design.ValidatedMemoInput>>,
];

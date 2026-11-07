// Card 2.3, detail v2.2 (section 3): the command and verdict types. Core code: no DOM and no Node APIs.

export type VerdictCode =
  | 'range'
  | 'channels'
  | 'value-length'
  | 'too-large'
  | 'nested'
  | 'noop'
  | 'empty-history';

export type Verdict<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: VerdictCode };

export interface Command {
  readonly label: string;
  /** Stored tile data: the before and after images of the changed tiles (a null before-image costs nothing). */
  readonly bytes: number;
  apply(): void;
  revert(): void;
}

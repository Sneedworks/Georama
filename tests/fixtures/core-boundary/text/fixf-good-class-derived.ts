export class Base {
  readonly n: number;
  constructor(n: number) { this.n = n; }
}
export class Derived extends Base {
  constructor(n: number) { super(n); }
}
export const d = new Derived(3);

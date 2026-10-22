// Class constructors, names that merely contain a banned word, and a property called Function on another
// object are ordinary portable code and must not be flagged.
export class Holder {
  readonly count: number;
  constructor(count: number) { this.count = count; }
}
export const names = { constructorName: 1, myFunction: 2, Functional: 3, evaluate: 4, constructors: 5 };
const registry: Record<string, number> = {};
registry.Function = 6;
export const total = names.constructorName + names.myFunction + names.Functional + names.evaluate + names.constructors + (registry.Function ?? 0);
export const instance = new Holder(total);
export const kind = typeof instance === 'object' ? 'object' : 'function';

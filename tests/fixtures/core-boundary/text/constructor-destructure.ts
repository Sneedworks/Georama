const { constructor: Dynamic } = (() => 0) as unknown as { constructor: new (body: string) => () => number };
export const one = new Dynamic('return 1');

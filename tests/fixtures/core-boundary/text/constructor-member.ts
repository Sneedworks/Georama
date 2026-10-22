// The arrow function's constructor is the Function constructor.
const Dynamic = (() => 0).constructor as unknown as new (body: string) => () => number;
export const one = new Dynamic('return 1')();

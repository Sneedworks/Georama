const Dynamic = (true && Function) as unknown as new (body: string) => () => number;
export const one = new Dynamic('return 1')();

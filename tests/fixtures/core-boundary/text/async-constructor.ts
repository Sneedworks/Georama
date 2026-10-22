const Dynamic = (async () => 0).constructor as unknown as new (body: string) => () => Promise<number>;
export const one = new Dynamic('return 1');

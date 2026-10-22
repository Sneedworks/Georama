export const o = { constructor: 1, Function: 1 };
const holder: Record<string, number> = {};
holder.Function = 1;
holder.eval = 1;
export const total = o.Function + holder.Function + holder.eval;

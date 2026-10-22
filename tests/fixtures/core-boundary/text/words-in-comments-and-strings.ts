// We never use globalThis, eval('x'), new Function('y'), Function, AsyncFunction, fn.constructor or declare const process: unknown; in portable code.
/* declare global { var window: unknown } globalThis eval ( new Function Function GeneratorFunction .constructor ['constructor'] @tsconfig */
export const note = "globalThis eval(1) new Function('x') Function fn.constructor 'constructor' declare const process: unknown;";
export const template = `declare var window; ${1 + 1} globalThis eval(x) new Function Function .constructor`;
export const pattern = /globalThis|eval\(|new Function|Function|\.constructor|declare const/;
export const declare = 1;
export const namespace = 'only a name';

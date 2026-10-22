// import(name); import (`${name}`);
/*
/// <reference types="node" />
import(name);
*/
export const text = "import(name); /// <reference types='node' />";
export const pattern = /import\(name\)/;
export const template = `import(name); /// <reference types="node" />`;
export const object = { import: (value: string) => value };
object.import('ordinary method, not dynamic import');
void import('../../../../src/shared/brand.ts');
void import(`../../../../src/shared/brand.ts`);

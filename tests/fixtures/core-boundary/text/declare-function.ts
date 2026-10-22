declare function readFileSync(path: string): Uint8Array;
export const bytes = readFileSync('/etc/passwd');

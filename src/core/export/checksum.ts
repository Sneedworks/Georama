// FNV-1a 32-bit over bytes, for the transfer integrity check (card 1.10, Stage B2). Pure: no globals, no Node or DOM imports.

const OFFSET_BASIS = 0x811c9dc5;
const PRIME = 0x01000193;

export function fnv1a32(bytes: Uint8Array): number {
  let h = OFFSET_BASIS;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, PRIME) >>> 0;
  }
  return h >>> 0;
}

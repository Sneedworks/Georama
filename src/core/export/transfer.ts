import { ExportError } from './errors.ts';

// Card 1.10 Stage B1 (detail v2): chunk planner for the page transfer. Pure: no Node, DOM or GL imports.

// The largest multiple of 3 not above 4 MiB (4194304 % 3 === 1). A multiple of 3 keeps every interior
// slice free of base64 padding, so the slices concatenate into the base64 of the whole.
export const TRANSFER_MAX_CHUNK_BYTES = 4194303;

export interface ChunkRange {
  readonly start: number;
  readonly end: number; // exclusive
}

// Check order: totalBytes ('param'), then maxBytes ('param'). Every range is non-empty; the last one ends at totalBytes.
export function planChunks(totalBytes: number, maxBytes: number): ChunkRange[] {
  if (typeof totalBytes !== 'number' || !Number.isSafeInteger(totalBytes) || totalBytes < 1) {
    throw new ExportError('param', 'transfer: totalBytes must be a safe integer >= 1');
  }
  if (
    typeof maxBytes !== 'number' ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 3 ||
    maxBytes > TRANSFER_MAX_CHUNK_BYTES ||
    maxBytes % 3 !== 0
  ) {
    throw new ExportError('param', 'transfer: maxBytes must be a multiple of 3 in [3, TRANSFER_MAX_CHUNK_BYTES]');
  }
  const ranges: ChunkRange[] = [];
  for (let start = 0; start < totalBytes; start += maxBytes) {
    ranges.push({ start, end: Math.min(start + maxBytes, totalBytes) });
  }
  return ranges;
}

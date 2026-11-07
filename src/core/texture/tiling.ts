// Card 1.4 (mechanism): the integer tile rule, CPU reference.
// Output pixel (x, y) reads texel (((x + ox) mod (tw * k)) div k, ((y + oy) mod (th * k)) div k).
// Every value is an integer; the rule is exact in float32 below 2^24, which the GPU check relies on.
// This is a labelled test rule. It is not derived from Wonderdraft's internals.

export type TileErrorCode = 'param' | 'length' | 'limit';

export class TileError extends Error {
  readonly code: TileErrorCode;

  constructor(code: TileErrorCode, message: string) {
    super(message);
    this.name = 'TileError';
    this.code = code;
  }
}

export interface TileParams {
  readonly k: number;
  readonly ox: number;
  readonly oy: number;
}

export const TILE_LIMITS = Object.freeze({
  maxPixels: 1 << 26,
  minK: 1,
  maxK: 64,
  maxOffset: 65535,
  minSide: 1,
  maxSide: 4096,
  exactBelow: 1 << 24,
});

function isIntIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function tileRgba8(
  input: Uint8Array,
  tw: number,
  th: number,
  outW: number,
  outH: number,
  params: TileParams,
): Uint8Array {
  if (!isIntIn(tw, TILE_LIMITS.minSide, TILE_LIMITS.maxSide) || !isIntIn(th, TILE_LIMITS.minSide, TILE_LIMITS.maxSide)) {
    throw new TileError('param', 'texture sides must be integers in [1, 4096]');
  }
  if (!Number.isInteger(outW) || !Number.isInteger(outH) || outW < 1 || outH < 1) {
    throw new TileError('param', 'output sides must be positive integers');
  }
  if (outW * outH > TILE_LIMITS.maxPixels) {
    throw new TileError('limit', 'output exceeds the pixel limit');
  }
  const { k, ox, oy } = params;
  if (!isIntIn(k, TILE_LIMITS.minK, TILE_LIMITS.maxK)) {
    throw new TileError('param', 'k must be an integer in [1, 64]');
  }
  if (!isIntIn(ox, 0, TILE_LIMITS.maxOffset) || !isIntIn(oy, 0, TILE_LIMITS.maxOffset)) {
    throw new TileError('param', 'offsets must be integers in [0, 65535]');
  }
  // float32 exactness precondition (card 1.4): the largest index plus its offset must stay below 2^24.
  if (outW - 1 + ox >= TILE_LIMITS.exactBelow || outH - 1 + oy >= TILE_LIMITS.exactBelow) {
    throw new TileError('limit', 'index plus offset must stay below 2^24 (float32 exactness)');
  }
  if (input.length !== tw * th * 4) {
    throw new TileError('length', 'input length must equal tw * th * 4');
  }

  const periodX = tw * k;
  const periodY = th * k;
  const out = new Uint8Array(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    const m = (y + oy) % periodY;
    const sy = (m - (m % k)) / k;
    for (let x = 0; x < outW; x++) {
      const n = (x + ox) % periodX;
      const sx = (n - (n % k)) / k;
      const src = (sy * tw + sx) * 4;
      const dst = (y * outW + x) * 4;
      out[dst] = input[src];
      out[dst + 1] = input[src + 1];
      out[dst + 2] = input[src + 2];
      out[dst + 3] = input[src + 3];
    }
  }
  return out;
}

import { classifySymbolTexture, type SymbolTexture } from './texture-class.ts';

export type AtlasPixelErrorCode = 'INPUT' | 'LIMIT';

export class AtlasPixelError extends Error {
  readonly code: AtlasPixelErrorCode;

  constructor(code: AtlasPixelErrorCode, message: string) {
    super(message);
    this.name = 'AtlasPixelError';
    this.code = code;
  }
}

export interface AtlasImage {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export interface AtlasPixelPlacement {
  readonly key: string;
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AtlasPixelLookup {
  readonly pageSize: number;
  readonly pages?: number;
  readonly reserved: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly placements: readonly AtlasPixelPlacement[];
}

function fail(code: AtlasPixelErrorCode, message: string): never {
  throw new AtlasPixelError(code, message);
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

/** C1: one RGBA8 atlas page. Placed items land at their placement; the
 * reserved block is opaque white; every other texel is transparent.
 * Output is byte-identical for any input order (placements painted in
 * key order). C10: anything off page 0 stops with LIMIT. */
export function buildAtlasPixels(images: readonly AtlasImage[], atlas: AtlasPixelLookup): Uint8Array {
  if (!Array.isArray(images)) fail('INPUT', 'P1: images must be an array');
  if (atlas === null || typeof atlas !== 'object') fail('INPUT', 'P1: invalid atlas');
  const pageSize = (atlas as AtlasPixelLookup).pageSize;
  if (!isInt(pageSize) || pageSize < 1 || pageSize > 16384) fail('INPUT', 'P1: invalid pageSize');
  const side = pageSize as number;
  const res = (atlas as AtlasPixelLookup).reserved;
  if (res === null || typeof res !== 'object' || !isInt(res.x) || !isInt(res.y) || !isInt(res.width) || !isInt(res.height)) {
    fail('INPUT', 'P1: invalid reserved block');
  }
  if (res.x < 0 || res.y < 0 || res.width < 1 || res.height < 1 || res.x + res.width > side || res.y + res.height > side) {
    fail('INPUT', 'P1: reserved block outside the page');
  }
  const placements = (atlas as AtlasPixelLookup).placements;
  if (!Array.isArray(placements)) fail('INPUT', 'P1: invalid placements');
  const pages = (atlas as AtlasPixelLookup).pages;
  if (pages !== undefined && (!isInt(pages) || pages < 1)) fail('INPUT', 'P1: invalid pages');
  if (pages !== undefined && (pages as number) > 1) fail('LIMIT', 'P2: atlas needs more than one page');
  for (const p of placements) {
    if (p === null || typeof p !== 'object' || typeof p.key !== 'string') fail('INPUT', 'P1: invalid placement');
    if (!isInt(p.x) || !isInt(p.y) || !isInt(p.width) || !isInt(p.height)) fail('INPUT', `P1: invalid placement for ${p.key}`);
    if (p.page !== 0) fail('LIMIT', 'P2: atlas needs more than one page');
    if (p.width < 1 || p.height < 1 || p.x < 0 || p.y < 0 || p.x + p.width > side || p.y + p.height > side) {
      fail('INPUT', `P1: placement outside the page for ${p.key}`);
    }
    if (p.x < res.x + res.width && res.x < p.x + p.width && p.y < res.y + res.height && res.y < p.y + p.height) {
      fail('INPUT', `P1: placement overlaps the reserved block for ${p.key}`);
    }
  }
  const byKey = new Map<string, AtlasPixelPlacement>();
  for (const p of placements) {
    if (byKey.has(p.key)) fail('INPUT', `P1: duplicate placement for ${p.key}`);
    byKey.set(p.key, p);
  }
  const seen = new Set<string>();
  for (const image of images) {
    if (image === null || typeof image !== 'object') fail('INPUT', 'P1: invalid image');
    const key = (image as AtlasImage).key;
    if (typeof key !== 'string' || key.length === 0) fail('INPUT', 'P1: invalid image key');
    if (seen.has(key)) fail('INPUT', `P1: duplicate image for ${key}`);
    seen.add(key);
    const w = (image as AtlasImage).width;
    const h = (image as AtlasImage).height;
    if (!isInt(w) || w < 1 || !isInt(h) || h < 1) fail('INPUT', `P1: invalid image size for ${key}`);
    const rgba = (image as AtlasImage).rgba;
    if (!(rgba instanceof Uint8Array) || rgba.length !== (w as number) * (h as number) * 4) {
      fail('INPUT', `P1: invalid image bytes for ${key}`);
    }
    const placement = byKey.get(key);
    if (placement === undefined) fail('INPUT', `P1: no placement for ${key}`);
    if ((w as number) !== placement.width || (h as number) !== placement.height) {
      fail('INPUT', `P1: decoded size differs from the placement for ${key}`);
    }
  }

  const page = new Uint8Array(side * side * 4);
  for (let y = res.y; y < res.y + res.height; y++) {
    for (let x = res.x; x < res.x + res.width; x++) {
      const i = (y * side + x) * 4;
      page[i] = 255;
      page[i + 1] = 255;
      page[i + 2] = 255;
      page[i + 3] = 255;
    }
  }
  const ordered = [...images].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const image of ordered) {
    const p = byKey.get(image.key) as AtlasPixelPlacement;
    const w = image.width;
    const h = image.height;
    for (let row = 0; row < h; row++) {
      const src = row * w * 4;
      const dst = ((p.y + row) * side + p.x) * 4;
      page.set(image.rgba.subarray(src, src + w * 4), dst);
    }
  }
  return page;
}

/** C8: a pack image the 0.11p decoder rejects makes an asset symbol's
 * texture class invalid (placeholder). The decoder's own error code is
 * reported to scratch by the caller; the class only records invalid. */
export function textureClassAfterDecode(texture: unknown, decodeFailed: boolean): SymbolTexture {
  const t = classifySymbolTexture(texture);
  if (decodeFailed && t.class === 'asset') return { class: 'invalid', code: 'TYPE' };
  return t;
}

function isConvexInside(
  x1: number, y1: number, x2: number, y2: number, x3: number, y3: number,
  x4: number, y4: number, qx: number, qy: number,
): boolean {
  const c1 = (x2 - x1) * (qy - y1) - (y2 - y1) * (qx - x1);
  const c2 = (x3 - x2) * (qy - y2) - (y3 - y2) * (qx - x2);
  const c3 = (x4 - x3) * (qy - y3) - (y4 - y3) * (qx - x3);
  const c4 = (x1 - x4) * (qy - y4) - (y1 - y4) * (qx - x4);
  return (c1 >= 0 && c2 >= 0 && c3 >= 0 && c4 >= 0) || (c1 <= 0 && c2 <= 0 && c3 <= 0 && c4 <= 0);
}

/** C2 as amended by owner decision 2026-10-22 (option 1b, record
 * docs/plans/2026-10-22-0.11b-correction2-decision.md): the sampled texel is
 * floor(local + SAMPLE_BIAS) on each axis. The GPU fragment shader uses the same
 * constant. */
const SAMPLE_BIAS = 0.001;

/** C2-C5: CPU reference of the instanced draw. records holds 16 doubles
 * per instance in draw order (Stage A layout: A00 A01 A10 A11 tx ty u0
 * v0 w h page r g b a _). Output is window data order: row j is window
 * row j. Double precision; the caller rounds only at readback time —
 * this function rounds to RGBA8 itself (round half up of value*255). */
export function cpuReference(
  page: Uint8Array,
  pageSize: number,
  records: Float32Array,
  width: number,
  height: number,
): Uint8Array {
  if (!(page instanceof Uint8Array)) fail('INPUT', 'P3: page must be RGBA8 bytes');
  if (!isInt(pageSize) || pageSize < 1 || pageSize > 16384) fail('INPUT', 'P3: invalid pageSize');
  if (page.length !== (pageSize as number) * (pageSize as number) * 4) fail('INPUT', 'P3: page has the wrong size');
  if (!(records instanceof Float32Array) || records.length % 16 !== 0) fail('INPUT', 'P3: records must hold 16 floats per instance');
  if (!isInt(width) || width < 1 || !isInt(height) || height < 1) fail('INPUT', 'P3: invalid target size');
  const side = pageSize as number;
  const acc = new Float64Array((width as number) * (height as number) * 4);
  const count = records.length / 16;
  for (let k = 0; k < count; k++) {
    const b = k * 16;
    const a00 = records[b];
    const a01 = records[b + 1];
    const a10 = records[b + 2];
    const a11 = records[b + 3];
    const tx = records[b + 4];
    const ty = records[b + 5];
    const u0 = records[b + 6];
    const v0 = records[b + 7];
    const w = records[b + 8];
    const h = records[b + 9];
    const cr = records[b + 11];
    const cg = records[b + 12];
    const cb = records[b + 13];
    const ca = records[b + 14];
    const det = a00 * a11 - a01 * a10;
    if (det === 0) continue;
    const hx = w / 2;
    const hy = h / 2;
    const x1 = a00 * -hx + a01 * -hy + tx;
    const y1 = a10 * -hx + a11 * -hy + ty;
    const x2 = a00 * hx + a01 * -hy + tx;
    const y2 = a10 * hx + a11 * -hy + ty;
    const x3 = a00 * hx + a01 * hy + tx;
    const y3 = a10 * hx + a11 * hy + ty;
    const x4 = a00 * -hx + a01 * hy + tx;
    const y4 = a10 * -hx + a11 * hy + ty;
    for (let j = 0; j < (height as number); j++) {
      const qy = j + 0.5;
      for (let i = 0; i < (width as number); i++) {
        const qx = i + 0.5;
        if (!isConvexInside(x1, y1, x2, y2, x3, y3, x4, y4, qx, qy)) continue;
        const dx = qx - tx;
        const dy = qy - ty;
        const px = (a11 * dx - a01 * dy) / det;
        const py = (-a10 * dx + a00 * dy) / det;
        if (px < -hx || px > hx || py < -hy || py > hy) continue;
        const ix = Math.floor(u0 + px + hx + SAMPLE_BIAS);
        const iy = Math.floor(v0 + py + hy + SAMPLE_BIAS);
        if (ix < u0 || ix >= u0 + w || iy < v0 || iy >= v0 + h) continue;
        const t = ((iy * side + ix) * 4);
        const sa = (page[t + 3] / 255) * ca;
        const sr = (page[t] / 255) * cr * sa;
        const sg = (page[t + 1] / 255) * cg * sa;
        const sb = (page[t + 2] / 255) * cb * sa;
        const o = (j * (width as number) + i) * 4;
        acc[o] = sr + acc[o] * (1 - sa);
        acc[o + 1] = sg + acc[o + 1] * (1 - sa);
        acc[o + 2] = sb + acc[o + 2] * (1 - sa);
        acc[o + 3] = sa + acc[o + 3] * (1 - sa);
      }
    }
  }
  const out = new Uint8Array((width as number) * (height as number) * 4);
  for (let n = 0; n < out.length; n++) {
    const v = Math.floor(acc[n] * 255 + 0.5);
    out[n] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

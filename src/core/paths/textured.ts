/**
 * Card 1.6: textured paths, CPU reference. Pure portable core code (no DOM, no Node).
 * A path is a polyline in grid pixels. Coverage and ownership are exact integer tests on doubled
 * coordinates. The index values are floats, computed once here on the CPU; the GPU only reads them.
 * Detail: docs/plans/2026-10-25-phase1-parity.md, section "Card 1.6: textured paths".
 */

export const PATH_GRID = { width: 64, height: 48 } as const;

export type PathErrorCode = 'param' | 'length' | 'limit';

export class PathError extends Error {
  readonly code: PathErrorCode;

  constructor(code: PathErrorCode, message: string) {
    super(message);
    this.name = 'PathError';
    this.code = code;
  }
}

/** A style texture, RGBA8, row 0 first. bytes.length must be width x height x 4. */
export interface PathStyle {
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

/** Two values per texel, R then G, row 0 first. R = uIdx and G = vIdx; uncovered texels hold R = G = 65535. */
export interface PathIndexTable {
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly styleWidth: number;
  readonly styleHeight: number;
  readonly index: Uint16Array;
}

const SENTINEL = 65535;
const MAX_VERTICES = 64;
const MAX_STYLE_SIDE = 4096;

function isIntIn(value: number, lo: number, hi: number): boolean {
  return Number.isInteger(value) && value >= lo && value <= hi;
}

/**
 * Builds the index table of one path (G1 to G5). Checks run in the order of G1: parameters,
 * then points (even length, finite, inside the grid before rounding), rounding, dropping
 * consecutive duplicates, then the vertex-count limits.
 */
export function pathIndexTable(
  points: Float32Array,
  width: number,
  period: number,
  style: PathStyle,
): PathIndexTable {
  // (a) parameters
  if (!isIntIn(width, 1, 16)) throw new PathError('param', 'width must be an integer from 1 to 16');
  if (!isIntIn(period, 1, 256)) throw new PathError('param', 'period must be an integer from 1 to 256');
  if (!isIntIn(style.width, 1, MAX_STYLE_SIDE) || !isIntIn(style.height, 1, MAX_STYLE_SIDE)) {
    throw new PathError('param', 'style width and height must be integers from 1 to 4096');
  }
  if (style.bytes.length !== style.width * style.height * 4) {
    throw new PathError('length', 'style byte length must be width x height x 4');
  }

  // (b) points: x, y pairs; finite; inside the test grid before rounding
  if (points.length % 2 !== 0) throw new PathError('length', 'points must hold x, y pairs (even length)');
  const raw = points.length / 2;
  for (let i = 0; i < points.length; i++) {
    if (!Number.isFinite(points[i])) throw new PathError('param', 'coordinates must be finite');
  }
  for (let i = 0; i < raw; i++) {
    const x = points[2 * i];
    const y = points[2 * i + 1];
    if (x < 0 || x > PATH_GRID.width || y < 0 || y > PATH_GRID.height) {
      throw new PathError('limit', 'coordinate outside the 64 x 48 test grid');
    }
  }

  // (c) round to the nearest integer; (d) drop a vertex equal to the one before it
  const qx: number[] = [];
  const qy: number[] = [];
  for (let i = 0; i < raw; i++) {
    const x = Math.round(points[2 * i]);
    const y = Math.round(points[2 * i + 1]);
    const last = qx.length - 1;
    if (last >= 0 && qx[last] === x && qy[last] === y) continue;
    qx.push(x);
    qy.push(y);
  }

  // (e) and (f)
  const m = qx.length;
  if (m > MAX_VERTICES) throw new PathError('limit', 'more than 64 vertices');
  if (m < 2) throw new PathError('param', 'fewer than two vertices remain');

  // Segments in doubled units. Consecutive vertices differ, so every segment has length > 0.
  const segs = m - 1;
  const ax: number[] = [];
  const ay: number[] = [];
  const dx: number[] = [];
  const dy: number[] = [];
  const len2: number[] = [];
  const len: number[] = [];
  const start: number[] = [];
  let acc = 0;
  for (let i = 0; i < segs; i++) {
    const x0 = 2 * qx[i];
    const y0 = 2 * qy[i];
    const ddx = 2 * qx[i + 1] - x0;
    const ddy = 2 * qy[i + 1] - y0;
    const l2 = ddx * ddx + ddy * ddy;
    const l = Math.sqrt(l2);
    ax.push(x0);
    ay.push(y0);
    dx.push(ddx);
    dy.push(ddy);
    len2.push(l2);
    len.push(l);
    start.push(acc);
    acc += l;
  }

  // (G2 to G5) per pixel. Pixel (x, y) has centre (2x + 1, 2y + 1) in doubled units.
  const gw = PATH_GRID.width;
  const gh = PATH_GRID.height;
  const h = width; // half-width in doubled units
  const h2 = h * h;
  const index = new Uint16Array(2 * gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const px = 2 * x + 1;
      const py = 2 * y + 1;
      // G3 and G4: the owner has the least squared distance, as an exact fraction num / den.
      // Ties keep the lower segment index, because only a strictly smaller fraction replaces it.
      let bestNum = 0;
      let bestDen = 1;
      let owner = -1;
      for (let i = 0; i < segs; i++) {
        const rx = px - ax[i];
        const ry = py - ay[i];
        const dot = rx * dx[i] + ry * dy[i];
        let num: number;
        let den: number;
        if (dot > 0 && dot < len2[i]) {
          const cross = dx[i] * ry - dy[i] * rx;
          num = cross * cross;
          den = len2[i];
        } else if (dot <= 0) {
          num = rx * rx + ry * ry;
          den = 1;
        } else {
          const ex = px - (ax[i] + dx[i]);
          const ey = py - (ay[i] + dy[i]);
          num = ex * ex + ey * ey;
          den = 1;
        }
        if (owner < 0 || num * bestDen < bestNum * den) {
          bestNum = num;
          bestDen = den;
          owner = i;
        }
      }
      const k = 2 * (y * gw + x);
      if (bestNum > h2 * bestDen) {
        index[k] = SENTINEL;
        index[k + 1] = SENTINEL;
        continue;
      }
      // G5: index values from the owning segment, computed once on the CPU.
      const rx = px - ax[owner];
      const ry = py - ay[owner];
      const dot = rx * dx[owner] + ry * dy[owner];
      const cross = dx[owner] * ry - dy[owner] * rx;
      let t = dot / len2[owner];
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      const s = start[owner] + t * len[owner];
      const o = cross / len[owner];
      const u = Math.floor((s * style.width) / period) % style.width;
      let v = Math.floor(((o + h) / (2 * h)) * style.height);
      if (v > style.height - 1) v = style.height - 1;
      if (v < 0) v = 0;
      index[k] = u;
      index[k + 1] = v;
    }
  }
  return {
    gridWidth: gw,
    gridHeight: gh,
    styleWidth: style.width,
    styleHeight: style.height,
    index,
  };
}

/**
 * The layer the GPU pass must reproduce (G7): RGBA8, 64 x 48 x 4 bytes, row 0 first.
 * Covered texels take floor((t x c + 127) / 255) per channel; uncovered texels are (0, 0, 0, 0).
 */
export function pathLayerReference(
  table: PathIndexTable,
  style: PathStyle,
  colour: readonly [number, number, number, number],
): Uint8Array {
  for (const c of colour) {
    if (!isIntIn(c, 0, 255)) throw new PathError('param', 'colour channels must be integers from 0 to 255');
  }
  if (
    style.width !== table.styleWidth ||
    style.height !== table.styleHeight ||
    style.bytes.length !== style.width * style.height * 4
  ) {
    throw new PathError('length', 'style does not match the table');
  }
  const count = table.gridWidth * table.gridHeight;
  const out = new Uint8Array(count * 4);
  for (let p = 0; p < count; p++) {
    const u = table.index[2 * p];
    if (u === SENTINEL) continue;
    const v = table.index[2 * p + 1];
    const src = 4 * (v * style.width + u);
    for (let c = 0; c < 4; c++) {
      out[4 * p + c] = Math.floor((style.bytes[src + c] * colour[c] + 127) / 255);
    }
  }
  return out;
}

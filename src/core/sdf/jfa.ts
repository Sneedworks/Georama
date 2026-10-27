export const JFA_MAX_SIDE = 16384;
export const JFA_SENTINEL = 65535;

export type JfaCode = 'INPUT' | 'LIMIT';

export interface ClassGrid {
  readonly width: number;
  readonly height: number;
  readonly land: Uint8Array;
}

export type GridCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: JfaCode; readonly message: string };

export function validateClassGrid(grid: ClassGrid): GridCheck {
  if (typeof grid !== 'object' || grid === null) {
    return { ok: false, code: 'INPUT', message: 'grid must be an object' };
  }
  const width = grid.width;
  const height = grid.height;
  const land = grid.land;
  if (typeof width !== 'number' || !Number.isSafeInteger(width) || width < 1) {
    return { ok: false, code: 'INPUT', message: `invalid width ${String(width)}` };
  }
  if (typeof height !== 'number' || !Number.isSafeInteger(height) || height < 1) {
    return { ok: false, code: 'INPUT', message: `invalid height ${String(height)}` };
  }
  if (!(land instanceof Uint8Array)) {
    return { ok: false, code: 'INPUT', message: 'land must be a Uint8Array' };
  }
  if (land.length !== width * height) {
    return { ok: false, code: 'INPUT', message: `land length ${land.length} does not match ${width}x${height}` };
  }
  for (let i = 0; i < land.length; i++) {
    const v = land[i];
    if (v !== 0 && v !== 1) {
      return { ok: false, code: 'INPUT', message: `land[${i}] is ${String(v)}, want 0 or 1` };
    }
  }
  if (width > JFA_MAX_SIDE) {
    return { ok: false, code: 'LIMIT', message: `width ${width} exceeds ${JFA_MAX_SIDE}` };
  }
  if (height > JFA_MAX_SIDE) {
    return { ok: false, code: 'LIMIT', message: `height ${height} exceeds ${JFA_MAX_SIDE}` };
  }
  return { ok: true };
}

export type JfaVerdict =
  | { readonly ok: true; readonly seeds: Uint16Array; readonly outline: Uint8Array }
  | { readonly ok: false; readonly code: JfaCode; readonly message: string };

export function jumpFloodReference(grid: ClassGrid): JfaVerdict {
  const check = validateClassGrid(grid);
  if (!check.ok) return check;
  const width = grid.width;
  const height = grid.height;
  const land = grid.land;
  // A uniform grid has no coast seeds. The scan exits at the first differing
  // texel on ordinary mixed maps, leaving the propagation hot path unchanged.
  const first = land[0];
  let uniform = land[land.length - 1] === first;
  if (uniform) {
    for (let i = 1; i < land.length - 1; i++) {
      if (land[i] !== first) {
        uniform = false;
        break;
      }
    }
  }
  if (uniform) {
    const seeds = new Uint16Array(2 * width * height);
    seeds.fill(JFA_SENTINEL);
    return { ok: true, seeds, outline: new Uint8Array(width * height) };
  }
  const outline = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const v = land[p];
      let coast = false;
      if (x > 0 && land[p - 1] !== v) coast = true;
      else if (x + 1 < width && land[p + 1] !== v) coast = true;
      else if (y > 0 && land[p - width] !== v) coast = true;
      else if (y + 1 < height && land[p + width] !== v) coast = true;
      outline[p] = coast ? 255 : 0;
    }
  }
  let cur = new Uint16Array(2 * width * height);
  let nxt = new Uint16Array(2 * width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (outline[p] === 255) {
        cur[2 * p] = x;
        cur[2 * p + 1] = y;
      } else {
        cur[2 * p] = JFA_SENTINEL;
        cur[2 * p + 1] = JFA_SENTINEL;
      }
    }
  }
  const side = width > height ? width : height;
  let passes = 0;
  let cover = 1;
  while (cover < side) {
    passes += 1;
    cover *= 2;
  }
  for (let k = passes - 1; k >= 0; k--) {
    const s = 2 ** k;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        let bestDsq = 0;
        let bestCy = 0;
        let bestCx = 0;
        let found = false;
        const selfX = cur[2 * p];
        if (selfX !== JFA_SENTINEL) {
          const selfY = cur[2 * p + 1];
          bestDsq = (selfX - x) * (selfX - x) + (selfY - y) * (selfY - y);
          bestCy = selfY;
          bestCx = selfX;
          found = true;
        }
        for (let dy = -s; dy <= s; dy += s) {
          for (let dx = -s; dx <= s; dx += s) {
            if (dx === 0 && dy === 0) continue;
            const qx = x + dx;
            const qy = y + dy;
            if (qx < 0 || qy < 0 || qx >= width || qy >= height) continue;
            const q = qy * width + qx;
            const cx = cur[2 * q];
            if (cx === JFA_SENTINEL) continue;
            const cy = cur[2 * q + 1];
            const dsq = (cx - x) * (cx - x) + (cy - y) * (cy - y);
            if (
              !found ||
              dsq < bestDsq ||
              (dsq === bestDsq && (cy < bestCy || (cy === bestCy && cx < bestCx)))
            ) {
              bestDsq = dsq;
              bestCy = cy;
              bestCx = cx;
              found = true;
            }
          }
        }
        if (found) {
          nxt[2 * p] = bestCx;
          nxt[2 * p + 1] = bestCy;
        } else {
          nxt[2 * p] = JFA_SENTINEL;
          nxt[2 * p + 1] = JFA_SENTINEL;
        }
      }
    }
    const tmp = cur;
    cur = nxt;
    nxt = tmp;
  }
  return { ok: true, seeds: cur, outline };
}

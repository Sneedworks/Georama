import { describe, expect, it } from 'vitest';
import {
  PATH_GRID,
  PathError,
  pathIndexTable,
  pathLayerReference,
  type PathErrorCode,
  type PathStyle,
} from '../../src/core/paths/textured.ts';
import { parsePoints } from '../../src/core/formats/wonderdraft-points.ts';

const SENTINEL = 65535;
const GRID_W = PATH_GRID.width;
const GRID_H = PATH_GRID.height;

// Style for the hand example: texel (u, v) = (64u, 64v, 128, 255) on a 4 x 4 texture, row 0 first.
function handStyle(): PathStyle {
  const bytes = new Uint8Array(4 * 4 * 4);
  for (let v = 0; v < 4; v++) {
    for (let u = 0; u < 4; u++) {
      const k = (v * 4 + u) * 4;
      bytes[k] = 64 * u;
      bytes[k + 1] = 64 * v;
      bytes[k + 2] = 128;
      bytes[k + 3] = 255;
    }
  }
  return { width: 4, height: 4, bytes };
}

function entry(table: { index: Uint16Array }, x: number, y: number): number[] {
  const k = 2 * (y * GRID_W + x);
  return [table.index[k], table.index[k + 1]];
}

function texel(layer: Uint8Array, x: number, y: number): number[] {
  const k = 4 * (y * GRID_W + x);
  return Array.from(layer.subarray(k, k + 4));
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Exact coverage by brute force: a pixel is covered when some segment is within the half-width.
// Doubled units throughout; the comparisons are integer comparisons, with no division.
function bruteCovered(qx: number[], qy: number[], width: number, x: number, y: number): boolean {
  const px = 2 * x + 1;
  const py = 2 * y + 1;
  const h2 = width * width;
  for (let i = 0; i + 1 < qx.length; i++) {
    const ax = 2 * qx[i];
    const ay = 2 * qy[i];
    const bx = 2 * qx[i + 1];
    const by = 2 * qy[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const rx = px - ax;
    const ry = py - ay;
    const dot = rx * dx + ry * dy;
    const cross = dx * ry - dy * rx;
    if (dot > 0 && dot < l2) {
      if (cross * cross <= h2 * l2) return true;
    } else {
      const ex = dot <= 0 ? rx : px - bx;
      const ey = dot <= 0 ? ry : py - by;
      if (ex * ex + ey * ey <= h2) return true;
    }
  }
  return false;
}

describe('hand-computed 4 x 4 example: points (1,1)-(3,1), width 2, period 8, style 4 x 4', () => {
  const table = pathIndexTable(new Float32Array([1, 1, 3, 1]), 2, 8, handStyle());

  it('covers rows 0 and 1 of the corner, with the hand-computed indices', () => {
    expect(entry(table, 0, 0)).toEqual([0, 1]);
    expect(entry(table, 1, 0)).toEqual([0, 1]);
    expect(entry(table, 2, 0)).toEqual([1, 1]);
    expect(entry(table, 3, 0)).toEqual([2, 1]);
    expect(entry(table, 0, 1)).toEqual([0, 3]);
    expect(entry(table, 1, 1)).toEqual([0, 3]);
    expect(entry(table, 2, 1)).toEqual([1, 3]);
    expect(entry(table, 3, 1)).toEqual([2, 3]);
  });

  it('leaves rows 2 and 3 of the corner uncovered', () => {
    for (let y = 2; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(entry(table, x, y)).toEqual([SENTINEL, SENTINEL]);
      }
    }
  });

  it('is sized to the grid and to the style it was built with', () => {
    expect(table.gridWidth).toBe(64);
    expect(table.gridHeight).toBe(48);
    expect(table.styleWidth).toBe(4);
    expect(table.styleHeight).toBe(4);
    expect(table.index.length).toBe(2 * 64 * 48);
  });

  it('leaves the rest of the grid uncovered', () => {
    expect(entry(table, 63, 47)).toEqual([SENTINEL, SENTINEL]);
    expect(entry(table, 40, 30)).toEqual([SENTINEL, SENTINEL]);
  });
});

describe('tie-breaking', () => {
  it('a pixel equidistant from two segments belongs to the lower segment index', () => {
    // Path A, B, A: pixel (1,1) is equally far from segment 0 and segment 1, so segment 0 owns it.
    // Segment 1 would give uIdx 3, so this entry distinguishes the two owners.
    const table = pathIndexTable(new Float32Array([1, 1, 3, 1, 1, 1]), 2, 8, handStyle());
    expect(entry(table, 1, 1)).toEqual([0, 3]);
  });
});

describe('parsePoints output is accepted as input', () => {
  it('the text form of the same path gives the same table', () => {
    const points = parsePoints('[ Vector2( 1, 1 ), Vector2( 3, 1 ) ]');
    const table = pathIndexTable(points, 2, 8, handStyle());
    expect(entry(table, 0, 0)).toEqual([0, 1]);
    expect(entry(table, 3, 1)).toEqual([2, 3]);
  });
});

describe('layer reference', () => {
  const style = handStyle();
  const table = pathIndexTable(new Float32Array([1, 1, 3, 1]), 2, 8, style);
  const colour: [number, number, number, number] = [200, 120, 40, 255];

  it('covered pixels take floor((t x c + 127) / 255) per channel', () => {
    const layer = pathLayerReference(table, style, colour);
    // (0,0): texel (0, 64, 128, 255) -> (0, 30, 20, 255)
    expect(texel(layer, 0, 0)).toEqual([0, 30, 20, 255]);
    // (3,1): texel (128, 192, 128, 255) -> (100, 90, 20, 255)
    expect(texel(layer, 3, 1)).toEqual([100, 90, 20, 255]);
  });

  it('uncovered pixels are transparent black, and the output is 64 x 48 x 4 bytes', () => {
    const layer = pathLayerReference(table, style, colour);
    expect(layer.length).toBe(GRID_W * GRID_H * 4);
    expect(texel(layer, 0, 2)).toEqual([0, 0, 0, 0]);
  });
});

describe('error codes follow G1', () => {
  const style = handStyle();
  const ok = new Float32Array([1, 1, 3, 1]);
  const many = new Float32Array(130);
  for (let i = 0; i < 65; i++) {
    many[2 * i] = i % 2 ? 64 : 0;
    many[2 * i + 1] = 0;
  }
  const cases: Array<[string, () => unknown, PathErrorCode]> = [
    ['width 0', () => pathIndexTable(ok, 0, 8, style), 'param'],
    ['width 17', () => pathIndexTable(ok, 17, 8, style), 'param'],
    ['period 0', () => pathIndexTable(ok, 2, 0, style), 'param'],
    ['period 257', () => pathIndexTable(ok, 2, 257, style), 'param'],
    ['style byte length wrong', () => pathIndexTable(ok, 2, 8, { width: 4, height: 4, bytes: new Uint8Array(10) }), 'length'],
    ['odd points length', () => pathIndexTable(new Float32Array([1, 1, 3]), 2, 8, style), 'length'],
    ['NaN coordinate', () => pathIndexTable(new Float32Array([NaN, 1, 3, 1]), 2, 8, style), 'param'],
    ['raw x 64.4 (refused before rounding)', () => pathIndexTable(new Float32Array([64.4, 1, 3, 1]), 2, 8, style), 'limit'],
    ['raw y 48.5', () => pathIndexTable(new Float32Array([1, 48.5, 3, 1]), 2, 8, style), 'limit'],
    ['one vertex after rounding', () => pathIndexTable(new Float32Array([1, 1, 1.2, 1.1]), 2, 8, style), 'param'],
    ['65 vertices', () => pathIndexTable(many, 2, 8, style), 'limit'],
    ['colour channel 256', () => pathLayerReference(pathIndexTable(ok, 2, 8, style), style, [256, 0, 0, 0]), 'param'],
    [
      'style does not match the table',
      () => pathLayerReference(pathIndexTable(ok, 2, 8, style), { width: 8, height: 8, bytes: new Uint8Array(256) }, [0, 0, 0, 0]),
      'length',
    ],
  ];
  it.each(cases)('%s gives %s', (_name, run, expected) => {
    let got = 'none';
    try {
      run();
    } catch (e) {
      got = e instanceof PathError ? e.code : 'other';
    }
    expect(got).toBe(expected);
  });
});

describe('coverage against brute force on random polylines', () => {
  it('a pixel is uncovered exactly when no segment is within the half-width', () => {
    const rnd = lcg(0x1f2e3d);
    for (let trial = 0; trial < 60; trial++) {
      const n = 2 + Math.floor(rnd() * 5);
      const qx: number[] = [];
      const qy: number[] = [];
      const flat = new Float32Array(2 * n);
      for (let i = 0; i < n; i++) {
        let x = 0;
        let y = 0;
        do {
          x = Math.floor(rnd() * 65);
          y = Math.floor(rnd() * 49);
        } while (i > 0 && x === qx[i - 1] && y === qy[i - 1]);
        qx.push(x);
        qy.push(y);
        flat[2 * i] = x;
        flat[2 * i + 1] = y;
      }
      const width = 1 + Math.floor(rnd() * 16);
      const period = 1 + Math.floor(rnd() * 256);
      const sw = 4 + Math.floor(rnd() * 5);
      const sh = 4 + Math.floor(rnd() * 5);
      const bytes = new Uint8Array(sw * sh * 4);
      for (let k = 0; k < bytes.length; k++) bytes[k] = Math.floor(rnd() * 256);
      const table = pathIndexTable(flat, width, period, { width: sw, height: sh, bytes });
      for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
          const [r, g] = entry(table, x, y);
          const covered = bruteCovered(qx, qy, width, x, y);
          expect(r === SENTINEL).toBe(!covered);
          if (covered) {
            expect(r < sw).toBe(true);
            expect(g < sh).toBe(true);
          }
        }
      }
    }
  });
});

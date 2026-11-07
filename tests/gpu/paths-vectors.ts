// Card 1.6 test vectors: one 8 x 8 RGBA8 style and six polyline sets, all from the fixed LCG seed 0x3a6b.
// The style is drawn first (256 bytes), then the sets in order. Coordinates are float draws inside the
// 64 x 48 grid, so G1 rounding is exercised. Used by the unit test and the GPU case.
import type { PathStyle } from '../../src/core/paths/textured.ts';

export interface PathVectorSet {
  readonly name: string;
  readonly points: Float32Array;
  readonly width: number;
  readonly period: number;
}

const SEED = 0x3a6b;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const rnd = lcg(SEED);

const styleBytes = new Uint8Array(8 * 8 * 4);
for (let k = 0; k < styleBytes.length; k++) styleBytes[k] = Math.floor(rnd() * 256);

export const pathVectorStyle: PathStyle = { width: 8, height: 8, bytes: styleBytes };

type Vertex = readonly [number, number];

function vertex(): Vertex {
  return [rnd() * 64, rnd() * 48];
}

function makeSet(name: string, width: number, period: number, verts: readonly Vertex[]): PathVectorSet {
  const points = new Float32Array(verts.length * 2);
  verts.forEach(([x, y], i) => {
    points[2 * i] = x;
    points[2 * i + 1] = y;
  });
  return { name, points, width, period };
}

const sets: PathVectorSet[] = [];

// 1: straight
{
  const a = vertex();
  const b = vertex();
  sets.push(makeSet('straight', 1, 16, [a, b]));
}

// 2: corner
{
  const a = vertex();
  const b = vertex();
  const c = vertex();
  sets.push(makeSet('corner', 2, 16, [a, b, c]));
}

// 3: zigzag
{
  const v: Vertex[] = [];
  for (let i = 0; i < 5; i++) v.push(vertex());
  sets.push(makeSet('zigzag', 3, 16, v));
}

// 4: closed loop; the last vertex returns to the first
{
  const a = vertex();
  const b = vertex();
  const c = vertex();
  const d = vertex();
  sets.push(makeSet('closed loop', 5, 16, [a, b, c, d, a]));
}

// 5: duplicate vertex; b appears twice in a row
{
  const a = vertex();
  const b = vertex();
  const c = vertex();
  sets.push(makeSet('duplicate vertex', 8, 16, [a, b, b, c]));
}

// 6: edge touching; the left, top, right and bottom edges
{
  const a: Vertex = [0, rnd() * 48];
  const b: Vertex = [rnd() * 64, 0];
  const c: Vertex = [64, rnd() * 48];
  const d: Vertex = [rnd() * 64, 48];
  sets.push(makeSet('edge touching', 16, 7, [a, b, c, d]));
}

export const pathVectorSets: readonly PathVectorSet[] = sets;

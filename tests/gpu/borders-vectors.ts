// Card 1.7 test vectors: one 8 x 8 RGBA8 style and three outline sets, all from the fixed LCG seed 0x7c2e.
// The style is drawn first (256 bytes), then the sets in order. Coordinates are float draws inside the 64 x 48 grid.
// The generator is the card 1.6 generator, written out here: card 1.7 does not touch tests/gpu/paths-vectors.ts.
import type { PathStyle } from '../../src/core/paths/textured.ts';

export interface BorderVectorSet {
  readonly name: string;
  readonly points: Float32Array;
  readonly closed: boolean;
  readonly width: number;
  readonly period: number;
}

const SEED = 0x7c2e;

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

export const borderVectorStyle: PathStyle = { width: 8, height: 8, bytes: styleBytes };

type Vertex = readonly [number, number];

function vertex(): Vertex {
  return [rnd() * 64, rnd() * 48];
}

function makeSet(name: string, closed: boolean, width: number, period: number, verts: readonly Vertex[]): BorderVectorSet {
  const points = new Float32Array(verts.length * 2);
  verts.forEach(([x, y], i) => {
    points[2 * i] = x;
    points[2 * i + 1] = y;
  });
  return { name, points, closed, width, period };
}

const sets: BorderVectorSet[] = [];

// 1: closed quadrilateral (eight draws)
{
  const a = vertex();
  const b = vertex();
  const c = vertex();
  const d = vertex();
  sets.push(makeSet('closed quadrilateral', true, 2, 16, [a, b, c, d]));
}

// 2: open zigzag (ten draws)
{
  const v: Vertex[] = [];
  for (let i = 0; i < 5; i++) v.push(vertex());
  sets.push(makeSet('open zigzag', false, 3, 9, v));
}

// 3: closed outline with a repeated vertex (eight draws; the second b is the same vertex, not drawn again)
{
  const a = vertex();
  const b = vertex();
  const c = vertex();
  const d = vertex();
  sets.push(makeSet('closed outline with a repeated vertex', true, 5, 12, [a, b, b, c, d]));
}

export const borderVectorSets: readonly BorderVectorSet[] = sets;

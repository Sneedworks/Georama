import { jumpFloodReference, type ClassGrid } from '../../src/core/sdf/jfa.ts';
import { GlBudget } from '../../src/renderer/render/gl/budget.ts';
import { createGlContext } from '../../src/renderer/render/gl/context.ts';
import { jumpFloodGpu } from '../../src/renderer/render/sdf/jfa-gpu.ts';
import { assertEqual, assertThrowsGl, assertTrue, freshCanvas, type GpuCase } from './index.ts';

function assertJfaMatchesCpu(
  gl: WebGL2RenderingContext,
  grid: ClassGrid,
  label: string,
): void {
  const budget = new GlBudget();
  const gpu = jumpFloodGpu(gl, grid, { budget });
  assertEqual(budget.usedBytes, 0, `${label} budget released`);
  const cpu = jumpFloodReference(grid);
  assertTrue(cpu.ok, `${label} reference ok`);
  if (!cpu.ok) return;
  assertEqual(gpu.outline.length, cpu.outline.length, `${label} outline length`);
  for (let i = 0; i < gpu.outline.length; i++) {
    if (gpu.outline[i] !== cpu.outline[i]) {
      throw new Error(`${label} outline[${i}]: expected ${cpu.outline[i]}, got ${gpu.outline[i]}`);
    }
  }
  assertEqual(gpu.seeds.length, cpu.seeds.length, `${label} seeds length`);
  for (let i = 0; i < gpu.seeds.length; i++) {
    if (gpu.seeds[i] !== cpu.seeds[i]) {
      throw new Error(`${label} seeds[${i}]: expected ${cpu.seeds[i]}, got ${gpu.seeds[i]}`);
    }
  }
}

function onFreshGl(action: (gl: WebGL2RenderingContext) => void): () => void {
  return () => {
    const canvas = freshCanvas();
    const context = createGlContext(canvas);
    try {
      action(context.gl);
    } finally {
      context.dispose();
    }
  };
}

function gridOf(width: number, height: number, land: Uint8Array): ClassGrid {
  return { width, height, land };
}

function handExample(): ClassGrid {
  const width = 4;
  const height = 3;
  const land = new Uint8Array(width * height);
  land[1 * width + 1] = 1;
  return gridOf(width, height, land);
}

function twoIslands(): ClassGrid {
  const width = 9;
  const height = 7;
  const land = new Uint8Array(width * height);
  for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2], [5, 4], [6, 4], [5, 5], [6, 5]]) {
    land[y * width + x] = 1;
  }
  return gridOf(width, height, land);
}

function checkerboard(): ClassGrid {
  const width = 8;
  const height = 8;
  const land = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      land[y * width + x] = (x + y) % 2;
    }
  }
  return gridOf(width, height, land);
}

// Linear congruential generator for the seeded grid below.
const SDF_LCG_MULTIPLIER = 1103515245;
const SDF_LCG_INCREMENT = 12345;
const SDF_LCG_MASK = 0x7fffffff;
const SDF_LCG_SEED = 20261020;

function seededGrid(): ClassGrid {
  const width = 64;
  const height = 48;
  const land = new Uint8Array(width * height);
  let state = SDF_LCG_SEED;
  for (let i = 0; i < land.length; i++) {
    state = (state * SDF_LCG_MULTIPLIER + SDF_LCG_INCREMENT) & SDF_LCG_MASK;
    land[i] = state % 3 === 0 ? 1 : 0;
  }
  return gridOf(width, height, land);
}

function refusalsAndLimits(): void {
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;
    assertThrowsGl(
      'LIMIT',
      () => jumpFloodGpu(gl, gridOf(9, 1, new Uint8Array(9)), { budget: new GlBudget(), maxTextureSize: 8 }),
      'maxTextureSize refusal',
    );
    assertThrowsGl(
      'UPLOAD',
      () => jumpFloodGpu(gl, gridOf(2, 2, new Uint8Array(3)), { budget: new GlBudget() }),
      'wrong-length land',
    );
    assertThrowsGl(
      'LIMIT',
      () => jumpFloodGpu(gl, gridOf(16385, 1, new Uint8Array(16385)), { budget: new GlBudget() }),
      'side above limit',
    );
  } finally {
    context.dispose();
  }
}

interface SdfTimingSize {
  readonly width: number;
  readonly height: number;
}

function sdfTimingSizes(): SdfTimingSize[] | null {
  const raw = (globalThis as unknown as Record<string, unknown>).__GEORAMA_SDF_SIZES__;
  if (typeof raw !== 'string' || raw === '') return null;
  const sizes: SdfTimingSize[] = [];
  for (const part of raw.split(',')) {
    const match = /^(\d+)x(\d+)$/.exec(part);
    if (match === null) throw new Error(`sdf timing: malformed size ${JSON.stringify(part)}`);
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
      throw new Error(`sdf timing: malformed size ${JSON.stringify(part)}`);
    }
    sizes.push({ width, height });
  }
  if (sizes.length === 0) return null;
  return sizes;
}

// Disc-shaped land grid built with integer arithmetic only.
function discLand(width: number, height: number): Uint8Array {
  const land = new Uint8Array(width * height);
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const radius = Math.floor(Math.min(width, height) / 2);
  const radiusSq = radius * radius;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radiusSq) land[y * width + x] = 1;
    }
  }
  return land;
}

function sdfTiming(): { detail: string } {
  const sizes = sdfTimingSizes();
  if (sizes === null) throw new Error('sdf timing: no sizes');
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;
    const parts: string[] = [];
    for (const { width, height } of sizes) {
      const grid = gridOf(width, height, discLand(width, height));
      jumpFloodGpu(gl, grid, { budget: new GlBudget() });
      const samples: number[] = [];
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        jumpFloodGpu(gl, grid, { budget: new GlBudget() });
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      const median = samples[2];
      const max = samples[4];
      parts.push(`${width}x${height} median=${median.toFixed(1)}ms max=${max.toFixed(1)}ms`);
    }
    return { detail: parts.join('; ') };
  } finally {
    context.dispose();
  }
}

const syntheticCases: readonly GpuCase[] = [
  { name: 'sdf: 1x1 water', run: onFreshGl((gl) => assertJfaMatchesCpu(gl, gridOf(1, 1, new Uint8Array([0])), 'sdf: 1x1 water')) },
  { name: 'sdf: 4x4 all land', run: onFreshGl((gl) => assertJfaMatchesCpu(gl, gridOf(4, 4, new Uint8Array(16).fill(1)), 'sdf: 4x4 all land')) },
  { name: 'sdf: 5x3 all water', run: onFreshGl((gl) => assertJfaMatchesCpu(gl, gridOf(5, 3, new Uint8Array(15)), 'sdf: 5x3 all water')) },
  { name: 'sdf: 7x1 row', run: onFreshGl((gl) => assertJfaMatchesCpu(gl, gridOf(7, 1, new Uint8Array([0, 0, 1, 1, 1, 0, 0])), 'sdf: 7x1 row')) },
  { name: 'sdf: 1x6 column', run: onFreshGl((gl) => assertJfaMatchesCpu(gl, gridOf(1, 6, new Uint8Array([0, 1, 1, 1, 0, 0])), 'sdf: 1x6 column')) },
  { name: 'sdf: 4x3 hand example', run: onFreshGl((gl) => assertJfaMatchesCpu(gl, handExample(), 'sdf: 4x3 hand example')) },
  { name: 'sdf: 9x7 two islands', run: onFreshGl((gl) => assertJfaMatchesCpu(gl, twoIslands(), 'sdf: 9x7 two islands')) },
  { name: 'sdf: 8x8 checkerboard', run: onFreshGl((gl) => assertJfaMatchesCpu(gl, checkerboard(), 'sdf: 8x8 checkerboard')) },
  { name: 'sdf: 64x48 seeded', run: onFreshGl((gl) => assertJfaMatchesCpu(gl, seededGrid(), 'sdf: 64x48 seeded')) },
  { name: 'sdf: refusals and limits', run: refusalsAndLimits },
];

export const sdfCases: readonly GpuCase[] = syntheticCases;

export function sdfTimingCases(): readonly GpuCase[] {
  return sdfTimingSizes() === null ? [] : [{ name: 'sdf: timing', run: sdfTiming }];
}

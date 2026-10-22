import { assertEqual, assertThrowsGlAsync, freshCanvas, type GpuCase } from './index.ts';
import { createGlContext } from '../../src/renderer/render/gl/context.ts';
import { createFramebuffer, readTexels } from '../../src/renderer/render/gl/fbo.ts';
import { GlBudget } from '../../src/renderer/render/gl/budget.ts';
import { uploadRasterLayer, type RasterSource } from '../../src/renderer/render/layers/raster-upload.ts';

const LW = 37;
const LH = 23;
const LAYER_CHUNK_BYTES = 444;

function maskPattern(x: number, y: number): readonly [number, number, number, number] {
  return [(x * 5 + y * 11) & 255, (x * 13 + y * 7 + 41) & 255, (x * 3 + y * 17 + 97) & 255, (x * 29 + y * 31) & 255];
}

function groundPattern(x: number, y: number): readonly [number, number, number, number] {
  return [(x * 7 + y * 13 + 5) & 255, (x * 11 + y * 3 + 67) & 255, (x * 17 + y * 5 + 131) & 255, 255];
}

function waterTintPattern(x: number, y: number): readonly [number, number, number, number] {
  return [(x * 9 + y * 23 + 17) & 255, (x * 19 + y * 29 + 53) & 255, (x * 31 + y * 37 + 89) & 255, (x + y) % 8 === 0 ? 128 : 0];
}

function buildLayer(pattern: (x: number, y: number) => readonly [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(LW * LH * 4);
  for (let y = 0; y < LH; y++) {
    for (let x = 0; x < LW; x++) {
      const [r, g, b, a] = pattern(x, y);
      const i = (y * LW + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return data;
}

async function chunkedUploadExact(): Promise<void> {
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;
    const layers = [
      { label: 'mask', data: buildLayer(maskPattern) },
      { label: 'ground', data: buildLayer(groundPattern) },
      { label: 'waterTint', data: buildLayer(waterTintPattern) },
    ];
    for (const layer of layers) {
      const uploaded = await uploadRasterLayer(
        gl,
        { width: LW, height: LH, format: 'RGBA8', data: layer.data },
        { maxChunkBytes: LAYER_CHUNK_BYTES, label: layer.label },
      );
      try {
        assertEqual(uploaded.chunks, 8, `${layer.label} chunks`);
        assertEqual(uploaded.yields, 7, `${layer.label} yields`);
        const fb = createFramebuffer(gl, [uploaded.texture]);
        try {
          const back = readTexels(gl, fb, 0, 0, 0, 37, 23);
          assertEqual(back instanceof Uint8Array, true, `${layer.label} readback class`);
          assertEqual(back.length, layer.data.length, `${layer.label} readback length`);
          for (let i = 0; i < layer.data.length; i++) {
            if (back[i] !== layer.data[i]) {
              throw new Error(`${layer.label} byte ${i}: expected ${layer.data[i]}, got ${back[i]}`);
            }
          }
        } finally {
          fb.dispose();
        }
      } finally {
        uploaded.texture.dispose();
      }
      assertEqual(gl.getError(), gl.NO_ERROR, `${layer.label} clean`);
    }
  } finally {
    context.dispose();
  }
}

function makePrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state >>> 24) & 255;
  };
}

async function randomTexelsExact(): Promise<void> {
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;
    const width = 1024;
    const height = 512;
    const next = makePrng(0x1a2b3c4d);
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const base = (y * width + x) * 4;
        data[base] = next();
        data[base + 1] = next();
        data[base + 2] = next();
        data[base + 3] = 255;
      }
    }
    const uploaded = await uploadRasterLayer(gl, { width, height, format: 'RGBA8', data }, { label: 'large' });
    try {
      assertEqual(uploaded.chunks, 2, 'large chunks');
      assertEqual(uploaded.yields, 1, 'large yields');
      const fb = createFramebuffer(gl, [uploaded.texture]);
      try {
        const pick = makePrng(0x5e6f7081);
        for (let n = 0; n < 256; n++) {
          const px = (pick() | (pick() << 8)) % width;
          const py = (pick() | (pick() << 8)) % height;
          const texel = readTexels(gl, fb, 0, px, py, 1, 1);
          assertEqual(texel instanceof Uint8Array, true, `texel (${px},${py}) class`);
          assertEqual(texel.length, 4, `texel (${px},${py}) length`);
          const base = (py * width + px) * 4;
          for (let c = 0; c < 4; c++) {
            if (texel[c] !== data[base + c]) {
              throw new Error(`texel (${px},${py})[${c}]: expected ${data[base + c]}, got ${texel[c]}`);
            }
          }
        }
      } finally {
        fb.dispose();
      }
    } finally {
      uploaded.texture.dispose();
    }
    assertEqual(gl.getError(), gl.NO_ERROR, 'large clean end');
  } finally {
    context.dispose();
  }
}

async function budgetAndAbortCleanup(): Promise<void> {
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;
    const budget = new GlBudget(1048576);
    const data = buildLayer(groundPattern);
    const bytes = LW * LH * 4;
    const uploaded = await uploadRasterLayer(
      gl,
      { width: LW, height: LH, format: 'RGBA8', data },
      { budget, label: 'budgeted', maxChunkBytes: LAYER_CHUNK_BYTES },
    );
    assertEqual(budget.usedBytes, bytes, 'budget reserved');
    uploaded.texture.dispose();
    assertEqual(budget.usedBytes, 0, 'budget released after dispose');

    const controller = new AbortController();
    const pending = uploadRasterLayer(
      gl,
      { width: LW, height: LH, format: 'RGBA8', data },
      {
        budget,
        label: 'aborted',
        maxChunkBytes: LAYER_CHUNK_BYTES,
        signal: controller.signal,
        yieldFrame: () => {
          controller.abort();
          return Promise.resolve();
        },
      },
    );
    await assertThrowsGlAsync('UPLOAD', () => pending, 'aborted upload rejects');
    assertEqual(budget.usedBytes, 0, 'budget released after abort');
    assertEqual(gl.getError(), gl.NO_ERROR, 'clean after abort');
  } finally {
    context.dispose();
  }
}

async function invalidInputRejects(): Promise<void> {
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;
    const budget = new GlBudget(1048576);
    const good: RasterSource = { width: 2, height: 2, format: 'RGBA8', data: new Uint8Array(2 * 2 * 4) };
    const bad: ReadonlyArray<{ raster: RasterSource; options?: { maxChunkBytes: number }; code: 'UPLOAD' | 'LIMIT'; name: string }> = [
      { raster: null as unknown as RasterSource, code: 'UPLOAD', name: 'null raster' },
      { raster: { ...good, format: 'R8' }, code: 'UPLOAD', name: 'format R8' },
      { raster: { ...good, width: 0 }, code: 'LIMIT', name: 'width 0' },
      { raster: { ...good, height: 1.5 }, code: 'LIMIT', name: 'height 1.5' },
      { raster: { ...good, data: new Uint8Array(15) }, code: 'UPLOAD', name: 'short data' },
      { raster: good, options: { maxChunkBytes: 4 }, code: 'LIMIT', name: 'maxChunkBytes below one row' },
    ];
    for (const item of bad) {
      await assertThrowsGlAsync(item.code, () => uploadRasterLayer(gl, item.raster, { budget, ...item.options }), item.name);
      assertEqual(budget.usedBytes, 0, `${item.name} no allocation`);
      assertEqual(gl.getError(), gl.NO_ERROR, `${item.name} clean`);
    }
  } finally {
    context.dispose();
  }
}

async function preAbortedRejectsBeforeAllocation(): Promise<void> {
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;
    const bytes = LW * LH * 4;
    // The budget is one byte too small for the layer. An upload that reserved before honouring the
    // pre-aborted signal would fail with LIMIT instead of UPLOAD, so this proves the early exit.
    const budget = new GlBudget(bytes - 1);
    const controller = new AbortController();
    controller.abort();
    const pending = uploadRasterLayer(
      gl,
      { width: LW, height: LH, format: 'RGBA8', data: buildLayer(groundPattern) },
      { budget, label: 'pre-aborted', maxChunkBytes: LAYER_CHUNK_BYTES, signal: controller.signal },
    );
    await assertThrowsGlAsync('UPLOAD', () => pending, 'pre-aborted upload rejects before allocation');
    assertEqual(budget.usedBytes, 0, 'pre-aborted upload reserved nothing');
    assertEqual(gl.getError(), gl.NO_ERROR, 'clean after pre-aborted upload');
  } finally {
    context.dispose();
  }
}

export const layersCases: readonly GpuCase[] = [
  { name: 'layers: chunked upload exact (mask, ground, waterTint)', run: chunkedUploadExact },
  { name: 'layers: random texels exact on a larger layer', run: randomTexelsExact },
  { name: 'layers: budget and abort cleanup', run: budgetAndAbortCleanup },
  { name: 'layers: invalid input rejects before any allocation', run: invalidInputRejects },
  { name: 'layers: pre-aborted upload rejects before allocation', run: preAbortedRejectsBeforeAllocation },
];

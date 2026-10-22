import { describe, expect, it } from 'vitest';
import { DEFAULT_CHUNK_BYTES, planRasterUpload } from '../../src/renderer/render/layers/chunk-plan.ts';

function makeRaster(width: number, height: number, format = 'RGBA8'): { width: number; height: number; format: string; data: Uint8Array } {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = i & 255;
  return { width, height, format, data };
}

function expectFullCoverage(width: number, height: number, maxChunkBytes: number | undefined): void {
  const raster = makeRaster(width, height);
  const plan = planRasterUpload(raster, maxChunkBytes);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  let cursor = 0;
  for (const chunk of plan.chunks) {
    expect(chunk.y0).toBe(cursor);
    expect(chunk.rows).toBeGreaterThanOrEqual(1);
    cursor += chunk.rows;
  }
  expect(cursor).toBe(height);
}

describe('planRasterUpload valid plans', () => {
  it('exposes DEFAULT_CHUNK_BYTES as 1048576', () => {
    expect(DEFAULT_CHUNK_BYTES).toBe(1048576);
  });

  it('splits a 37x23 raster with maxChunkBytes 444 into 8 chunks with a 2-row tail', () => {
    const plan = planRasterUpload(makeRaster(37, 23), 444);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.chunks.length).toBe(8);
    for (let i = 0; i < 7; i++) {
      expect(plan.chunks[i].y0).toBe(i * 3);
      expect(plan.chunks[i].rows).toBe(3);
    }
    expect(plan.chunks[7].y0).toBe(21);
    expect(plan.chunks[7].rows).toBe(2);
  });

  it('covers [0, height) contiguously in order for several shapes', () => {
    expectFullCoverage(1, 1, undefined);
    expectFullCoverage(5, 7, 5 * 4);
    expectFullCoverage(4, 4, 4 * 4 * 4);
    expectFullCoverage(10, 7, 10 * 4 * 3);
    expectFullCoverage(37, 23, 444);
  });

  it('uses one row per chunk for a 5x7 raster with maxChunkBytes of one row', () => {
    const plan = planRasterUpload(makeRaster(5, 7), 5 * 4);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.chunks.length).toBe(7);
    for (let i = 0; i < 7; i++) {
      expect(plan.chunks[i].y0).toBe(i);
      expect(plan.chunks[i].rows).toBe(1);
    }
  });

  it('uses a single chunk when the default budget fits the whole 1x1 layer', () => {
    const plan = planRasterUpload(makeRaster(1, 1));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.chunks.length).toBe(1);
    expect(plan.chunks[0].y0).toBe(0);
    expect(plan.chunks[0].rows).toBe(1);
  });
});

describe('planRasterUpload invalid inputs return verdicts', () => {
  it('class a: a null raster returns UPLOAD', () => {
    expect(planRasterUpload(null)).toMatchObject({ ok: false, code: 'UPLOAD' });
  });

  it('class a: a non-object raster returns UPLOAD', () => {
    expect(planRasterUpload(42)).toMatchObject({ ok: false, code: 'UPLOAD' });
  });

  it('class a: undefined, numeric and string rasters return the object-guard UPLOAD verdict', () => {
    for (const value of [undefined, 42, 'raster']) {
      expect(planRasterUpload(value)).toEqual({ ok: false, code: 'UPLOAD', message: 'raster must be an object' });
    }
  });

  it('class b: a non-RGBA8 format returns UPLOAD', () => {
    expect(planRasterUpload(makeRaster(4, 2, 'R8'))).toMatchObject({ ok: false, code: 'UPLOAD' });
  });

  it('class c: a width below 1 returns LIMIT', () => {
    const raster = { ...makeRaster(4, 2), width: 0 };
    expect(planRasterUpload(raster)).toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('class c: a non-safe-integer width returns LIMIT', () => {
    const raster = { ...makeRaster(4, 2), width: NaN };
    expect(planRasterUpload(raster)).toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('class d: a non-safe-integer height returns LIMIT', () => {
    const raster = { ...makeRaster(4, 2), height: 1.5 };
    expect(planRasterUpload(raster)).toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('class d: a height below 1 returns LIMIT', () => {
    const raster = { ...makeRaster(4, 2), height: 0 };
    expect(planRasterUpload(raster)).toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('class e: data that is not a Uint8Array returns UPLOAD', () => {
    const raster = { ...makeRaster(4, 2), data: new Uint16Array(4 * 2 * 4) as unknown as Uint8Array };
    expect(planRasterUpload(raster)).toMatchObject({ ok: false, code: 'UPLOAD' });
  });

  it('class f: data with the wrong length returns UPLOAD', () => {
    const raster = { ...makeRaster(2, 2), data: new Uint8Array(2 * 2 * 4 - 1) };
    expect(planRasterUpload(raster)).toMatchObject({ ok: false, code: 'UPLOAD' });
  });

  it('class g: maxChunkBytes below one row returns LIMIT', () => {
    expect(planRasterUpload(makeRaster(2, 2), 4)).toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('class g: a non-safe-integer maxChunkBytes returns LIMIT', () => {
    expect(planRasterUpload(makeRaster(4, 4), NaN)).toMatchObject({ ok: false, code: 'LIMIT' });
  });
});

describe('planRasterUpload chunk budget boundary (strength)', () => {
  it('rejects every budget below one full row with LIMIT, including budgets inside the three-row band', () => {
    const width = 5;
    for (let budget = width * 4 - 1; budget >= width * 4 - 4; budget--) {
      expect(planRasterUpload(makeRaster(width, 2), budget)).toMatchObject({ ok: false, code: 'LIMIT' });
    }
  });

  it('pins the exact lower edge at width 1: a 3-byte budget is LIMIT and a 4-byte budget plans one row per chunk', () => {
    expect(planRasterUpload(makeRaster(1, 1), 3)).toMatchObject({ ok: false, code: 'LIMIT' });
    expect(planRasterUpload(makeRaster(1, 2), 4)).toEqual({ ok: true, chunks: [{ y0: 0, rows: 1 }, { y0: 1, rows: 1 }] });
  });

  it('accepts a budget of exactly one row and plans one row per chunk', () => {
    expect(planRasterUpload(makeRaster(5, 3), 5 * 4)).toEqual({
      ok: true,
      chunks: [
        { y0: 0, rows: 1 },
        { y0: 1, rows: 1 },
        { y0: 2, rows: 1 },
      ],
    });
  });
});

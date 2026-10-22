import { GlBudget, DEFAULT_GPU_BUDGET_BYTES } from '../../src/renderer/render/gl/budget.ts';
import { createGlContext } from '../../src/renderer/render/gl/context.ts';
import { createTexture2D } from '../../src/renderer/render/gl/texture.ts';
import { assertEqual, assertThrowsGl, assertTrue, freshCanvas, type GpuCase } from './index.ts';

async function budgetCase(): Promise<void> {
  assertEqual(DEFAULT_GPU_BUDGET_BYTES, 3 * 1024 ** 3, 'default budget is 3 GiB');
  const budget = new GlBudget(1000);
  assertEqual(budget.usedBytes, 0, 'starts empty');
  budget.reserve(100, 'a');
  budget.reserve(200, 'b');
  assertEqual(budget.usedBytes, 300, 'reserve adds');
  budget.release(40);
  assertEqual(budget.usedBytes, 260, 'release subtracts');
  // Refusal at exactly limit+1 changes nothing.
  assertThrowsGl('LIMIT', () => budget.reserve(741, 'over'), 'reserve past the limit');
  assertEqual(budget.usedBytes, 260, 'failed reserve changes nothing');
  // Reserving exactly up to the limit is allowed.
  budget.reserve(740, 'fill');
  assertEqual(budget.usedBytes, 1000, 'reserve to exactly the limit');
  // Releasing more than used is refused.
  assertThrowsGl('LIMIT', () => budget.release(1001), 'release below zero');
  assertEqual(budget.usedBytes, 1000, 'failed release changes nothing');
  budget.release(1000);
  assertEqual(budget.usedBytes, 0, 'release all');
  // Invalid constructor limits.
  for (const limit of [0, -1, 1.5, NaN, Infinity, 2 ** 53]) {
    assertThrowsGl('LIMIT', () => new GlBudget(limit), `constructor limit ${String(limit)}`);
  }
  // Invalid reserve/release amounts.
  assertThrowsGl('LIMIT', () => budget.reserve(-1, 'neg'), 'negative reserve');
  assertThrowsGl('LIMIT', () => budget.reserve(1.5, 'frac'), 'fractional reserve');
  assertThrowsGl('LIMIT', () => budget.release(-1), 'negative release');

  // With a real context: a 1 MiB budget holds exactly one 512x512 RGBA8 texture.
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;
    const mib = new GlBudget(1024 * 1024);
    const first = createTexture2D(gl, { width: 512, height: 512, format: 'RGBA8' }, mib);
    assertEqual(mib.usedBytes, 1024 * 1024, '1 MiB texture reserved');
    assertThrowsGl('LIMIT', () => createTexture2D(gl, { width: 512, height: 512, format: 'RGBA8' }, mib), 'second texture refused');
    assertEqual(mib.usedBytes, 1024 * 1024, 'refused texture changes nothing');
    assertEqual(gl.getError(), gl.NO_ERROR, 'no GL error from refused creation');
    first.dispose();
    assertEqual(mib.usedBytes, 0, 'dispose releases');
    first.dispose();
    assertEqual(mib.usedBytes, 0, 'dispose twice releases once');
    // A failing creation releases what it reserved.
    const mib2 = new GlBudget(1024 * 1024);
    assertThrowsGl(
      'UPLOAD',
      () => createTexture2D(gl, { width: 512, height: 512, format: 'RGBA8', data: new Uint8Array(8) }, mib2),
      'creation with bad data',
    );
    assertEqual(mib2.usedBytes, 0, 'failed creation releases its reservation');
    assertTrue(first.texture instanceof WebGLTexture, 'texture handle survives dispose as an object');
  } finally {
    context.dispose();
  }
}

export const budgetCases: readonly GpuCase[] = [
  { name: 'budget', run: budgetCase },
];

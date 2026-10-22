import { GlError } from '../../src/renderer/render/gl/errors.ts';
import { budgetCases } from './cases-budget.ts';
import { capsCases } from './cases-caps.ts';
import { composeCases } from './cases-compose.ts';
import { contextCases } from './cases-context.ts';
import { fboCases } from './cases-fbo.ts';
import { layersCases } from './cases-layers.ts';
import { readbackCases } from './cases-readback.ts';
import { sdfCases, sdfTimingCases } from './cases-sdf.ts';
import { shaderCases } from './cases-shader.ts';
import { textureCases } from './cases-texture.ts';

export interface GpuCase {
  readonly name: string;
  readonly run: () => void | { detail: string } | Promise<void | { detail: string }>;
}

export interface GpuCaseResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly ms: number;
}

export interface GpuReport {
  readonly renderer: string | null;
  readonly vendor: string | null;
  readonly maxTextureSize: number;
  readonly formats: ReadonlyArray<{ name: string; texture: boolean; renderable: boolean; roundTrip: boolean }>;
  readonly results: readonly GpuCaseResult[];
}

export function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertTrue(value: unknown, message: string): void {
  if (value !== true) {
    throw new Error(`${message}: expected true, got ${JSON.stringify(value)}`);
  }
}

export function assertThrowsGl(code: GlError['code'], fn: () => unknown, message: string): GlError {
  try {
    fn();
  } catch (error) {
    if (error instanceof GlError && error.code === code) return error;
    const got = error instanceof GlError ? `GlError('${error.code}')` : String(error);
    throw new Error(`${message}: expected GlError('${code}'), got ${got}`);
  }
  throw new Error(`${message}: expected GlError('${code}'), nothing was thrown`);
}

export async function assertThrowsGlAsync(code: GlError['code'], fn: () => Promise<unknown>, message: string): Promise<GlError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof GlError && error.code === code) return error;
    const got = error instanceof GlError ? `GlError('${error.code}')` : String(error);
    throw new Error(`${message}: expected GlError('${code}'), got ${got}`);
  }
  throw new Error(`${message}: expected GlError('${code}'), nothing was thrown`);
}

/** A fresh unattached canvas with a best-effort synchronous disposal. */
export function freshCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  return canvas;
}

const ALL_CASES: readonly GpuCase[] = [
  ...contextCases,
  ...capsCases,
  ...shaderCases,
  ...textureCases,
  ...budgetCases,
  ...fboCases,
  ...readbackCases,
  ...layersCases,
  ...composeCases,
  ...sdfCases,
  ...sdfTimingCases(),
];

export async function runAll(only?: string): Promise<GpuReport> {
  const filter = typeof only === 'string' ? only : '';
  const selected = filter !== '' ? ALL_CASES.filter((c) => c.name.includes(filter)) : [...ALL_CASES];
  let header: { renderer: string | null; vendor: string | null; maxTextureSize: number; formats: GpuReport['formats'] } = {
    renderer: null,
    vendor: null,
    maxTextureSize: 0,
    formats: [],
  };
  try {
    const canvas = freshCanvas();
    const { createGlContext } = await import('../../src/renderer/render/gl/context.ts');
    const { probeCaps } = await import('../../src/renderer/render/gl/caps.ts');
    const context = createGlContext(canvas);
    try {
      const caps = probeCaps(context.gl);
      header = {
        renderer: caps.unmaskedRenderer,
        vendor: caps.unmaskedVendor,
        maxTextureSize: caps.maxTextureSize,
        formats: caps.formats.map((f) => ({ name: f.name, texture: f.texture, renderable: f.renderable, roundTrip: f.roundTrip })),
      };
    } finally {
      context.dispose();
    }
  } catch {
    // Header stays null-filled; the cases report the real failures.
  }
  const results: GpuCaseResult[] = [];
  for (const c of selected) {
    const start = performance.now();
    try {
      const returned = await c.run();
      const detail = typeof returned === 'object' && returned !== null && typeof returned.detail === 'string'
        ? returned.detail
        : '';
      results.push({ name: c.name, ok: true, detail, ms: Math.round((performance.now() - start) * 10) / 10 });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      results.push({ name: c.name, ok: false, detail, ms: Math.round((performance.now() - start) * 10) / 10 });
    }
  }
  return { ...header, results };
}

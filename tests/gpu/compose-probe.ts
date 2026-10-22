import { thresholdFromWaterLevel } from '../../src/renderer/render/compose/classify.ts';
import { createCompositor } from '../../src/renderer/render/compose/compositor.ts';
import { fitView, oneToOne, type ViewState } from '../../src/renderer/render/view/viewport.ts';
import { createGlContext } from '../../src/renderer/render/gl/context.ts';
import { createFramebuffer, readTexels } from '../../src/renderer/render/gl/fbo.ts';
import { createTexture2D } from '../../src/renderer/render/gl/texture.ts';
import { uploadRasterLayer } from '../../src/renderer/render/layers/raster-upload.ts';

export const PROBE_MAP_W = 2048;
export const PROBE_MAP_H = 1536;
export const PROBE_VIEW_W = 800;
export const PROBE_VIEW_H = 600;
export const PROBE_FRAMES_PER_VIEW = 120;
export const PROBE_WATER_LEVEL = 0.5;
export const PROBE_ISLAND_X = 1536;
export const PROBE_ISLAND_Y = 512;
export const PROBE_ISLAND_R = 300;
export const PROBE_ISLAND_ALPHA = 210;

export interface ComposeProbeResult {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly frameCount: number;
  readonly samples: readonly (readonly [number, number, number, number])[];
  readonly times: readonly number[];
  readonly rgbaBase64: string;
  readonly width: number;
  readonly height: number;
}

/** Deterministic synthetic height field: horizontal gradient plus a circular island above threshold. */
export function probeMaskAlpha(x: number, y: number): number {
  const dx = x - PROBE_ISLAND_X;
  const dy = y - PROBE_ISLAND_Y;
  if (dx * dx + dy * dy <= PROBE_ISLAND_R * PROBE_ISLAND_R) return PROBE_ISLAND_ALPHA;
  return Math.floor((255 * x) / (PROBE_MAP_W - 1));
}

export function probeGround(x: number, y: number): readonly [number, number, number] {
  return [(x * 7 + y * 13 + 5) & 255, (x * 11 + y * 3 + 67) & 255, (x * 17 + y * 5 + 131) & 255];
}

export function probeWater(x: number, y: number): readonly [number, number, number] {
  return [(x * 9 + y * 23 + 17) & 255, (x * 19 + y * 29 + 53) & 255, (x * 31 + y * 37 + 89) & 255];
}

function buildProbeLayers(): { mask: Uint8Array; ground: Uint8Array; water: Uint8Array } {
  const n = PROBE_MAP_W * PROBE_MAP_H;
  const mask = new Uint8Array(n * 4);
  const ground = new Uint8Array(n * 4);
  const water = new Uint8Array(n * 4);
  for (let y = 0; y < PROBE_MAP_H; y++) {
    for (let x = 0; x < PROBE_MAP_W; x++) {
      const i = (y * PROBE_MAP_W + x) * 4;
      const [gr, gg, gb] = probeGround(x, y);
      const [wr, wg, wb] = probeWater(x, y);
      mask[i] = 0;
      mask[i + 1] = 0;
      mask[i + 2] = 0;
      mask[i + 3] = probeMaskAlpha(x, y);
      ground[i] = gr;
      ground[i + 1] = gg;
      ground[i + 2] = gb;
      ground[i + 3] = 255;
      water[i] = wr;
      water[i + 1] = wg;
      water[i + 2] = wb;
      water[i + 3] = 255;
    }
  }
  return { mask, ground, water };
}

function percentile(sorted: readonly number[], p: number): number {
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const at = Math.min(Math.max(rank, 0), sorted.length - 1);
  return sorted[at];
}

/**
 * Render 120 frames at fit and 120 frames at 1:1 into a viewport-sized
 * target, closing each frame with a one-pixel readback. Returns p50/p95 frame
 * times in milliseconds and three exact samples. Numbers only.
 */
export async function runComposeProbe(): Promise<ComposeProbeResult> {
  const thresholdVerdict = thresholdFromWaterLevel(PROBE_WATER_LEVEL);
  if (thresholdVerdict.ok !== true) throw new Error('probe threshold');
  const threshold = thresholdVerdict.threshold;
  const fit = fitView(PROBE_MAP_W, PROBE_MAP_H, PROBE_VIEW_W, PROBE_VIEW_H);
  if (fit.ok !== true) throw new Error('probe fit');
  const one = oneToOne(PROBE_MAP_W, PROBE_MAP_H, PROBE_VIEW_W, PROBE_VIEW_H);
  if (one.ok !== true) throw new Error('probe 1:1');
  const views: readonly ViewState[] = [fit.view, one.view];
  const layers = buildProbeLayers();

  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;
    const maskUp = await uploadRasterLayer(
      gl,
      { width: PROBE_MAP_W, height: PROBE_MAP_H, format: 'RGBA8', data: layers.mask },
      { label: 'probe-mask' },
    );
    const groundUp = await uploadRasterLayer(
      gl,
      { width: PROBE_MAP_W, height: PROBE_MAP_H, format: 'RGBA8', data: layers.ground },
      { label: 'probe-ground' },
    );
    const waterUp = await uploadRasterLayer(
      gl,
      { width: PROBE_MAP_W, height: PROBE_MAP_H, format: 'RGBA8', data: layers.water },
      { label: 'probe-water' },
    );
    const target = createTexture2D(gl, {
      width: PROBE_VIEW_W,
      height: PROBE_VIEW_H,
      format: 'RGBA8',
      label: 'probe-target',
    });
    const compositor = createCompositor(gl);
    const fb = createFramebuffer(gl, [target]);
    try {
      const times: number[] = [];
      for (const view of views) {
        for (let i = 0; i < PROBE_FRAMES_PER_VIEW; i++) {
          const start = performance.now();
          compositor.draw({
            view,
            threshold,
            mapW: PROBE_MAP_W,
            mapH: PROBE_MAP_H,
            mask: maskUp.texture,
            ground: groundUp.texture,
            water: waterUp.texture,
            target,
          });
          const px = (i * 37) % PROBE_VIEW_W;
          const py = (i * 53) % PROBE_VIEW_H;
          readTexels(gl, fb, 0, px, py, 1, 1);
          times.push(Math.round((performance.now() - start) * 100) / 100);
        }
      }
      // Final fit frame; three exact samples for the harness to check.
      compositor.draw({
        view: views[0],
        threshold,
        mapW: PROBE_MAP_W,
        mapH: PROBE_MAP_H,
        mask: maskUp.texture,
        ground: groundUp.texture,
        water: waterUp.texture,
        target,
      });
      const full = readTexels(gl, fb, 0, 0, 0, PROBE_VIEW_W, PROBE_VIEW_H);
      if (!(full instanceof Uint8Array)) throw new Error('probe readback class');
      const at = (x: number, y: number): readonly [number, number, number, number] => {
        const i = (y * PROBE_VIEW_W + x) * 4;
        return [full[i], full[i + 1], full[i + 2], full[i + 3]];
      };
      const samples = [at(0, 0), at(PROBE_VIEW_W - 1, PROBE_VIEW_H - 1), at(400, 300)];
      const sorted = [...times].sort((a, b) => a - b);
      let binary = '';
      for (let off = 0; off < full.length; off += 8192) {
        binary += String.fromCharCode(...full.subarray(off, off + 8192));
      }
      return {
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        frameCount: times.length,
        samples,
        times,
        rgbaBase64: btoa(binary),
        width: PROBE_VIEW_W,
        height: PROBE_VIEW_H,
      };
    } finally {
      fb.dispose();
      compositor.dispose();
      target.dispose();
      waterUp.texture.dispose();
      groundUp.texture.dispose();
      maskUp.texture.dispose();
    }
  } finally {
    context.dispose();
  }
}

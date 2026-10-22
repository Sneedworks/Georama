// First-light GPU runner (page-side only: bundled by tests/e2e/gl.mjs, never
// under vitest). Draws the extracted window layers through the unchanged
// compositor at 1:1 and checks the readback against a CPU reference.
import { createCompositor } from '../../src/renderer/render/compose/compositor.ts';
import { createGlContext } from '../../src/renderer/render/gl/context.ts';
import { createFramebuffer, readTexels } from '../../src/renderer/render/gl/fbo.ts';
import { createTexture2D } from '../../src/renderer/render/gl/texture.ts';
import { uploadRasterLayer } from '../../src/renderer/render/layers/raster-upload.ts';

export interface FirstLightInput {
  readonly width: number;
  readonly height: number;
  readonly threshold: number;
  readonly mask: string;
  readonly ground: string;
  readonly water: string;
}

export interface FirstLightResult {
  readonly exact: number;
  readonly total: number;
  readonly land: number;
  readonly water: number;
  readonly orientation: 'PASS' | 'FAIL';
  readonly readbackBase64: string;
  readonly ms: number;
}

function decodeLayer(value: unknown, name: string, want: number): Uint8Array {
  if (typeof value !== 'string') {
    throw new Error(`firstlight: ${name} must be base64`);
  }
  const binary = atob(value);
  if (binary.length !== want) {
    throw new Error(`firstlight: ${name} has the wrong size`);
  }
  const out = new Uint8Array(want);
  for (let i = 0; i < want; i++) {
    out[i] = binary.charCodeAt(i) & 255;
  }
  return out;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function assertExtent(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`firstlight: ${name} must be a safe integer >= 1`);
  }
}

async function renderLayers(
  width: number,
  height: number,
  threshold: number,
  mask: Uint8Array,
  ground: Uint8Array,
  water: Uint8Array,
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(4, width);
  canvas.height = Math.max(4, height);
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;
    const maskUp = await uploadRasterLayer(
      gl,
      { width, height, format: 'RGBA8', data: mask },
      { label: 'firstlight-mask' },
    );
    const groundUp = await uploadRasterLayer(
      gl,
      { width, height, format: 'RGBA8', data: ground },
      { label: 'firstlight-ground' },
    );
    const waterUp = await uploadRasterLayer(
      gl,
      { width, height, format: 'RGBA8', data: water },
      { label: 'firstlight-water' },
    );
    const target = createTexture2D(gl, { width, height, format: 'RGBA8', label: 'firstlight-target' });
    const compositor = createCompositor(gl);
    try {
      compositor.draw({
        view: { scale: 1, tx: 0, ty: 0 },
        threshold,
        mapW: width,
        mapH: height,
        mask: maskUp.texture,
        ground: groundUp.texture,
        water: waterUp.texture,
        target,
      });
      const fb = createFramebuffer(gl, [target]);
      try {
        const back = readTexels(gl, fb, 0, 0, 0, width, height);
        if (!(back instanceof Uint8Array)) {
          throw new Error('firstlight: readback must be RGBA8 bytes');
        }
        if (gl.getError() !== gl.NO_ERROR) {
          throw new Error('firstlight: GL error after readback');
        }
        return back;
      } finally {
        fb.dispose();
      }
    } finally {
      compositor.dispose();
      target.dispose();
      maskUp.texture.dispose();
      groundUp.texture.dispose();
      waterUp.texture.dispose();
    }
  } finally {
    context.dispose();
  }
}

/** 2x2 orientation probe: row 0 col 0 is red, row 1 col 1 is green. */
async function probeOrientation(): Promise<'PASS' | 'FAIL'> {
  const mask = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const ground = new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 255, 0, 255, 0, 255, 0, 255,
  ]);
  const water = new Uint8Array([
    0, 0, 255, 255, 0, 0, 255, 255,
    0, 0, 255, 255, 0, 0, 255, 255,
  ]);
  const back = await renderLayers(2, 2, 128, mask, ground, water);
  const topLeftRed = back[0] === 255 && back[1] === 0 && back[2] === 0 && back[3] === 255;
  const bottomRightGreen = back[12] === 0 && back[13] === 255 && back[14] === 0 && back[15] === 255;
  return topLeftRed && bottomRightGreen ? 'PASS' : 'FAIL';
}

export async function runFirstLight(input: FirstLightInput): Promise<FirstLightResult> {
  const started = performance.now();
  assertExtent(input.width, 'width');
  assertExtent(input.height, 'height');
  if (typeof input.threshold !== 'number' || !Number.isInteger(input.threshold) || input.threshold < 0 || input.threshold > 255) {
    throw new Error('firstlight: threshold must be an integer in 0..255');
  }
  const { width, height, threshold } = input;
  const want = width * height * 4;
  const mask = decodeLayer(input.mask, 'mask', want);
  const ground = decodeLayer(input.ground, 'ground', want);
  const water = decodeLayer(input.water, 'water', want);
  const orientation = await probeOrientation();
  const readback = await renderLayers(width, height, threshold, mask, ground, water);
  let exact = 0;
  let land = 0;
  let waterCount = 0;
  const total = width * height;
  for (let t = 0; t < total; t++) {
    const i = t * 4;
    const isLand = mask[i + 3] >= threshold;
    if (isLand) land++;
    else waterCount++;
    const src = isLand ? ground : water;
    if (readback[i] === src[i] && readback[i + 1] === src[i + 1] && readback[i + 2] === src[i + 2] && readback[i + 3] === 255) {
      exact++;
    }
  }
  return { exact, total, land, water: waterCount, orientation, readbackBase64: encodeBase64(readback), ms: performance.now() - started };
}

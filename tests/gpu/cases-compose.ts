import { isLand, thresholdFromWaterLevel } from '../../src/renderer/render/compose/classify.ts';
import { createCompositor } from '../../src/renderer/render/compose/compositor.ts';
import { fitView, oneToOne, zoomAt, type ViewState } from '../../src/renderer/render/view/viewport.ts';
import { createGlContext } from '../../src/renderer/render/gl/context.ts';
import { createFramebuffer, readTexels } from '../../src/renderer/render/gl/fbo.ts';
import { createTexture2D } from '../../src/renderer/render/gl/texture.ts';
import { uploadRasterLayer } from '../../src/renderer/render/layers/raster-upload.ts';
import { assertEqual, assertThrowsGl, assertTrue, freshCanvas, type GpuCase } from './index.ts';

interface ComposeScene {
  readonly mapW: number;
  readonly mapH: number;
  readonly viewW: number;
  readonly viewH: number;
  readonly view: ViewState;
  readonly threshold: number;
  readonly mask: Uint8Array;
  readonly ground: Uint8Array;
  readonly water: Uint8Array;
}

function maskAlpha(x: number, y: number): number {
  return (x * 37 + y * 91 + 17) & 255;
}

function groundPixel(x: number, y: number): readonly [number, number, number] {
  return [(x * 23 + y * 57 + 5) & 255, (x * 11 + y * 3 + 67) & 255, (x * 17 + y * 5 + 131) & 255];
}

function waterPixel(x: number, y: number): readonly [number, number, number] {
  return [(x * 9 + y * 23 + 17) & 255, (x * 19 + y * 29 + 53) & 255, (x * 31 + y * 37 + 89) & 255];
}

function buildMask(mapW: number, mapH: number): Uint8Array {
  const data = new Uint8Array(mapW * mapH * 4);
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const i = (y * mapW + x) * 4;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = maskAlpha(x, y);
    }
  }
  return data;
}

function buildRgb(
  mapW: number,
  mapH: number,
  at: (x: number, y: number) => readonly [number, number, number],
): Uint8Array {
  const data = new Uint8Array(mapW * mapH * 4);
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const [r, g, b] = at(x, y);
      const i = (y * mapW + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

/**
 * CPU reference of the rendering rule: land takes the ground RGB, water takes
 * the water_tint RGB, alpha is 255, off-map pixels are (0, 0, 0, 0). The map
 * texel is floor((x + 0.5 - tx) / scale), nearest, no filtering. A pixel is
 * land iff isLand(A, T).land, where A is the mask alpha; mask RGB is never read.
 */
function cpuPixel(
  x: number,
  y: number,
  scene: ComposeScene,
): readonly [number, number, number, number] {
  const mu = Math.floor((x + 0.5 - scene.view.tx) / scene.view.scale);
  const mv = Math.floor((y + 0.5 - scene.view.ty) / scene.view.scale);
  if (mu < 0 || mv < 0 || mu >= scene.mapW || mv >= scene.mapH) return [0, 0, 0, 0];
  const i = (mv * scene.mapW + mu) * 4;
  const verdict = isLand(scene.mask[i + 3], scene.threshold);
  if (verdict.ok !== true) throw new Error('cpu reference: isLand must be ok');
  const src = verdict.land ? scene.ground : scene.water;
  return [src[i], src[i + 1], src[i + 2], 255];
}

async function renderScene(scene: ComposeScene): Promise<Uint8Array> {
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;
    const maskUp = await uploadRasterLayer(
      gl,
      { width: scene.mapW, height: scene.mapH, format: 'RGBA8', data: scene.mask },
      { label: 'compose-mask' },
    );
    const groundUp = await uploadRasterLayer(
      gl,
      { width: scene.mapW, height: scene.mapH, format: 'RGBA8', data: scene.ground },
      { label: 'compose-ground' },
    );
    const waterUp = await uploadRasterLayer(
      gl,
      { width: scene.mapW, height: scene.mapH, format: 'RGBA8', data: scene.water },
      { label: 'compose-water' },
    );
    const target = createTexture2D(gl, {
      width: scene.viewW,
      height: scene.viewH,
      format: 'RGBA8',
      label: 'compose-target',
    });
    const compositor = createCompositor(gl);
    try {
      compositor.draw({
        view: scene.view,
        threshold: scene.threshold,
        mapW: scene.mapW,
        mapH: scene.mapH,
        mask: maskUp.texture,
        ground: groundUp.texture,
        water: waterUp.texture,
        target,
      });
      const fb = createFramebuffer(gl, [target]);
      try {
        const back = readTexels(gl, fb, 0, 0, 0, scene.viewW, scene.viewH);
        if (!(back instanceof Uint8Array)) throw new Error('compose readback class');
        assertEqual(gl.getError(), gl.NO_ERROR, 'compose clean end');
        return back;
      } finally {
        fb.dispose();
      }
    } finally {
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

function assertSceneExact(back: Uint8Array, scene: ComposeScene, what: string): void {
  assertEqual(back.length, scene.viewW * scene.viewH * 4, `${what} size`);
  for (let y = 0; y < scene.viewH; y++) {
    for (let x = 0; x < scene.viewW; x++) {
      const want = cpuPixel(x, y, scene);
      for (let c = 0; c < 4; c++) {
        const got = back[(y * scene.viewW + x) * 4 + c];
        if (got !== want[c]) {
          throw new Error(`${what} pixel (${x},${y})[${c}]: expected ${want[c]}, got ${got}`);
        }
      }
    }
  }
}

function threshold128(): number {
  const verdict = thresholdFromWaterLevel(0.5);
  if (verdict.ok !== true) throw new Error('threshold precondition');
  assertEqual(verdict.threshold, 128, 'T from water level 0.5');
  return verdict.threshold;
}

function patternScene(mapW: number, mapH: number, viewW: number, viewH: number, view: ViewState): ComposeScene {
  return {
    mapW,
    mapH,
    viewW,
    viewH,
    view,
    threshold: threshold128(),
    mask: buildMask(mapW, mapH),
    ground: buildRgb(mapW, mapH, groundPixel),
    water: buildRgb(mapW, mapH, waterPixel),
  };
}

async function composeFitExact(): Promise<void> {
  const fit = fitView(4, 3, 8, 6);
  if (fit.ok !== true) throw new Error('fit precondition');
  assertEqual(fit.view.scale, 2, 'fit scale');
  assertEqual(fit.view.tx, 0, 'fit tx');
  assertEqual(fit.view.ty, 0, 'fit ty');
  const scene = patternScene(4, 3, 8, 6, fit.view);
  const back = await renderScene(scene);
  assertSceneExact(back, scene, 'compose fit');
}

async function composeThresholdBoundary(): Promise<void> {
  const one = oneToOne(2, 1, 2, 1);
  if (one.ok !== true) throw new Error('1:1 precondition');
  const threshold = threshold128();
  const mask = new Uint8Array([0, 0, 0, threshold - 1, 0, 0, 0, threshold]);
  const ground = buildRgb(2, 1, () => [10, 20, 30]);
  const water = buildRgb(2, 1, () => [200, 210, 220]);
  const scene: ComposeScene = { mapW: 2, mapH: 1, viewW: 2, viewH: 1, view: one.view, threshold, mask, ground, water };
  const back = await renderScene(scene);
  assertSceneExact(back, scene, 'compose threshold boundary');
  assertEqual(back[0], 200, 'A = T-1 red is water tint');
  assertEqual(back[1], 210, 'A = T-1 green is water tint');
  assertEqual(back[2], 220, 'A = T-1 blue is water tint');
  assertEqual(back[4], 10, 'A = T red is ground');
  assertEqual(back[5], 20, 'A = T green is ground');
  assertEqual(back[6], 30, 'A = T blue is ground');
}

async function composeOneToOneWindow(): Promise<void> {
  const one = oneToOne(8, 6, 4, 3);
  if (one.ok !== true) throw new Error('1:1 precondition');
  assertEqual(one.view.scale, 1, 'window scale');
  assertEqual(one.view.tx, -2, 'window tx');
  assertEqual(one.view.ty, -1.5, 'window ty');
  const scene = patternScene(8, 6, 4, 3, one.view);
  const back = await renderScene(scene);
  assertSceneExact(back, scene, 'compose 1:1 window');
}

async function composeZoomExact(): Promise<void> {
  const one = oneToOne(8, 6, 8, 6);
  if (one.ok !== true) throw new Error('1:1 precondition');
  const zoomed = zoomAt(one.view, 2, 4, 3);
  if (zoomed.ok !== true) throw new Error('zoom precondition');
  assertEqual(zoomed.view.scale, 2, 'zoom scale');
  assertEqual(zoomed.view.tx, -4, 'zoom tx');
  assertEqual(zoomed.view.ty, -3, 'zoom ty');
  const scene = patternScene(8, 6, 8, 6, zoomed.view);
  const back = await renderScene(scene);
  assertSceneExact(back, scene, 'compose zoom');
}

async function composeOffMapTransparent(): Promise<void> {
  const one = oneToOne(4, 3, 8, 6);
  if (one.ok !== true) throw new Error('1:1 precondition');
  const scene = patternScene(4, 3, 8, 6, one.view);
  const back = await renderScene(scene);
  assertSceneExact(back, scene, 'compose off-map');
  let transparent = 0;
  for (let y = 0; y < scene.viewH; y++) {
    for (let x = 0; x < scene.viewW; x++) {
      const i = (y * scene.viewW + x) * 4;
      if (back[i] === 0 && back[i + 1] === 0 && back[i + 2] === 0 && back[i + 3] === 0) transparent += 1;
    }
  }
  assertTrue(transparent > 0, 'off-map pixels exist');
  assertEqual(transparent, 36, 'off-map pixel count');
}

function composeInvalidThrows(): void {
  assertThrowsGl('CONTEXT', () => createCompositor(null as unknown as WebGL2RenderingContext), 'null gl');
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;
    const one = new Uint8Array([9, 9, 9, 9]);
    const layer = createTexture2D(gl, { width: 1, height: 1, format: 'RGBA8', data: one, label: 'compose-one' });
    try {
      const target = createTexture2D(gl, { width: 1, height: 1, format: 'RGBA8', label: 'compose-one-target' });
      try {
        const compositor = createCompositor(gl);
        try {
          const goodView: ViewState = { scale: 1, tx: 0, ty: 0 };
          const base = {
            view: goodView,
            threshold: 128,
            mapW: 1,
            mapH: 1,
            mask: layer,
            ground: layer,
            water: layer,
            target,
          };
          assertThrowsGl('UPLOAD', () => compositor.draw({ ...base, threshold: 256 }), 'threshold 256');
          assertThrowsGl('UPLOAD', () => compositor.draw({ ...base, view: { scale: 0, tx: 0, ty: 0 } }), 'scale 0');
        } finally {
          compositor.dispose();
        }
      } finally {
        target.dispose();
      }
    } finally {
      layer.dispose();
    }
    assertEqual(gl.getError(), gl.NO_ERROR, 'invalid case clean end');
  } finally {
    context.dispose();
  }
}

export const composeCases: readonly GpuCase[] = [
  { name: 'compose: fit 4x3 into 8x6 exact', run: composeFitExact },
  { name: 'compose: threshold boundary T-1 water, T land', run: composeThresholdBoundary },
  { name: 'compose: 1:1 window with offset exact', run: composeOneToOneWindow },
  { name: 'compose: zoomAt keeps exact correspondence', run: composeZoomExact },
  { name: 'compose: off-map pixels transparent', run: composeOffMapTransparent },
  { name: 'compose: invalid input throws GlError', run: composeInvalidThrows },
];

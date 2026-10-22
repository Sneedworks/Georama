import { checkGl, GlError } from '../gl/errors.ts';
import { createFramebuffer } from '../gl/fbo.ts';
import { createProgram, type GlProgram } from '../gl/shader.ts';
import type { GlTexture } from '../gl/texture.ts';
import type { ViewState } from '../view/viewport.ts';
import { COMPOSE_FRAGMENT, COMPOSE_VERTEX } from './shaders.ts';

export interface ComposeDraw {
  readonly view: ViewState;
  readonly threshold: number;
  readonly mapW: number;
  readonly mapH: number;
  readonly mask: GlTexture;
  readonly ground: GlTexture;
  readonly water: GlTexture;
  readonly target: GlTexture;
}

export interface Compositor {
  draw(inputs: ComposeDraw): void;
  dispose(): void;
}

function isSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function assertLayer(name: string, tex: unknown, mapW: number, mapH: number): asserts tex is GlTexture {
  if (typeof tex !== 'object' || tex === null) {
    throw new GlError('UPLOAD', `compositor: ${name} must be a GlTexture`);
  }
  const layer = tex as GlTexture;
  if (layer.width !== mapW || layer.height !== mapH) {
    throw new GlError(
      'UPLOAD',
      `compositor: ${name} is ${String(layer.width)}x${String(layer.height)}, expected ${mapW}x${mapH}`,
    );
  }
  if (!(layer.texture instanceof WebGLTexture)) {
    throw new GlError('UPLOAD', `compositor: ${name} texture is not alive`);
  }
}

function assertDraw(inputs: unknown): asserts inputs is ComposeDraw {
  if (typeof inputs !== 'object' || inputs === null) {
    throw new GlError('UPLOAD', 'compositor: inputs must be an object');
  }
  const draw = inputs as ComposeDraw;
  const view = draw.view;
  if (typeof view !== 'object' || view === null) {
    throw new GlError('UPLOAD', 'compositor: view must be an object');
  }
  if (!Number.isFinite(view.scale) || view.scale <= 0) {
    throw new GlError('UPLOAD', 'compositor: view.scale must be finite and > 0');
  }
  if (!Number.isFinite(view.tx) || !Number.isFinite(view.ty)) {
    throw new GlError('UPLOAD', 'compositor: view.tx and view.ty must be finite');
  }
  if (!isSafeInt(draw.threshold) || draw.threshold < 0 || draw.threshold > 255) {
    throw new GlError('UPLOAD', 'compositor: threshold must be an int in 0..255');
  }
  if (!isSafeInt(draw.mapW) || draw.mapW < 1 || !isSafeInt(draw.mapH) || draw.mapH < 1) {
    throw new GlError('UPLOAD', 'compositor: mapW and mapH must be safe ints >= 1');
  }
  assertLayer('mask', draw.mask, draw.mapW, draw.mapH);
  assertLayer('ground', draw.ground, draw.mapW, draw.mapH);
  assertLayer('water', draw.water, draw.mapW, draw.mapH);
  const target = draw.target;
  if (typeof target !== 'object' || target === null) {
    throw new GlError('UPLOAD', 'compositor: target must be a GlTexture');
  }
  if (!isSafeInt(target.width) || target.width < 1 || !isSafeInt(target.height) || target.height < 1) {
    throw new GlError('UPLOAD', 'compositor: target must have dims >= 1');
  }
  if (!(target.texture instanceof WebGLTexture)) {
    throw new GlError('UPLOAD', 'compositor: target texture is not alive');
  }
}

export function createCompositor(gl: WebGL2RenderingContext): Compositor {
  if (typeof gl !== 'object' || gl === null) {
    throw new GlError('CONTEXT', 'createCompositor: gl must be a WebGL2RenderingContext');
  }
  const program: GlProgram = createProgram(gl, {
    label: 'viewport-compositor',
    vertex: COMPOSE_VERTEX,
    fragment: COMPOSE_FRAGMENT,
    uniforms: ['u_mask', 'u_ground', 'u_water', 'u_threshold', 'u_scale', 'u_tx', 'u_ty', 'u_mapW', 'u_mapH'],
  });
  let disposed = false;
  return {
    draw: (inputs: ComposeDraw): void => {
      if (disposed) throw new GlError('GL', 'compositor: draw after dispose');
      assertDraw(inputs);
      program.use();
      gl.uniform1i(program.uniforms['u_mask'], 0);
      gl.uniform1i(program.uniforms['u_ground'], 1);
      gl.uniform1i(program.uniforms['u_water'], 2);
      gl.uniform1i(program.uniforms['u_threshold'], inputs.threshold);
      gl.uniform1f(program.uniforms['u_scale'], inputs.view.scale);
      gl.uniform1f(program.uniforms['u_tx'], inputs.view.tx);
      gl.uniform1f(program.uniforms['u_ty'], inputs.view.ty);
      gl.uniform1i(program.uniforms['u_mapW'], inputs.mapW);
      gl.uniform1i(program.uniforms['u_mapH'], inputs.mapH);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inputs.mask.texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, inputs.ground.texture);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, inputs.water.texture);
      gl.disable(gl.BLEND);
      const fb = createFramebuffer(gl, [inputs.target]);
      try {
        fb.bind();
        gl.viewport(0, 0, inputs.target.width, inputs.target.height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      } finally {
        fb.dispose();
      }
      checkGl(gl, 'compositor: draw');
    },
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      program.dispose();
    },
  };
}

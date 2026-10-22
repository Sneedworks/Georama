import { validateClassGrid, type ClassGrid } from '../../../core/sdf/jfa.ts';
import { type GlBudget } from '../gl/budget.ts';
import { checkGl, GlError } from '../gl/errors.ts';
import { createFramebuffer, readTexels } from '../gl/fbo.ts';
import { createProgram } from '../gl/shader.ts';
import { createTexture2D } from '../gl/texture.ts';
import { COMPOSE_VERTEX } from '../compose/shaders.ts';

export interface JfaGpuOptions {
  readonly budget: GlBudget;
  readonly maxTextureSize?: number;
}

// Section-3 outline rule: texel p is coast (255) when some 4-neighbour q
// inside the grid has land[q] != land[p]. Neighbours outside the grid are
// ignored, so the grid border is not a coast.
const JFA_OUTLINE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_land;
uniform int u_width;
uniform int u_height;
out vec4 o_out;
// The texture holds 0 or 255 (see int(... * 255.0 + 0.5)); compare with q != v, never 1 - v.
int landAt(ivec2 c) {
  if (c.x < 0 || c.y < 0 || c.x >= u_width || c.y >= u_height) return -1;
  return int(texelFetch(u_land, c, 0).r * 255.0 + 0.5);
}
void main() {
  ivec2 p = ivec2(int(gl_FragCoord.x), int(gl_FragCoord.y));
  int v = landAt(p);
  int coast = 0;
  int q = landAt(p + ivec2(-1, 0));
  if (q >= 0 && q != v) coast = 1;
  q = landAt(p + ivec2(1, 0));
  if (q >= 0 && q != v) coast = 1;
  q = landAt(p + ivec2(0, -1));
  if (q >= 0 && q != v) coast = 1;
  q = landAt(p + ivec2(0, 1));
  if (q >= 0 && q != v) coast = 1;
  o_out = vec4(coast == 1 ? 1.0 : 0.0, 0.0, 0.0, 1.0);
}
`;

// Section-3 init rule: S0(p) = p for coast texels, NONE otherwise.
const JFA_INIT_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_outline;
out uvec2 o_seed;
void main() {
  ivec2 p = ivec2(int(gl_FragCoord.x), int(gl_FragCoord.y));
  int coast = int(texelFetch(u_outline, p, 0).r * 255.0 + 0.5);
  o_seed = coast == 255 ? uvec2(uint(p.x), uint(p.y)) : uvec2(65535u, 65535u);
}
`;

// Section-3 pass rule: S' reads only S. The candidate set is S(p) plus the
// eight S(q) neighbours at offsets in {-s, 0, s}; NONE candidates are
// skipped, so no sentinel distance is ever formed. The winner minimises the
// key (dsq, cy, cx) lexicographically. Integer math only.
const JFA_PASS_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D u_seeds;
uniform int u_step;
uniform int u_width;
uniform int u_height;
out uvec2 o_seed;
uvec2 seedAt(ivec2 c) {
  if (c.x < 0 || c.y < 0 || c.x >= u_width || c.y >= u_height) return uvec2(65535u, 65535u);
  return texelFetch(u_seeds, c, 0).rg;
}
void consider(uvec2 c, ivec2 p, inout int bestDsq, inout int bestCy, inout int bestCx, inout bool found) {
  if (c.x == 65535u) return;
  int cx = int(c.x);
  int cy = int(c.y);
  int dsq = (cx - p.x) * (cx - p.x) + (cy - p.y) * (cy - p.y);
  if (!found || dsq < bestDsq || (dsq == bestDsq && (cy < bestCy || (cy == bestCy && cx < bestCx)))) {
    bestDsq = dsq;
    bestCy = cy;
    bestCx = cx;
    found = true;
  }
}
void main() {
  ivec2 p = ivec2(int(gl_FragCoord.x), int(gl_FragCoord.y));
  int bestDsq = 0;
  int bestCy = 0;
  int bestCx = 0;
  bool found = false;
  consider(texelFetch(u_seeds, p, 0).rg, p, bestDsq, bestCy, bestCx, found);
  for (int dy = -u_step; dy <= u_step; dy += u_step) {
    for (int dx = -u_step; dx <= u_step; dx += u_step) {
      if (dx == 0 && dy == 0) continue;
      consider(seedAt(p + ivec2(dx, dy)), p, bestDsq, bestCy, bestCx, found);
    }
  }
  o_seed = found ? uvec2(uint(bestCx), uint(bestCy)) : uvec2(65535u, 65535u);
}
`;

export function jumpFloodGpu(
  gl: WebGL2RenderingContext,
  grid: ClassGrid,
  options: JfaGpuOptions,
): { readonly seeds: Uint16Array; readonly outline: Uint8Array } {
  if (typeof gl !== 'object' || gl === null) {
    throw new GlError('CONTEXT', 'jumpFloodGpu: gl must be a WebGL2RenderingContext');
  }
  if (typeof options !== 'object' || options === null) {
    throw new GlError('UPLOAD', 'jumpFloodGpu: options must be an object');
  }
  const check = validateClassGrid(grid);
  if (!check.ok) {
    if (check.code === 'INPUT') throw new GlError('UPLOAD', check.message);
    throw new GlError('LIMIT', check.message);
  }
  const width = grid.width;
  const height = grid.height;
  const side = width > height ? width : height;
  const textureLimit = options.maxTextureSize ?? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
  if (!Number.isSafeInteger(textureLimit) || side > textureLimit) {
    throw new GlError('LIMIT', `jumpFloodGpu: side ${side} exceeds maxTextureSize ${String(textureLimit)}`);
  }
  const budget = options.budget;

  // Snapshot the GL state this function touches so the finally block below
  // can leave the context exactly as found.
  const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
  gl.activeTexture(gl.TEXTURE0);
  const prevTex0 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  gl.activeTexture(prevActive);
  const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
  const prevDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const prevRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
  const prevViewport: readonly [number, number, number, number] = [viewport[0], viewport[1], viewport[2], viewport[3]];
  const prevBlend = gl.getParameter(gl.BLEND) as boolean;
  const prevDither = gl.getParameter(gl.DITHER) as boolean;

  let passes = 0;
  let cover = 1;
  while (cover < side) {
    passes += 1;
    cover *= 2;
  }

  const owned: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(item: T): T => {
    owned.push(item);
    return item;
  };

  const bindUnit0 = (texture: WebGLTexture): void => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  };

  try {
    const landBytes = new Uint8Array(width * height);
    for (let i = 0; i < landBytes.length; i++) {
      landBytes[i] = grid.land[i] === 1 ? 255 : 0;
    }
    const landTex = track(createTexture2D(gl, { width, height, format: 'R8', data: landBytes, label: 'jfa-land' }, budget));
    const outlineTex = track(createTexture2D(gl, { width, height, format: 'R8', label: 'jfa-outline' }, budget));
    const outlineFb = track(createFramebuffer(gl, [outlineTex]));
    const outlineProg = track(createProgram(gl, {
      label: 'jfa-outline',
      vertex: COMPOSE_VERTEX,
      fragment: JFA_OUTLINE_FRAGMENT,
      uniforms: ['u_land', 'u_width', 'u_height'],
    }));
    gl.disable(gl.BLEND);
    gl.disable(gl.DITHER);
    outlineProg.use();
    gl.uniform1i(outlineProg.uniforms['u_land'], 0);
    gl.uniform1i(outlineProg.uniforms['u_width'], width);
    gl.uniform1i(outlineProg.uniforms['u_height'], height);
    bindUnit0(landTex.texture);
    outlineFb.bind();
    gl.viewport(0, 0, width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    checkGl(gl, 'jfa-gpu: outline');

    const seedA = track(createTexture2D(gl, { width, height, format: 'RG16UI', label: 'jfa-seeds-a' }, budget));
    const seedFbA = track(createFramebuffer(gl, [seedA]));
    const initProg = track(createProgram(gl, {
      label: 'jfa-init',
      vertex: COMPOSE_VERTEX,
      fragment: JFA_INIT_FRAGMENT,
      uniforms: ['u_outline'],
    }));
    initProg.use();
    gl.uniform1i(initProg.uniforms['u_outline'], 0);
    bindUnit0(outlineTex.texture);
    seedFbA.bind();
    gl.viewport(0, 0, width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    checkGl(gl, 'jfa-gpu: init');

    let readTex = seedA;
    let readFb = seedFbA;
    if (passes > 0) {
      const seedB = track(createTexture2D(gl, { width, height, format: 'RG16UI', label: 'jfa-seeds-b' }, budget));
      const seedFbB = track(createFramebuffer(gl, [seedB]));
      const passProg = track(createProgram(gl, {
        label: 'jfa-pass',
        vertex: COMPOSE_VERTEX,
        fragment: JFA_PASS_FRAGMENT,
        uniforms: ['u_seeds', 'u_step', 'u_width', 'u_height'],
      }));
      let writeTex = seedB;
      let writeFb = seedFbB;
      for (let k = passes - 1; k >= 0; k--) {
        passProg.use();
        gl.uniform1i(passProg.uniforms['u_seeds'], 0);
        gl.uniform1i(passProg.uniforms['u_step'], 2 ** k);
        gl.uniform1i(passProg.uniforms['u_width'], width);
        gl.uniform1i(passProg.uniforms['u_height'], height);
        bindUnit0(readTex.texture);
        writeFb.bind();
        gl.viewport(0, 0, width, height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        checkGl(gl, 'jfa-gpu: pass');
        const swapTex = readTex;
        readTex = writeTex;
        writeTex = swapTex;
        const swapFb = readFb;
        readFb = writeFb;
        writeFb = swapFb;
      }
    }

    const outlineBack = readTexels(gl, outlineFb, 0, 0, 0, width, height);
    if (!(outlineBack instanceof Uint8Array)) {
      throw new GlError('GL', 'jfa-gpu: outline readback is not Uint8Array');
    }
    const seedBack = readTexels(gl, readFb, 0, 0, 0, width, height);
    if (!(seedBack instanceof Uint32Array)) {
      throw new GlError('GL', 'jfa-gpu: seed readback is not Uint32Array');
    }
    const outline = new Uint8Array(width * height);
    for (let i = 0; i < outline.length; i++) {
      outline[i] = outlineBack[4 * i];
    }
    const seeds = new Uint16Array(2 * width * height);
    for (let i = 0; i < width * height; i++) {
      seeds[2 * i] = seedBack[4 * i];
      seeds[2 * i + 1] = seedBack[4 * i + 1];
    }
    return { seeds, outline };
  } finally {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    for (let i = owned.length - 1; i >= 0; i--) {
      owned[i].dispose();
    }
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevDraw);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevRead);
    gl.useProgram(prevProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prevTex0);
    gl.activeTexture(prevActive);
    gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
    if (prevBlend) gl.enable(gl.BLEND);
    else gl.disable(gl.BLEND);
    if (prevDither) gl.enable(gl.DITHER);
    else gl.disable(gl.DITHER);
  }
}

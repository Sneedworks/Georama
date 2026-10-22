import { createGlContext } from '../../src/renderer/render/gl/context.ts';
import { createFramebuffer, readTexels } from '../../src/renderer/render/gl/fbo.ts';
import { createProgram } from '../../src/renderer/render/gl/shader.ts';
import { createTexture2D, type GlTexture } from '../../src/renderer/render/gl/texture.ts';
import { assertEqual, assertTrue, freshCanvas, type GpuCase } from './index.ts';

const RW = 64;
const RH = 48;

const FULLSCREEN_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

function drawFullscreen(gl: WebGL2RenderingContext, target: GlTexture, fragment: string): void {
  const program = createProgram(gl, { label: 'readback-pass', vertex: FULLSCREEN_VERTEX, fragment });
  const fb = createFramebuffer(gl, [target]);
  try {
    fb.bind();
    gl.viewport(0, 0, target.width, target.height);
    program.use();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) throw new Error(`draw failed with GL error ${err}`);
  } finally {
    fb.dispose();
    program.dispose();
  }
}

/** CPU mirror of the RGBA8 pattern shader below. */
function rgb8Pattern(x: number, y: number): [number, number, number] {
  return [
    (x * 4 + y * 3) & 255,
    (x * 7 + y * 5 + 11) & 255,
    (x * 3 + y * 9 + 101) & 255,
  ];
}

const RGB8_FRAGMENT = `#version 300 es
precision highp float;
out vec4 o_out;
void main() {
  int n0 = (int(gl_FragCoord.x) * 4 + int(gl_FragCoord.y) * 3) & 255;
  int n1 = (int(gl_FragCoord.x) * 7 + int(gl_FragCoord.y) * 5 + 11) & 255;
  int n2 = (int(gl_FragCoord.x) * 3 + int(gl_FragCoord.y) * 9 + 101) & 255;
  o_out = vec4(float(n0) / 255.0, float(n1) / 255.0, float(n2) / 255.0, 1.0);
}
`;

/** CPU mirror of the float pattern shader: offsets are multiples of 0.25. */
function floatPattern(x: number, y: number, offset: number): number {
  return x * 0.25 + y + offset;
}

const FLOAT_FRAGMENT = (o0: number, o1: number, o2: number): string => `#version 300 es
precision highp float;
out vec4 o_out;
void main() {
  float fx = float(int(gl_FragCoord.x));
  float fy = float(int(gl_FragCoord.y));
  o_out = vec4(fx * 0.25 + fy + ${o0.toFixed(2)}, fx * 0.25 + fy + ${o1.toFixed(2)}, fx * 0.25 + fy + ${o2.toFixed(2)}, 1.0);
}
`;

function assertReadbackExact(
  actual: Uint8Array | Float32Array | Uint32Array,
  width: number,
  height: number,
  expectedAt: (x: number, y: number) => readonly [number, number, number, number],
  what: string,
): void {
  assertEqual(actual.length, width * height * 4, `${what} size`);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const want = expectedAt(x, y);
      for (let c = 0; c < 4; c++) {
        const got = actual[(y * width + x) * 4 + c];
        if (got !== want[c]) {
          throw new Error(`${what} texel (${x},${y})[${c}]: expected ${want[c]}, got ${got}`);
        }
      }
    }
  }
}

async function readbackEndToEnd(): Promise<void> {
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;

    // Pass 1: RGBA8 with an integer pattern.
    {
      const target = createTexture2D(gl, { width: RW, height: RH, format: 'RGBA8' });
      try {
        drawFullscreen(gl, target, RGB8_FRAGMENT);
        const fb = createFramebuffer(gl, [target]);
        try {
          const back = readTexels(gl, fb, 0, 0, 0, RW, RH);
          assertTrue(back instanceof Uint8Array, 'RGBA8 readback class');
          assertReadbackExact(back, RW, RH, (x, y) => {
            const [r, g, b] = rgb8Pattern(x, y);
            return [r, g, b, 255];
          }, 'RGBA8 pass');
        } finally {
          fb.dispose();
        }
      } finally {
        target.dispose();
      }
    }

    // Pass 2: R32F with an exact float pattern (multiples of 0.25 below 64).
    {
      const target = createTexture2D(gl, { width: RW, height: RH, format: 'R32F' });
      try {
        drawFullscreen(gl, target, FLOAT_FRAGMENT(0, 0, 0));
        const fb = createFramebuffer(gl, [target]);
        try {
          const back = readTexels(gl, fb, 0, 0, 0, RW, RH);
          assertTrue(back instanceof Float32Array, 'R32F readback class');
          assertReadbackExact(back, RW, RH, (x, y) => [floatPattern(x, y, 0), 0, 0, 1], 'R32F pass');
        } finally {
          fb.dispose();
        }
      } finally {
        target.dispose();
      }
    }

    // Pass 3: RGBA16F with per-channel offsets (half-exact values).
    {
      const target = createTexture2D(gl, { width: RW, height: RH, format: 'RGBA16F' });
      try {
        drawFullscreen(gl, target, FLOAT_FRAGMENT(0, 4.25, 8.5));
        const fb = createFramebuffer(gl, [target]);
        try {
          const back = readTexels(gl, fb, 0, 0, 0, RW, RH);
          assertTrue(back instanceof Float32Array, 'RGBA16F readback class');
          assertReadbackExact(
            back,
            RW,
            RH,
            (x, y) => [floatPattern(x, y, 0), floatPattern(x, y, 4.25), floatPattern(x, y, 8.5), 1],
            'RGBA16F pass',
          );
        } finally {
          fb.dispose();
        }
      } finally {
        target.dispose();
      }
    }

    // Pass 4: two-attachment MRT with two different patterns.
    {
      const t0 = createTexture2D(gl, { width: RW, height: RH, format: 'RGBA8' });
      const t1 = createTexture2D(gl, { width: RW, height: RH, format: 'RGBA8' });
      const mrtFragment = `#version 300 es
precision highp float;
layout(location = 0) out vec4 o_a;
layout(location = 1) out vec4 o_b;
void main() {
  int ax = (int(gl_FragCoord.x) * 4 + int(gl_FragCoord.y) * 3) & 255;
  int bx = (int(gl_FragCoord.x) * 11 + int(gl_FragCoord.y) * 13 + 77) & 255;
  o_a = vec4(float(ax) / 255.0, 0.0, 1.0, 1.0);
  o_b = vec4(0.0, float(bx) / 255.0, float(bx) / 255.0, 1.0);
}
`;
      const program = createProgram(gl, { label: 'readback-mrt', vertex: FULLSCREEN_VERTEX, fragment: mrtFragment });
      const fb = createFramebuffer(gl, [t0, t1]);
      try {
        fb.bind();
        gl.viewport(0, 0, RW, RH);
        program.use();
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        assertEqual(gl.getError(), gl.NO_ERROR, 'MRT draw');
        const back0 = readTexels(gl, fb, 0, 0, 0, RW, RH);
        const back1 = readTexels(gl, fb, 1, 0, 0, RW, RH);
        assertReadbackExact(back0, RW, RH, (x, y) => [(x * 4 + y * 3) & 255, 0, 255, 255], 'MRT attachment 0');
        assertReadbackExact(back1, RW, RH, (x, y) => { const v = (x * 11 + y * 13 + 77) & 255; return [0, v, v, 255]; }, 'MRT attachment 1');
      } finally {
        fb.dispose();
        program.dispose();
      }
      t0.dispose();
      t1.dispose();
    }

    assertEqual(gl.getError(), gl.NO_ERROR, 'readback case clean end');
  } finally {
    context.dispose();
  }
}

export const readbackCases: readonly GpuCase[] = [
  { name: 'readback: end-to-end render', run: readbackEndToEnd },
];

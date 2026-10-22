import type { FormatName } from '../../src/renderer/render/gl/caps.ts';
import { createGlContext } from '../../src/renderer/render/gl/context.ts';
import { createFramebuffer, readTexels } from '../../src/renderer/render/gl/fbo.ts';
import { createTexture2D, uploadRegion, type GlTexture } from '../../src/renderer/render/gl/texture.ts';
import { assertEqual, assertThrowsGl, assertTrue, freshCanvas, type GpuCase } from './index.ts';

const W = 5;
const H = 3;

const FLOAT_VALUES = [0.5, 0.25, -2, 1024, -0.5, 2.25, 100, -1024];
const UINT16_VALUES = [0, 1, 255, 256, 1000, 32768, 65535, 12345];

function channelsOf(name: FormatName): number {
  switch (name) {
    case 'RGBA8': return 4;
    case 'R8': return 1;
    case 'R16F': return 1;
    case 'RG16F': return 2;
    case 'RGBA16F': return 4;
    case 'R32F': return 1;
    case 'RG16UI': return 2;
    case 'RGBA8UI': return 4;
    default: throw new Error(`unknown format ${(name as string) ?? '?'}}`);
  }
}

function uploadData(name: FormatName): ArrayBufferView {
  const n = W * H;
  const channels = channelsOf(name);
  if (name === 'RG16UI') {
    const data = new Uint16Array(n * channels);
    for (let i = 0; i < data.length; i++) data[i] = UINT16_VALUES[i % UINT16_VALUES.length];
    return data;
  }
  if (name === 'R16F' || name === 'RG16F' || name === 'RGBA16F' || name === 'R32F') {
    const data = new Float32Array(n * channels);
    for (let i = 0; i < data.length; i++) data[i] = FLOAT_VALUES[i % FLOAT_VALUES.length];
    return data;
  }
  const data = new Uint8Array(n * channels);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7 + 13) & 255;
  return data;
}

/** Expected RGBA readback (4 elements per texel) for the exact upload above. */
function expectedReadback(name: FormatName): number[] {
  const upload = uploadData(name) as Uint8Array | Float32Array | Uint16Array;
  const channels = channelsOf(name);
  const out: number[] = [];
  for (let t = 0; t < W * H; t++) {
    const r = upload[t * channels];
    if (name === 'RGBA8' || name === 'RGBA8UI' || name === 'RGBA16F') {
      out.push(upload[t * channels], upload[t * channels + 1], upload[t * channels + 2], upload[t * channels + 3]);
    } else if (name === 'RG16F' || name === 'RG16UI') {
      out.push(r, upload[t * channels + 1], 0, 1);
    } else if (name === 'R8') {
      out.push(r, 0, 0, 255);
    } else {
      out.push(r, 0, 0, 1);
    }
  }
  return out;
}

function assertExactReadback(name: FormatName, actual: Uint8Array | Float32Array | Uint32Array): void {
  const expected = expectedReadback(name);
  assertEqual(actual.length, expected.length, `${name} readback length`);
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(`${name} texel mismatch at ${i}: expected ${expected[i]}, got ${actual[i]}`);
    }
  }
}

const ALL_FORMATS: readonly FormatName[] = ['RGBA8', 'R8', 'R16F', 'RG16F', 'RGBA16F', 'R32F', 'RG16UI', 'RGBA8UI'];

// Independent of the implementation's format table: mutant M1 changed one entry and survived.
const EXPECTED_BYTES: Readonly<Record<FormatName, number>> = {
  RGBA8: 4,
  R8: 1,
  R16F: 2,
  RG16F: 4,
  RGBA16F: 8,
  R32F: 4,
  RG16UI: 4,
  RGBA8UI: 4,
};

async function textureCreateAndUpload(): Promise<void> {
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;
    const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    for (const name of ALL_FORMATS) {
      const tex = createTexture2D(gl, { width: W, height: H, format: name, data: uploadData(name) });
      try {
        assertEqual(tex.width, W, `${name} width`);
        assertEqual(tex.height, H, `${name} height`);
        assertEqual(tex.format.bytesPerTexel, EXPECTED_BYTES[name], `${name} bytesPerTexel`);
        assertEqual(tex.bytes, W * H * EXPECTED_BYTES[name], `${name} bytes`);
        const fb = createFramebuffer(gl, [tex]);
        try {
          assertExactReadback(name, readTexels(gl, fb, 0, 0, 0, W, H));
        } finally {
          fb.dispose();
        }
      } finally {
        tex.dispose();
      }
      assertEqual(gl.getError(), gl.NO_ERROR, `${name} clean`);
    }

    // Filter/wrap mapping reaches the real GL state: a linear texture reads
    // back LINEAR/REPEAT, the default reads back NEAREST/CLAMP_TO_EDGE.
    const linearTex = createTexture2D(gl, { width: 4, height: 4, format: 'RGBA8', filter: 'linear', wrap: 'repeat' });
    try {
      gl.bindTexture(gl.TEXTURE_2D, linearTex.texture);
      assertEqual(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER), gl.LINEAR, 'linear MIN_FILTER');
      assertEqual(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER), gl.LINEAR, 'linear MAG_FILTER');
      assertEqual(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S), gl.REPEAT, 'repeat WRAP_S');
      assertEqual(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T), gl.REPEAT, 'repeat WRAP_T');
    } finally {
      linearTex.dispose();
    }
    const defaultTex = createTexture2D(gl, { width: 4, height: 4, format: 'RGBA8' });
    try {
      gl.bindTexture(gl.TEXTURE_2D, defaultTex.texture);
      assertEqual(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER), gl.NEAREST, 'default MIN_FILTER');
      assertEqual(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER), gl.NEAREST, 'default MAG_FILTER');
      assertEqual(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S), gl.CLAMP_TO_EDGE, 'default WRAP_S');
      assertEqual(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T), gl.CLAMP_TO_EDGE, 'default WRAP_T');
    } finally {
      defaultTex.dispose();
    }

    // Argument validation table: exact codes, nothing pending afterwards.
    const table: ReadonlyArray<{ what: string; code: 'LIMIT' | 'UPLOAD' | 'CAPABILITY'; make: () => unknown }> = [
      { what: 'width 0', code: 'LIMIT', make: () => createTexture2D(gl, { width: 0, height: 2, format: 'RGBA8' }) },
      { what: 'width above max', code: 'LIMIT', make: () => createTexture2D(gl, { width: maxSize + 1, height: 1, format: 'RGBA8' }) },
      { what: 'NaN width', code: 'LIMIT', make: () => createTexture2D(gl, { width: NaN, height: 2, format: 'RGBA8' }) },
      { what: 'fractional width', code: 'LIMIT', make: () => createTexture2D(gl, { width: 1.5, height: 2, format: 'RGBA8' }) },
      {
        what: 'wrong typed-array class',
        code: 'UPLOAD',
        make: () => createTexture2D(gl, { width: 2, height: 2, format: 'R16F', data: new Uint8Array(4) }),
      },
      {
        what: 'data one short',
        code: 'UPLOAD',
        make: () => createTexture2D(gl, { width: 2, height: 2, format: 'RGBA8', data: new Uint8Array(15) }),
      },
      {
        what: 'data one long',
        code: 'UPLOAD',
        make: () => createTexture2D(gl, { width: 2, height: 2, format: 'RGBA8', data: new Uint8Array(17) }),
      },
      {
        what: 'linear on uint',
        code: 'CAPABILITY',
        make: () => createTexture2D(gl, { width: 2, height: 2, format: 'RG16UI', filter: 'linear' }),
      },
    ];
    for (const entry of table) {
      assertThrowsGl(entry.code, entry.make as () => unknown, entry.what);
      assertEqual(gl.getError(), gl.NO_ERROR, `${entry.what} leaves no GL error`);
    }

    // UNPACK_ALIGNMENT is restored around uploads (mutant M6 dropped the restore and survived).
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    const alignTex = createTexture2D(gl, { width: 2, height: 2, format: 'RGBA8', data: new Uint8Array(16) });
    try {
      assertEqual(gl.getParameter(gl.UNPACK_ALIGNMENT), 4, 'createTexture2D restores alignment');
      uploadRegion(gl, alignTex, 0, 0, 2, 2, new Uint8Array(16));
      assertEqual(gl.getParameter(gl.UNPACK_ALIGNMENT), 4, 'uploadRegion restores alignment');
    } finally {
      alignTex.dispose();
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    }

    // uploadRegion writes a 2x2 block at (1,1); everything outside is unchanged.
    const tex = createTexture2D(gl, { width: W, height: H, format: 'RGBA8', data: uploadData('RGBA8') });
    try {
      const fb = createFramebuffer(gl, [tex]);
      try {
        const patch = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160]);
        uploadRegion(gl, tex, 1, 1, 2, 2, patch);
        const back = readTexels(gl, fb, 0, 0, 0, W, H) as Uint8Array;
        assertTrue(back instanceof Uint8Array, 'RGBA8 readback class');
        const before = expectedReadback('RGBA8');
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const inside = x >= 1 && x < 3 && y >= 1 && y < 3;
            for (let c = 0; c < 4; c++) {
              const idx = (y * W + x) * 4 + c;
              const want = inside ? patch[((y - 1) * 2 + (x - 1)) * 4 + c] : before[idx];
              if (back[idx] !== want) throw new Error(`uploadRegion texel (${x},${y})[${c}]: expected ${want}, got ${back[idx]}`);
            }
          }
        }
        // Out-of-range rectangles and wrong lengths are UPLOAD and leave the texture unchanged.
        const snapshot = Array.from(back);
        const bad: ReadonlyArray<readonly [string, () => void]> = [
          ['negative x', () => uploadRegion(gl, tex, -1, 0, 2, 2, new Uint8Array(16))],
          ['outside', () => uploadRegion(gl, tex, 4, 0, 2, 2, new Uint8Array(16))],
          ['width 0', () => uploadRegion(gl, tex, 0, 0, 0, 2, new Uint8Array(0))],
          ['short data', () => uploadRegion(gl, tex, 0, 0, 2, 2, new Uint8Array(15))],
        ];
        for (const [what, fn] of bad) {
          assertThrowsGl('UPLOAD', fn, `uploadRegion ${what}`);
          const after = readTexels(gl, fb, 0, 0, 0, W, H) as Uint8Array;
          assertEqual(JSON.stringify(Array.from(after)), JSON.stringify(snapshot), `uploadRegion ${what} unchanged`);
        }
      } finally {
        fb.dispose();
      }
    } finally {
      tex.dispose();
    }
    assertEqual(gl.getError(), gl.NO_ERROR, 'texture case clean end');
  } finally {
    context.dispose();
  }
}

export const textureCases: readonly GpuCase[] = [
  { name: 'texture: create and upload', run: textureCreateAndUpload },
];

export type { GlTexture };

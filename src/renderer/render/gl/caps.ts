import { checkGl, GlError } from './errors.ts';

export const FORMAT_NAMES = ['RGBA8', 'R8', 'R16F', 'RG16F', 'RGBA16F', 'R32F', 'RG16UI', 'RGBA8UI'] as const;

export type FormatName = (typeof FORMAT_NAMES)[number];

export interface FormatInfo {
  readonly name: FormatName;
  readonly internalFormat: number;
  readonly format: number;
  readonly type: number;
  readonly channels: number;
  readonly bytesPerTexel: number;
  readonly kind: 'unorm8' | 'float' | 'uint';
  readonly readFormat: number;
  readonly readType: number;
  readonly extension: 'EXT_color_buffer_float' | null;
}

function isFormatName(name: unknown): name is FormatName {
  return typeof name === 'string' && (FORMAT_NAMES as readonly string[]).includes(name);
}

export function formatInfo(gl: WebGL2RenderingContext, name: FormatName): FormatInfo {
  if (typeof gl !== 'object' || gl === null) {
    throw new GlError('CAPABILITY', 'formatInfo: gl must be a WebGL2RenderingContext');
  }
  if (!isFormatName(name)) {
    throw new GlError('CAPABILITY', `formatInfo: unknown format ${String(name)}`);
  }
  switch (name) {
    case 'RGBA8':
      return {
        name, internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE,
        channels: 4, bytesPerTexel: 4, kind: 'unorm8',
        readFormat: gl.RGBA, readType: gl.UNSIGNED_BYTE, extension: null,
      };
    case 'R8':
      return {
        name, internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE,
        channels: 1, bytesPerTexel: 1, kind: 'unorm8',
        readFormat: gl.RGBA, readType: gl.UNSIGNED_BYTE, extension: null,
      };
    case 'R16F':
      return {
        name, internalFormat: gl.R16F, format: gl.RED, type: gl.FLOAT,
        channels: 1, bytesPerTexel: 2, kind: 'float',
        readFormat: gl.RGBA, readType: gl.FLOAT, extension: 'EXT_color_buffer_float',
      };
    case 'RG16F':
      return {
        name, internalFormat: gl.RG16F, format: gl.RG, type: gl.FLOAT,
        channels: 2, bytesPerTexel: 4, kind: 'float',
        readFormat: gl.RGBA, readType: gl.FLOAT, extension: 'EXT_color_buffer_float',
      };
    case 'RGBA16F':
      return {
        name, internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.FLOAT,
        channels: 4, bytesPerTexel: 8, kind: 'float',
        readFormat: gl.RGBA, readType: gl.FLOAT, extension: 'EXT_color_buffer_float',
      };
    case 'R32F':
      return {
        name, internalFormat: gl.R32F, format: gl.RED, type: gl.FLOAT,
        channels: 1, bytesPerTexel: 4, kind: 'float',
        readFormat: gl.RGBA, readType: gl.FLOAT, extension: 'EXT_color_buffer_float',
      };
    case 'RG16UI':
      return {
        name, internalFormat: gl.RG16UI, format: gl.RG_INTEGER, type: gl.UNSIGNED_SHORT,
        channels: 2, bytesPerTexel: 4, kind: 'uint',
        readFormat: gl.RGBA_INTEGER, readType: gl.UNSIGNED_INT, extension: null,
      };
    case 'RGBA8UI':
      return {
        name, internalFormat: gl.RGBA8UI, format: gl.RGBA_INTEGER, type: gl.UNSIGNED_BYTE,
        channels: 4, bytesPerTexel: 4, kind: 'uint',
        readFormat: gl.RGBA_INTEGER, readType: gl.UNSIGNED_INT, extension: null,
      };
  }
}

export interface FormatReport {
  readonly name: FormatName;
  readonly texture: boolean;
  readonly renderable: boolean;
  readonly roundTrip: boolean;
}

export interface CapsReport {
  readonly version: string;
  readonly shadingLanguage: string;
  readonly vendor: string;
  readonly renderer: string;
  readonly unmaskedVendor: string | null;
  readonly unmaskedRenderer: string | null;
  readonly maxTextureSize: number;
  readonly maxRenderbufferSize: number;
  readonly maxColorAttachments: number;
  readonly maxTextureImageUnits: number;
  readonly maxViewportDims: readonly [number, number];
  readonly extensions: readonly string[];
  readonly linearFloat: boolean;
  readonly formats: readonly FormatReport[];
}

function makeUpload(gl: WebGL2RenderingContext, info: FormatInfo, size: number): ArrayBufferView {
  // Exactly-representable values for every kind (bytes, half floats, uint16).
  const count = size * size * info.channels;
  if (info.kind === 'float') {
    const pattern = [0.5, 0.25, -2, 1024, -0.5, 2.25, 100, -1024];
    const data = new Float32Array(count);
    for (let i = 0; i < count; i++) data[i] = pattern[i % pattern.length];
    return data;
  }
  if (info.kind === 'uint') {
    if (info.type === gl.UNSIGNED_SHORT) {
      const pattern = [0, 1, 255, 256, 1000, 32768, 65535, 12345];
      const data = new Uint16Array(count);
      for (let i = 0; i < count; i++) data[i] = pattern[i % pattern.length];
      return data;
    }
    const data = new Uint8Array(count);
    for (let i = 0; i < count; i++) data[i] = (i * 7 + 13) & 255;
    return data;
  }
  const data = new Uint8Array(count);
  for (let i = 0; i < count; i++) data[i] = (i * 7 + 13) & 255;
  return data;
}

function expectedReadback(info: FormatInfo, upload: ArrayBufferView, size: number): number[] {
  const values = upload as Uint8Array | Float32Array | Uint16Array;
  const out: number[] = [];
  for (let t = 0; t < size * size; t++) {
    const sample = (c: number): number => (c < info.channels ? values[t * info.channels + c] : c === 3 ? 1 : 0);
    // The alpha default is 1 in float/uint units; unorm8 readback converts it to 255.
    const alpha = info.channels >= 4 ? sample(3) : info.kind === 'unorm8' ? 255 : 1;
    out.push(sample(0), sample(1), sample(2), alpha);
  }
  return out;
}

function probeFormat(gl: WebGL2RenderingContext, name: FormatName): FormatReport {
  const size = 4;
  const info = formatInfo(gl, name);
  const previousAlignment = gl.getParameter(gl.UNPACK_ALIGNMENT) as number;
  const previousBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
  const previousFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  const previousRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
  let texture: WebGLTexture | null = null;
  let fbo: WebGLFramebuffer | null = null;
  try {
    texture = gl.createTexture();
    if (texture === null) return { name, texture: false, renderable: false, roundTrip: false };
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, info.internalFormat, size, size);
    if (gl.getError() !== gl.NO_ERROR) return { name, texture: false, renderable: false, roundTrip: false };
    fbo = gl.createFramebuffer();
    if (fbo === null) return { name, texture: true, renderable: false, roundTrip: false };
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const renderable = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (!renderable) return { name, texture: true, renderable: false, roundTrip: false };
    const upload = makeUpload(gl, info, size);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, size, size, info.format, info.type, upload);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, previousAlignment);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    const expected = expectedReadback(info, upload, size);
    let roundTrip = false;
    if (info.kind === 'float') {
      const out = new Float32Array(size * size * 4);
      gl.readPixels(0, 0, size, size, info.readFormat, info.readType, out);
      roundTrip = out.length === expected.length && out.every((v, i) => v === expected[i]);
    } else if (info.kind === 'uint') {
      const out = new Uint32Array(size * size * 4);
      gl.readPixels(0, 0, size, size, info.readFormat, info.readType, out);
      roundTrip = out.length === expected.length && out.every((v, i) => v === expected[i]);
    } else {
      const out = new Uint8Array(size * size * 4);
      gl.readPixels(0, 0, size, size, info.readFormat, info.readType, out);
      roundTrip = out.length === expected.length && out.every((v, i) => v === expected[i]);
    }
    if (gl.getError() !== gl.NO_ERROR) roundTrip = false;
    return { name, texture: true, renderable: true, roundTrip };
  } catch {
    return { name, texture: false, renderable: false, roundTrip: false };
  } finally {
    try {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, previousAlignment);
      if (fbo !== null) gl.deleteFramebuffer(fbo);
      if (texture !== null) gl.deleteTexture(texture);
      gl.bindTexture(gl.TEXTURE_2D, previousBinding);
      gl.bindFramebuffer(gl.FRAMEBUFFER, previousFbo);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead);
    } catch {
      // Cleanup must not mask the probe result.
    }
  }
}

export function probeCaps(gl: WebGL2RenderingContext): CapsReport {
  if (typeof gl !== 'object' || gl === null) {
    throw new GlError('CAPABILITY', 'probeCaps: gl must be a WebGL2RenderingContext');
  }
  gl.getExtension('EXT_color_buffer_float');
  const linearFloat = gl.getExtension('OES_texture_float_linear') !== null;
  let unmaskedVendor: string | null = null;
  let unmaskedRenderer: string | null = null;
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  if (debugInfo !== null) {
    try {
      unmaskedVendor = String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL));
      unmaskedRenderer = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
    } catch {
      unmaskedVendor = null;
      unmaskedRenderer = null;
    }
  }
  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as [number, number];
  const report: CapsReport = {
    version: String(gl.getParameter(gl.VERSION)),
    shadingLanguage: String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)),
    vendor: String(gl.getParameter(gl.VENDOR)),
    renderer: String(gl.getParameter(gl.RENDERER)),
    unmaskedVendor,
    unmaskedRenderer,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
    maxColorAttachments: gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) as number,
    maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number,
    maxViewportDims: [viewport[0], viewport[1]],
    extensions: [...(gl.getSupportedExtensions() ?? [])].sort(),
    linearFloat,
    formats: FORMAT_NAMES.map((name) => probeFormat(gl, name)),
  };
  try {
    checkGl(gl, 'probeCaps');
  } catch {
    // Drained: a missing format reports false, it never throws.
  }
  return report;
}

export function assertRequiredCaps(
  report: CapsReport,
  required?: readonly FormatName[],
  minTextureSize?: number,
): void {
  const want: readonly FormatName[] = required ?? FORMAT_NAMES;
  const minSize = minTextureSize ?? 16384;
  if (typeof report !== 'object' || report === null) {
    throw new GlError('CAPABILITY', 'assertRequiredCaps: report must be a CapsReport');
  }
  if (!Array.isArray(want)) throw new GlError('CAPABILITY', 'assertRequiredCaps: required must be an array');
  if (typeof minSize !== 'number') throw new GlError('CAPABILITY', 'assertRequiredCaps: minTextureSize must be a number');
  const missing: string[] = [];
  for (const name of want) {
    const found = Array.isArray(report.formats)
      ? report.formats.find((f) => f !== null && typeof f === 'object' && f.name === name)
      : undefined;
    if (!found || !found.texture || !found.renderable || !found.roundTrip) {
      missing.push(`format ${String(name)} is not fully supported`);
    }
  }
  if (typeof report.maxTextureSize !== 'number' || report.maxTextureSize < minSize) {
    missing.push(`maxTextureSize ${String(report.maxTextureSize)} is below the required ${minSize}`);
  }
  if (missing.length > 0) {
    throw new GlError('CAPABILITY', `missing required capabilities: ${missing.join('; ')}`);
  }
}

import { type GlBudget } from './budget.ts';
import { formatInfo, type FormatInfo, type FormatName } from './caps.ts';
import { checkGl, GlError } from './errors.ts';

export interface Texture2DSpec {
  readonly width: number;
  readonly height: number;
  readonly format: FormatName;
  readonly filter?: 'nearest' | 'linear';
  readonly wrap?: 'clamp' | 'repeat';
  readonly data?: ArrayBufferView | null;
  readonly label?: string;
}

export interface GlTexture {
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
  readonly format: FormatInfo;
  readonly bytes: number;
  dispose(): void;
}

function isSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** The exact typed-array class each format uploads with. */
function dataMatches(gl: WebGL2RenderingContext, info: FormatInfo, data: ArrayBufferView): boolean {
  if (info.kind === 'float') return data instanceof Float32Array;
  if (info.type === gl.UNSIGNED_SHORT) return data instanceof Uint16Array;
  return data instanceof Uint8Array;
}

function dataKindName(gl: WebGL2RenderingContext, info: FormatInfo): string {
  if (info.kind === 'float') return 'Float32Array';
  if (info.type === gl.UNSIGNED_SHORT) return 'Uint16Array';
  return 'Uint8Array';
}

function checkedSpec(
  gl: WebGL2RenderingContext,
  spec: Texture2DSpec,
  what: string,
): { width: number; height: number; info: FormatInfo; filter: 'nearest' | 'linear'; wrap: 'clamp' | 'repeat'; label: string } {
  if (typeof spec !== 'object' || spec === null) {
    throw new GlError('UPLOAD', `${what}: spec must be an object`);
  }
  if (typeof spec.label !== 'undefined' && typeof spec.label !== 'string') {
    throw new GlError('UPLOAD', `${what}: label must be a string`);
  }
  const label = spec.label ?? 'texture';
  const info = formatInfo(gl, spec.format);
  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  if (!isSafeInt(spec.width) || spec.width < 1 || spec.width > maxSize) {
    throw new GlError('LIMIT', `${label}: invalid width ${String(spec.width)}`);
  }
  if (!isSafeInt(spec.height) || spec.height < 1 || spec.height > maxSize) {
    throw new GlError('LIMIT', `${label}: invalid height ${String(spec.height)}`);
  }
  const filter = spec.filter ?? 'nearest';
  if (filter !== 'nearest' && filter !== 'linear') {
    throw new GlError('UPLOAD', `${label}: invalid filter ${String(spec.filter)}`);
  }
  const wrap = spec.wrap ?? 'clamp';
  if (wrap !== 'clamp' && wrap !== 'repeat') {
    throw new GlError('UPLOAD', `${label}: invalid wrap ${String(spec.wrap)}`);
  }
  if (filter === 'linear') {
    if (info.kind === 'uint') {
      throw new GlError('CAPABILITY', `${label}: linear filtering is not supported for ${info.name}`);
    }
    if (info.name === 'R32F' && gl.getExtension('OES_texture_float_linear') === null) {
      throw new GlError('CAPABILITY', `${label}: linear filtering of R32F needs OES_texture_float_linear`);
    }
  }
  return { width: spec.width, height: spec.height, info, filter, wrap, label };
}

function checkedData(
  gl: WebGL2RenderingContext,
  info: FormatInfo,
  width: number,
  height: number,
  data: ArrayBufferView,
  label: string,
): void {
  const want = width * height * info.channels;
  const length = (data as Uint8Array).length;
  if (typeof length !== 'number' || !dataMatches(gl, info, data) || length !== want) {
    throw new GlError(
      'UPLOAD',
      `${label}: data must be exactly ${want} elements of ${dataKindName(gl, info)}`,
    );
  }
}

export function createTexture2D(gl: WebGL2RenderingContext, spec: Texture2DSpec, budget?: GlBudget): GlTexture {
  if (typeof gl !== 'object' || gl === null) {
    throw new GlError('UPLOAD', 'createTexture2D: gl must be a WebGL2RenderingContext');
  }
  if (budget !== undefined && (typeof budget !== 'object' || budget === null)) {
    throw new GlError('UPLOAD', 'createTexture2D: budget must be a GlBudget');
  }
  const { width, height, info, filter, wrap, label } = checkedSpec(gl, spec, 'createTexture2D');
  if (spec.data !== undefined && spec.data !== null && typeof spec.data !== 'object') {
    throw new GlError('UPLOAD', `${label}: data must be a typed array`);
  }
  if (spec.data !== undefined && spec.data !== null) {
    checkedData(gl, info, width, height, spec.data, label);
  }
  const bytes = width * height * info.bytesPerTexel;
  if (budget !== undefined) budget.reserve(bytes, label);
  let reserved = budget !== undefined;
  let texture: WebGLTexture | null = null;
  try {
    texture = gl.createTexture();
    if (texture === null) {
      throw new GlError('UPLOAD', `${label}: createTexture returned null`);
    }
    const handle: WebGLTexture = texture;
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter === 'linear' ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === 'linear' ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, info.internalFormat, width, height);
    if (spec.data !== undefined && spec.data !== null) {
      const previous = gl.getParameter(gl.UNPACK_ALIGNMENT) as number;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      try {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, info.format, info.type, spec.data);
      } finally {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, previous);
      }
    }
    checkGl(gl, label);
    reserved = false;
    const held = budget;
    let disposed = false;
    return {
      texture: handle,
      width,
      height,
      format: info,
      bytes,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        gl.deleteTexture(handle);
        held?.release(bytes);
      },
    };
  } catch (error) {
    if (texture !== null) {
      try {
        gl.deleteTexture(texture);
      } catch {
        // Do not mask the original failure.
      }
    }
    if (reserved && budget !== undefined) {
      try {
        budget.release(bytes);
      } catch {
        // Do not mask the original failure.
      }
    }
    throw error;
  }
}

export function uploadRegion(
  gl: WebGL2RenderingContext,
  tex: GlTexture,
  x: number,
  y: number,
  width: number,
  height: number,
  data: ArrayBufferView,
): void {
  if (typeof gl !== 'object' || gl === null) {
    throw new GlError('UPLOAD', 'uploadRegion: gl must be a WebGL2RenderingContext');
  }
  if (typeof tex !== 'object' || tex === null) {
    throw new GlError('UPLOAD', 'uploadRegion: tex must be a GlTexture');
  }
  const info = tex.format;
  if (!isSafeInt(x) || !isSafeInt(y) || !isSafeInt(width) || !isSafeInt(height)) {
    throw new GlError('UPLOAD', 'uploadRegion: rectangle must be safe integers');
  }
  if (width < 1 || height < 1 || x < 0 || y < 0 || x + width > tex.width || y + height > tex.height) {
    throw new GlError('UPLOAD', 'uploadRegion: rectangle is outside the texture');
  }
  if (typeof data !== 'object' || data === null) {
    throw new GlError('UPLOAD', 'uploadRegion: data must be a typed array');
  }
  checkedData(gl, info, width, height, data, 'uploadRegion');
  gl.bindTexture(gl.TEXTURE_2D, tex.texture);
  const previous = gl.getParameter(gl.UNPACK_ALIGNMENT) as number;
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  try {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, width, height, info.format, info.type, data);
  } finally {
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, previous);
  }
  checkGl(gl, 'uploadRegion');
}

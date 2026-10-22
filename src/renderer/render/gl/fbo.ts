import { checkGl, framebufferStatusName, GlError } from './errors.ts';
import { type GlTexture } from './texture.ts';

export interface GlFramebuffer {
  readonly fbo: WebGLFramebuffer;
  readonly width: number;
  readonly height: number;
  readonly attachments: readonly GlTexture[];
  bind(): void;
  dispose(): void;
}

function isSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function createFramebuffer(gl: WebGL2RenderingContext, attachments: readonly GlTexture[]): GlFramebuffer {
  if (typeof gl !== 'object' || gl === null) {
    throw new GlError('FRAMEBUFFER', 'createFramebuffer: gl must be a WebGL2RenderingContext');
  }
  if (!Array.isArray(attachments)) {
    throw new GlError('FRAMEBUFFER', 'createFramebuffer: attachments must be an array');
  }
  const maxAttachments = gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) as number;
  if (attachments.length < 1 || attachments.length > maxAttachments) {
    throw new GlError('FRAMEBUFFER', `createFramebuffer: need 1..${maxAttachments} attachments`);
  }
  const width = (attachments[0] as GlTexture)?.width;
  const height = (attachments[0] as GlTexture)?.height;
  if (!isSafeInt(width) || !isSafeInt(height)) {
    throw new GlError('FRAMEBUFFER', 'createFramebuffer: attachment must be a GlTexture');
  }
  for (const attachment of attachments) {
    if (
      typeof attachment !== 'object' ||
      attachment === null ||
      (attachment as GlTexture).width !== width ||
      (attachment as GlTexture).height !== height
    ) {
      throw new GlError('FRAMEBUFFER', 'createFramebuffer: all attachments must be the same size');
    }
    const tex = (attachment as GlTexture).texture;
    if (!(tex instanceof WebGLTexture) || !gl.isTexture(tex)) {
      throw new GlError('FRAMEBUFFER', 'createFramebuffer: attachment texture is not alive');
    }
  }
  const needsFloat = attachments.some((a) => (a as GlTexture).format.extension !== null);
  if (needsFloat) gl.getExtension('EXT_color_buffer_float');
  const fbo = gl.createFramebuffer();
  if (fbo === null) {
    throw new GlError('FRAMEBUFFER', 'createFramebuffer: createFramebuffer returned null');
  }
  const previousDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
  try {
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
    attachments.forEach((attachment, i) => {
      gl.framebufferTexture2D(
        gl.DRAW_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0 + i,
        gl.TEXTURE_2D,
        (attachment as GlTexture).texture,
        0,
      );
    });
    if (attachments.length > 1) {
      gl.drawBuffers(attachments.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    }
    const status = gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new GlError('FRAMEBUFFER', `createFramebuffer: status ${framebufferStatusName(gl, status)}`);
    }
  } catch (error) {
    try {
      gl.deleteFramebuffer(fbo);
    } catch {
      // Do not mask the original failure.
    }
    try {
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDraw);
    } catch {
      // Do not mask the original failure.
    }
    throw error;
  }
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDraw);
  const handle: WebGLFramebuffer = fbo;
  let disposed = false;
  return {
    fbo: handle,
    width,
    height,
    attachments: [...attachments] as GlTexture[],
    bind: () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, handle);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      gl.deleteFramebuffer(handle);
    },
  };
}

export function readTexels(
  gl: WebGL2RenderingContext,
  fb: GlFramebuffer,
  attachment: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Uint8Array | Float32Array | Uint32Array {
  if (typeof gl !== 'object' || gl === null) {
    throw new GlError('FRAMEBUFFER', 'readTexels: gl must be a WebGL2RenderingContext');
  }
  if (typeof fb !== 'object' || fb === null || !Array.isArray((fb as GlFramebuffer).attachments)) {
    throw new GlError('FRAMEBUFFER', 'readTexels: fb must be a GlFramebuffer');
  }
  if (!isSafeInt(attachment) || attachment < 0 || attachment >= fb.attachments.length) {
    throw new GlError('FRAMEBUFFER', `readTexels: invalid attachment ${String(attachment)}`);
  }
  if (!isSafeInt(x) || !isSafeInt(y) || !isSafeInt(width) || !isSafeInt(height)) {
    throw new GlError('FRAMEBUFFER', 'readTexels: rectangle must be safe integers');
  }
  if (width < 1 || height < 1 || x < 0 || y < 0 || x + width > fb.width || y + height > fb.height) {
    throw new GlError('FRAMEBUFFER', 'readTexels: rectangle is outside the framebuffer');
  }
  const info = fb.attachments[attachment].format;
  const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb.fbo);
  let out: Uint8Array | Float32Array | Uint32Array;
  try {
    gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
    if (info.kind === 'float') {
      const pixels = new Float32Array(width * height * 4);
      gl.readPixels(x, y, width, height, info.readFormat, info.readType, pixels);
      out = pixels;
    } else if (info.kind === 'uint') {
      const pixels = new Uint32Array(width * height * 4);
      gl.readPixels(x, y, width, height, info.readFormat, info.readType, pixels);
      out = pixels;
    } else {
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(x, y, width, height, info.readFormat, info.readType, pixels);
      out = pixels;
    }
  } finally {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous);
  }
  checkGl(gl, 'readTexels');
  return out;
}

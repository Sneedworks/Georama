export type GlErrorCode =
  | 'CONTEXT'
  | 'LOST'
  | 'GL'
  | 'SHADER'
  | 'PROGRAM'
  | 'FRAMEBUFFER'
  | 'CAPABILITY'
  | 'UPLOAD'
  | 'LIMIT';

export class GlError extends Error {
  readonly code: GlErrorCode;
  readonly detail: string;
  constructor(code: GlErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'GlError';
    this.code = code;
    this.detail = detail ?? '';
  }
}

function assertGl(gl: unknown, where: string): asserts gl is WebGL2RenderingContext {
  if (typeof gl !== 'object' || gl === null) {
    throw new GlError('GL', `${where}: gl must be a WebGL2RenderingContext`);
  }
}

export function glErrorName(gl: WebGL2RenderingContext, error: number): string {
  assertGl(gl, 'glErrorName');
  if (typeof error !== 'number') throw new GlError('GL', 'glErrorName: error must be a number');
  switch (error) {
    case gl.NO_ERROR: return 'NO_ERROR';
    case gl.INVALID_ENUM: return 'INVALID_ENUM';
    case gl.INVALID_VALUE: return 'INVALID_VALUE';
    case gl.INVALID_OPERATION: return 'INVALID_OPERATION';
    case gl.INVALID_FRAMEBUFFER_OPERATION: return 'INVALID_FRAMEBUFFER_OPERATION';
    case gl.OUT_OF_MEMORY: return 'OUT_OF_MEMORY';
    case gl.CONTEXT_LOST_WEBGL: return 'CONTEXT_LOST_WEBGL';
    default: return `UNKNOWN_0x${error.toString(16).toUpperCase()}`;
  }
}

export function framebufferStatusName(gl: WebGL2RenderingContext, status: number): string {
  assertGl(gl, 'framebufferStatusName');
  if (typeof status !== 'number') throw new GlError('GL', 'framebufferStatusName: status must be a number');
  switch (status) {
    case gl.FRAMEBUFFER_COMPLETE: return 'FRAMEBUFFER_COMPLETE';
    case gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT: return 'FRAMEBUFFER_INCOMPLETE_ATTACHMENT';
    case gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: return 'FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT';
    case gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS: return 'FRAMEBUFFER_INCOMPLETE_DIMENSIONS';
    case gl.FRAMEBUFFER_UNSUPPORTED: return 'FRAMEBUFFER_UNSUPPORTED';
    case gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE: return 'FRAMEBUFFER_INCOMPLETE_MULTISAMPLE';
    default: return `UNKNOWN_0x${status.toString(16).toUpperCase()}`;
  }
}

export function checkGl(gl: WebGL2RenderingContext, where: string): void {
  assertGl(gl, 'checkGl');
  if (typeof where !== 'string') throw new GlError('GL', 'checkGl: where must be a string');
  const seen: string[] = [];
  let lost = false;
  for (let i = 0; i < 32; i++) {
    const error = gl.getError();
    if (error === gl.NO_ERROR) break;
    if (error === gl.CONTEXT_LOST_WEBGL) {
      lost = true;
      continue;
    }
    const name = glErrorName(gl, error);
    if (!seen.includes(name)) seen.push(name);
  }
  if (lost || gl.isContextLost()) throw new GlError('LOST', `${where}: context lost`);
  if (seen.length > 0) throw new GlError('GL', `${where}: ${seen.join(', ')}`);
}

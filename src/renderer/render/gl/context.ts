import { GlError } from './errors.ts';

export const CONTEXT_ATTRIBUTES: Readonly<{
  alpha: false;
  antialias: false;
  depth: false;
  stencil: false;
  premultipliedAlpha: false;
  preserveDrawingBuffer: false;
  powerPreference: 'high-performance';
  failIfMajorPerformanceCaveat: true;
}> = Object.freeze({
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
  failIfMajorPerformanceCaveat: true,
} as const);

export interface GlContextHandlers {
  onLost?: () => void;
  onRestored?: () => void;
}

export interface GlContext {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  isLost(): boolean;
  dispose(): void;
}

type CanvasLike = HTMLCanvasElement | OffscreenCanvas;

function assertCanvas(canvas: unknown): asserts canvas is CanvasLike {
  if (
    typeof canvas !== 'object' ||
    canvas === null ||
    typeof (canvas as { getContext?: unknown }).getContext !== 'function' ||
    typeof (canvas as { addEventListener?: unknown }).addEventListener !== 'function' ||
    typeof (canvas as { removeEventListener?: unknown }).removeEventListener !== 'function'
  ) {
    throw new GlError('CONTEXT', 'createGlContext: canvas must be a canvas element');
  }
}

export function createGlContext(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  handlers?: GlContextHandlers,
  overrides?: Partial<WebGLContextAttributes>,
): GlContext {
  assertCanvas(canvas);
  if (handlers !== undefined && (typeof handlers !== 'object' || handlers === null)) {
    throw new GlError('CONTEXT', 'createGlContext: handlers must be an object');
  }
  if (overrides !== undefined && (typeof overrides !== 'object' || overrides === null)) {
    throw new GlError('CONTEXT', 'createGlContext: overrides must be an object');
  }
  if (handlers !== undefined) {
    if (handlers.onLost !== undefined && typeof handlers.onLost !== 'function') {
      throw new GlError('CONTEXT', 'createGlContext: onLost must be a function');
    }
    if (handlers.onRestored !== undefined && typeof handlers.onRestored !== 'function') {
      throw new GlError('CONTEXT', 'createGlContext: onRestored must be a function');
    }
  }
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = (canvas as HTMLCanvasElement).getContext('webgl2', { ...CONTEXT_ATTRIBUTES, ...overrides });
  } catch {
    gl = null;
  }
  if (gl === null) {
    throw new GlError('CONTEXT', 'createGlContext: WebGL2 context creation failed');
  }
  const context = gl;
  let lost = false;
  const onLostEvent = (event: Event): void => {
    // preventDefault first: without it the context can never be restored.
    try {
      event.preventDefault();
    } catch (error) {
      console.error(error);
    }
    lost = true;
    try {
      handlers?.onLost?.();
    } catch (error) {
      console.error(error);
    }
  };
  const onRestoredEvent = (): void => {
    lost = false;
    try {
      handlers?.onRestored?.();
    } catch (error) {
      console.error(error);
    }
  };
  canvas.addEventListener('webglcontextlost', onLostEvent);
  canvas.addEventListener('webglcontextrestored', onRestoredEvent);
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener('webglcontextlost', onLostEvent);
    canvas.removeEventListener('webglcontextrestored', onRestoredEvent);
    if (!lost && !context.isContextLost()) {
      try {
        context.getExtension('WEBGL_lose_context')?.loseContext();
      } catch (error) {
        console.error(error);
      }
    }
  };
  return {
    gl: context,
    canvas,
    isLost: () => lost || context.isContextLost(),
    dispose,
  };
}

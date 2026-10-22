import { assertRequiredCaps, type CapsReport } from './caps.ts';
import { createGlContext, type GlContext, type GlContextHandlers } from './context.ts';
import { probeCaps } from './caps.ts';

export * from './budget.ts';
export * from './caps.ts';
export * from './context.ts';
export * from './errors.ts';
export * from './fbo.ts';
export * from './shader.ts';
export * from './texture.ts';

export function openContext(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  handlers?: GlContextHandlers,
): { context: GlContext; caps: CapsReport } {
  const context = createGlContext(canvas, handlers);
  try {
    const caps = probeCaps(context.gl);
    assertRequiredCaps(caps);
    return { context, caps };
  } catch (error) {
    context.dispose();
    throw error;
  }
}

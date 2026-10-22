import { checkGl, framebufferStatusName, glErrorName, GlError } from '../../src/renderer/render/gl/errors.ts';
import { CONTEXT_ATTRIBUTES, createGlContext } from '../../src/renderer/render/gl/context.ts';
import { createTexture2D } from '../../src/renderer/render/gl/texture.ts';
import { assertEqual, assertThrowsGl, assertTrue, freshCanvas, type GpuCase } from './index.ts';

async function contextAttributes(): Promise<void> {
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;
    const attrs = gl.getContextAttributes();
    if (attrs === null) throw new Error('getContextAttributes() returned null');
    assertEqual(attrs.alpha, false, 'alpha');
    assertEqual(attrs.antialias, false, 'antialias');
    assertEqual(attrs.depth, false, 'depth');
    assertEqual(attrs.stencil, false, 'stencil');
    assertEqual(attrs.preserveDrawingBuffer, false, 'preserveDrawingBuffer');
    assertEqual(attrs.failIfMajorPerformanceCaveat, true, 'failIfMajorPerformanceCaveat');
    assertTrue(Object.isFrozen(CONTEXT_ATTRIBUTES), 'CONTEXT_ATTRIBUTES is frozen');
    assertEqual(CONTEXT_ATTRIBUTES.powerPreference, 'high-performance', 'powerPreference');
    // An override is honoured on a separate canvas.
    const canvas2 = freshCanvas();
    const context2 = createGlContext(canvas2, undefined, { antialias: true });
    try {
      assertEqual(context2.gl.getContextAttributes()?.antialias, true, 'antialias override');
    } finally {
      context2.dispose();
    }
    // A canvas that already has a 2d context cannot produce a WebGL2 context.
    const canvas3 = freshCanvas();
    canvas3.getContext('2d');
    assertThrowsGl('CONTEXT', () => createGlContext(canvas3), '2d canvas');
  } finally {
    context.dispose();
  }
}

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 2000;
  for (;;) {
    if (condition()) return;
    if (performance.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function contextLossAndRestore(): Promise<void> {
  const events: string[] = [];
  const canvas = freshCanvas();
  const context = createGlContext(canvas, {
    onLost: () => { events.push('lost'); },
    onRestored: () => { events.push('restored'); },
  });
  try {
    const gl = context.gl;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose === null) throw new Error('WEBGL_lose_context unavailable');
    lose.loseContext();
    await waitFor(() => events.includes('lost'), 'lost event');
    assertEqual(context.isLost(), true, 'isLost while lost');
    assertEqual(events.join(','), 'lost', 'lost event order');
    assertThrowsGl('LOST', () => checkGl(gl, 'loss probe'), 'checkGl while lost');
    // Ordinary GL calls while lost must not throw.
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    lose.restoreContext();
    await waitFor(() => events.includes('restored'), 'restored event');
    assertEqual(context.isLost(), false, 'isLost after restore');
    assertEqual(events.join(','), 'lost,restored', 'restore event order');
    // The context works again afterwards.
    const tex = createTexture2D(gl, { width: 2, height: 2, format: 'RGBA8' });
    tex.dispose();
    // dispose() twice is fine and removes the listeners.
    context.dispose();
    context.dispose();
    const seen = events.length;
    lose.restoreContext();
    await new Promise((resolve) => setTimeout(resolve, 120));
    lose.loseContext();
    await new Promise((resolve) => setTimeout(resolve, 120));
    assertEqual(events.length, seen, 'no handler after dispose');
  } finally {
    context.dispose();
  }
}

async function checkGlCase(): Promise<void> {
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;
    // Provoke INVALID_ENUM, INVALID_VALUE and INVALID_OPERATION in one go.
    // A readPixels with a format/type combination the framebuffer cannot
    // produce is INVALID_OPERATION.
    gl.bindTexture(0xdead, null);
    gl.lineWidth(0);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, new Float32Array(4));
    const failure = assertThrowsGl('GL', () => checkGl(gl, 'provoke'), 'checkGl with three errors');
    const message = failure.message;
    const order: number[] = [];
    for (const name of ['INVALID_ENUM', 'INVALID_VALUE', 'INVALID_OPERATION']) {
      if (!message.includes(name)) {
        throw new Error(`checkGl message must name ${name}, got: ${message}`);
      }
      assertEqual(message.indexOf(name) !== message.lastIndexOf(name), false, `${name} named once`);
      order.push(message.indexOf(name));
    }
    assertTrue(order[0] < order[1] && order[1] < order[2], `checkGl names errors in order seen, got: ${message}`);
    // The queue was drained: a second checkGl does not throw.
    checkGl(gl, 'drained');
    // glErrorName covers every defined constant plus the unknown shape.
    const errorNames: ReadonlyArray<readonly [number, string]> = [
      [gl.NO_ERROR, 'NO_ERROR'],
      [gl.INVALID_ENUM, 'INVALID_ENUM'],
      [gl.INVALID_VALUE, 'INVALID_VALUE'],
      [gl.INVALID_OPERATION, 'INVALID_OPERATION'],
      [gl.INVALID_FRAMEBUFFER_OPERATION, 'INVALID_FRAMEBUFFER_OPERATION'],
      [gl.OUT_OF_MEMORY, 'OUT_OF_MEMORY'],
      [gl.CONTEXT_LOST_WEBGL, 'CONTEXT_LOST_WEBGL'],
    ];
    for (const [value, name] of errorNames) assertEqual(glErrorName(gl, value), name, `glErrorName ${name}`);
    assertEqual(glErrorName(gl, 0xabcd), 'UNKNOWN_0xABCD', 'glErrorName unknown hex letters');
    // framebufferStatusName likewise.
    const statusNames: ReadonlyArray<readonly [number, string]> = [
      [gl.FRAMEBUFFER_COMPLETE, 'FRAMEBUFFER_COMPLETE'],
      [gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT, 'FRAMEBUFFER_INCOMPLETE_ATTACHMENT'],
      [gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT, 'FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT'],
      [gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS, 'FRAMEBUFFER_INCOMPLETE_DIMENSIONS'],
      [gl.FRAMEBUFFER_UNSUPPORTED, 'FRAMEBUFFER_UNSUPPORTED'],
      [gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE, 'FRAMEBUFFER_INCOMPLETE_MULTISAMPLE'],
    ];
    for (const [value, name] of statusNames) assertEqual(framebufferStatusName(gl, value), name, `framebufferStatusName ${name}`);
    assertEqual(framebufferStatusName(gl, 0x9fff), 'UNKNOWN_0x9FFF', 'framebufferStatusName unknown');
    // A bare GlError defaults its detail to ''.
    assertEqual(new GlError('GL', 'x').detail, '', 'GlError default detail');
    // A stuck error source cannot hang checkGl: it drains at most 32 errors.
    let stuckReads = 0;
    const stuckGl = {
      NO_ERROR: 0,
      INVALID_ENUM: 0x0500,
      INVALID_VALUE: 0x0501,
      INVALID_OPERATION: 0x0502,
      INVALID_FRAMEBUFFER_OPERATION: 0x0506,
      OUT_OF_MEMORY: 0x0505,
      CONTEXT_LOST_WEBGL: 0x9242,
      getError: (): number => {
        stuckReads += 1;
        return 0x0500;
      },
      isContextLost: (): boolean => false,
    };
    assertThrowsGl(
      'GL',
      () => checkGl(stuckGl as unknown as WebGL2RenderingContext, 'stuck'),
      'stuck error source',
    );
    assertEqual(stuckReads, 32, 'checkGl drains at most 32 errors');
    checkGl(gl, 'clean end');
  } finally {
    context.dispose();
  }
}

export const contextCases: readonly GpuCase[] = [
  { name: 'context: attributes', run: contextAttributes },
  { name: 'context: loss and restore', run: contextLossAndRestore },
  { name: 'checkGl', run: checkGlCase },
];

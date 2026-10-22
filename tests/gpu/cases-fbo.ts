import { createGlContext } from '../../src/renderer/render/gl/context.ts';
import { createFramebuffer, readTexels } from '../../src/renderer/render/gl/fbo.ts';
import { createTexture2D, type GlTexture } from '../../src/renderer/render/gl/texture.ts';
import { assertEqual, assertThrowsGl, assertTrue, freshCanvas, type GpuCase } from './index.ts';

async function fboCompletenessAndErrors(): Promise<void> {
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;
    const boundBefore = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const assertQuiet = (what: string): void => {
      assertEqual(gl.getError(), gl.NO_ERROR, `${what} leaves no GL error`);
      assertEqual(gl.getParameter(gl.FRAMEBUFFER_BINDING), boundBefore, `${what} leaves the binding`);
    };

    // A one-attachment RGBA8 framebuffer is complete and readable.
    const main = createTexture2D(gl, { width: 8, height: 8, format: 'RGBA8' });
    try {
      const fb = createFramebuffer(gl, [main]);
      try {
        assertEqual(fb.width, 8, 'fbo width');
        assertEqual(fb.height, 8, 'fbo height');
        assertEqual(fb.attachments.length, 1, 'one attachment');
        fb.bind();
        const bound = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        assertEqual(bound, fb.fbo, 'bind() binds');
        const pixels = readTexels(gl, fb, 0, 0, 0, 8, 8);
        assertEqual(pixels.length, 8 * 8 * 4, 'full readback size');
      } finally {
        fb.dispose();
        fb.dispose();
      }
    } finally {
      main.dispose();
    }
    assertQuiet('complete fbo');

    // Two RGBA8 attachments of different sizes.
    const a = createTexture2D(gl, { width: 8, height: 8, format: 'RGBA8' });
    const b = createTexture2D(gl, { width: 4, height: 8, format: 'RGBA8' });
    try {
      assertThrowsGl('FRAMEBUFFER', () => createFramebuffer(gl, [a, b]), 'mismatched sizes');
      assertQuiet('mismatched sizes');
    } finally {
      a.dispose();
      b.dispose();
    }

    // Zero attachments: the explicit empty-list guard must fire (a weakened
    // guard still throws later, but with the wrong message).
    const zeroFailure = assertThrowsGl('FRAMEBUFFER', () => createFramebuffer(gl, []), 'zero attachments');
    assertTrue(
      zeroFailure.message.includes('need 1..'),
      `zero attachments guard message, got: ${zeroFailure.message}`,
    );
    assertQuiet('zero attachments');

    // More than MAX_COLOR_ATTACHMENTS.
    const maxAttachments = gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) as number;
    const many: GlTexture[] = [];
    try {
      for (let i = 0; i < maxAttachments + 1; i++) many.push(createTexture2D(gl, { width: 2, height: 2, format: 'RGBA8' }));
      assertThrowsGl('FRAMEBUFFER', () => createFramebuffer(gl, many), 'too many attachments');
      assertQuiet('too many attachments');
    } finally {
      for (const t of many) t.dispose();
    }

    // An attachment list with a disposed texture.
    const doomed = createTexture2D(gl, { width: 4, height: 4, format: 'RGBA8' });
    doomed.dispose();
    assertThrowsGl('FRAMEBUFFER', () => createFramebuffer(gl, [doomed]), 'disposed attachment');
    assertQuiet('disposed attachment');

    // readTexels validation table.
    const tex = createTexture2D(gl, { width: 8, height: 8, format: 'RGBA8' });
    try {
      const fb = createFramebuffer(gl, [tex]);
      try {
        assertThrowsGl('FRAMEBUFFER', () => readTexels(gl, fb, 0, -1, 0, 2, 2), 'negative x');
        assertThrowsGl('FRAMEBUFFER', () => readTexels(gl, fb, 0, 7, 0, 2, 2), 'rectangle outside');
        assertThrowsGl('FRAMEBUFFER', () => readTexels(gl, fb, 0, 0, 0, 0, 2), 'width 0');
        assertThrowsGl('FRAMEBUFFER', () => readTexels(gl, fb, 5, 0, 0, 2, 2), 'attachment index 5');
        assertQuiet('readTexels table');
      } finally {
        fb.dispose();
      }
    } finally {
      tex.dispose();
    }

    // Split READ/DRAW preservation across createFramebuffer (success and
    // forced-incomplete failure) and readTexels DRAW non-disturbance, with
    // distinct native FBOs on each binding.
    const splitTex = createTexture2D(gl, { width: 4, height: 4, format: 'RGBA8' });
    const oldRead = gl.createFramebuffer();
    const oldDraw = gl.createFramebuffer();
    assertTrue(oldRead !== null && oldDraw !== null && oldRead !== oldDraw, 'distinct native FBOs');
    try {
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, oldDraw);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, oldRead);
      assertTrue(
        gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) === oldRead &&
          gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) === oldDraw,
        'split bindings established',
      );
      // Success path preserves both bindings independently.
      const splitFb = createFramebuffer(gl, [splitTex]);
      try {
        assertEqual(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), oldRead, 'createFramebuffer success preserves READ');
        assertEqual(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), oldDraw, 'createFramebuffer success preserves DRAW');
        assertEqual(gl.getError(), gl.NO_ERROR, 'createFramebuffer success leaves no GL error');
        // readTexels must not disturb DRAW when independent bindings exist.
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, oldDraw);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, oldRead);
        readTexels(gl, splitFb, 0, 0, 0, 2, 2);
        assertEqual(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), oldDraw, 'readTexels preserves DRAW');
        assertEqual(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), oldRead, 'readTexels restores READ');
        assertEqual(gl.getError(), gl.NO_ERROR, 'readTexels split leaves no GL error');
      } finally {
        splitFb.dispose();
      }
      // Failure path: force one incomplete status; the failed allocation must
      // be deleted and both bindings left unchanged.
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, oldDraw);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, oldRead);
      const realCheck = gl.checkFramebufferStatus;
      const realDelete = gl.deleteFramebuffer;
      const deleted: WebGLFramebuffer[] = [];
      let forceIncomplete = true;
      const glAny = gl as unknown as {
        checkFramebufferStatus: (target: number) => number;
        deleteFramebuffer: (fb: WebGLFramebuffer | null) => void;
      };
      glAny.checkFramebufferStatus = (target: number): number => {
        if (forceIncomplete) {
          forceIncomplete = false;
          return gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
        }
        return realCheck.call(gl, target);
      };
      glAny.deleteFramebuffer = (fb: WebGLFramebuffer | null): void => {
        if (fb !== null) deleted.push(fb);
        realDelete.call(gl, fb);
      };
      try {
        assertThrowsGl('FRAMEBUFFER', () => createFramebuffer(gl, [splitTex]), 'forced incomplete');
      } finally {
        glAny.checkFramebufferStatus = realCheck;
        glAny.deleteFramebuffer = realDelete;
      }
      assertEqual(deleted.length, 1, 'failed allocation deleted once');
      assertEqual(gl.isFramebuffer(deleted[0] as WebGLFramebuffer), false, 'failed allocation gone');
      assertEqual(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), oldRead, 'createFramebuffer failure preserves READ');
      assertEqual(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), oldDraw, 'createFramebuffer failure preserves DRAW');
      assertEqual(gl.getError(), gl.NO_ERROR, 'createFramebuffer failure leaves no GL error');
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, boundBefore);
      if (oldRead !== null) gl.deleteFramebuffer(oldRead);
      if (oldDraw !== null) gl.deleteFramebuffer(oldDraw);
      splitTex.dispose();
    }
    assertQuiet('split bindings');
  } finally {
    context.dispose();
  }
}

export const fboCases: readonly GpuCase[] = [
  { name: 'fbo: completeness and errors', run: fboCompletenessAndErrors },
];

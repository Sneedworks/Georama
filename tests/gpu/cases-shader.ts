import { createGlContext } from '../../src/renderer/render/gl/context.ts';
import { createProgram, type ProgramSource } from '../../src/renderer/render/gl/shader.ts';
import { assertEqual, assertThrowsGl, assertTrue, freshCanvas, type GpuCase } from './index.ts';

const VERTEX = `#version 300 es
layout(location = 0) in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 u_color;
uniform float u_scale;
out vec4 o_out;
void main() { o_out = u_color * u_scale; }
`;

function validSource(): ProgramSource {
  return {
    label: 'shader-case-valid',
    vertex: VERTEX,
    fragment: FRAGMENT,
    uniforms: ['u_color', 'u_scale'],
    attributes: { a_pos: 0 },
  };
}

function assertClean(gl: WebGL2RenderingContext, what: string): void {
  assertEqual(gl.getError(), gl.NO_ERROR, `no pending GL error after ${what}`);
}

async function shaderCompileLinkUniforms(): Promise<void> {
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const gl = context.gl;
    // A valid program resolves both uniforms and binds.
    const program = createProgram(gl, validSource());
    try {
      assertTrue(program.uniforms['u_color'] instanceof WebGLUniformLocation, 'u_color location');
      assertTrue(program.uniforms['u_scale'] instanceof WebGLUniformLocation, 'u_scale location');
      program.use();
      assertEqual(gl.getParameter(gl.CURRENT_PROGRAM), program.program, 'use() binds the program');
    } finally {
      program.dispose();
      program.dispose();
    }
    assertClean(gl, 'valid program');

    // A broken fragment shader names the label and the stage and keeps a log.
    const badFragment = assertThrowsGl(
      'SHADER',
      () => createProgram(gl, { ...validSource(), label: 'shader-case-badfrag', fragment: 'this is not glsl (((' }),
      'broken fragment',
    );
    assertTrue(badFragment.message.includes('shader-case-badfrag'), 'fragment message names the label');
    assertTrue(badFragment.message.includes('fragment'), 'fragment message names the stage');
    assertTrue(badFragment.detail.length > 0, 'fragment detail is the info log');
    assertClean(gl, 'broken fragment');
    createProgram(gl, validSource()).dispose();

    // A broken vertex shader likewise.
    const badVertex = assertThrowsGl(
      'SHADER',
      () => createProgram(gl, { ...validSource(), label: 'shader-case-badvert', vertex: '### nope ###' }),
      'broken vertex',
    );
    assertTrue(badVertex.message.includes('shader-case-badvert'), 'vertex message names the label');
    assertTrue(badVertex.message.includes('vertex'), 'vertex message names the stage');
    assertTrue(badVertex.detail.length > 0, 'vertex detail is the info log');
    assertClean(gl, 'broken vertex');
    createProgram(gl, validSource()).dispose();

    // A type mismatch between vertex output and fragment input fails the link.
    assertThrowsGl(
      'PROGRAM',
      () =>
        createProgram(gl, {
          label: 'shader-case-badlink',
          vertex: `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec4 v_color;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); v_color = vec4(1.0); }
`,
          fragment: `#version 300 es
precision highp float;
in float v_color;
out vec4 o_out;
void main() { o_out = vec4(v_color); }
`,
        }),
      'link failure',
    );
    assertClean(gl, 'link failure');
    createProgram(gl, validSource()).dispose();

    // A requested uniform that does not exist names it.
    const missing = assertThrowsGl(
      'PROGRAM',
      () => createProgram(gl, { ...validSource(), label: 'shader-case-nouniform', uniforms: ['u_color', 'u_missing'] }),
      'missing uniform',
    );
    assertTrue(missing.message.includes('u_missing'), 'missing uniform is named');
    assertClean(gl, 'missing uniform');
    createProgram(gl, validSource()).dispose();
  } finally {
    context.dispose();
  }
}

export const shaderCases: readonly GpuCase[] = [
  { name: 'shader: compile, link, uniforms', run: shaderCompileLinkUniforms },
];

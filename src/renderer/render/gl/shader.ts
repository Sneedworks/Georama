import { GlError } from './errors.ts';

export interface ProgramSource {
  readonly label: string;
  readonly vertex: string;
  readonly fragment: string;
  readonly uniforms?: readonly string[];
  readonly attributes?: Readonly<Record<string, number>>;
}

export interface GlProgram {
  readonly program: WebGLProgram;
  readonly label: string;
  readonly uniforms: Readonly<Record<string, WebGLUniformLocation>>;
  use(): void;
  dispose(): void;
}

function compileStage(
  gl: WebGL2RenderingContext,
  label: string,
  stage: 'vertex' | 'fragment',
  kind: number,
  source: string,
  owned: { shaders: WebGLShader[]; program: WebGLProgram | null },
): WebGLShader {
  const shader = gl.createShader(kind);
  if (shader === null) {
    throw new GlError('SHADER', `${label}: ${stage} shader creation failed`, '');
  }
  owned.shaders.push(shader);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    for (const ownedShader of owned.shaders) gl.deleteShader(ownedShader);
    owned.shaders = [];
    if (owned.program !== null) {
      gl.deleteProgram(owned.program);
      owned.program = null;
    }
    throw new GlError('SHADER', `${label}: ${stage} shader failed`, log);
  }
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, source: ProgramSource): GlProgram {
  if (typeof gl !== 'object' || gl === null) {
    throw new GlError('PROGRAM', 'createProgram: gl must be a WebGL2RenderingContext');
  }
  if (typeof source !== 'object' || source === null) {
    throw new GlError('PROGRAM', 'createProgram: source must be an object');
  }
  if (typeof source.label !== 'string' || source.label.length === 0) {
    throw new GlError('PROGRAM', 'createProgram: source.label must be a non-empty string');
  }
  const label = source.label;
  if (typeof source.vertex !== 'string' || typeof source.fragment !== 'string') {
    throw new GlError('SHADER', `${label}: vertex and fragment sources must be strings`, '');
  }
  const wantUniforms = source.uniforms ?? [];
  if (!Array.isArray(wantUniforms)) {
    throw new GlError('PROGRAM', `${label}: uniforms must be an array`);
  }
  for (const name of wantUniforms) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new GlError('PROGRAM', `${label}: invalid uniform name`);
    }
  }
  const wantAttributes = source.attributes ?? {};
  if (typeof wantAttributes !== 'object' || wantAttributes === null || Array.isArray(wantAttributes)) {
    throw new GlError('PROGRAM', `${label}: attributes must be an object`);
  }
  for (const [name, location] of Object.entries(wantAttributes)) {
    if (typeof location !== 'number' || !Number.isInteger(location) || location < 0) {
      throw new GlError('PROGRAM', `${label}: invalid attribute location for ${name}`);
    }
  }
  const owned: { shaders: WebGLShader[]; program: WebGLProgram | null } = { shaders: [], program: null };
  const failProgram = (message: string, detail: string): never => {
    for (const ownedShader of owned.shaders) gl.deleteShader(ownedShader);
    owned.shaders = [];
    if (owned.program !== null) {
      gl.deleteProgram(owned.program);
      owned.program = null;
    }
    throw new GlError('PROGRAM', message, detail);
  };
  compileStage(gl, label, 'vertex', gl.VERTEX_SHADER, source.vertex, owned);
  compileStage(gl, label, 'fragment', gl.FRAGMENT_SHADER, source.fragment, owned);
  const program = gl.createProgram();
  if (program === null) failProgram(`${label}: link failed`, 'createProgram returned null');
  owned.program = program;
  for (const shader of owned.shaders) gl.attachShader(program, shader);
  for (const [name, location] of Object.entries(wantAttributes)) {
    gl.bindAttribLocation(program, location, name);
  }
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    failProgram(`${label}: link failed`, gl.getProgramInfoLog(program) ?? '');
  }
  const uniforms: Record<string, WebGLUniformLocation> = {};
  for (const name of wantUniforms) {
    const location = gl.getUniformLocation(program, name);
    if (location !== null) {
      uniforms[name] = location;
    } else {
      failProgram(`${label}: no uniform ${name}`, '');
    }
  }
  for (const shader of owned.shaders) {
    gl.detachShader(program, shader);
    gl.deleteShader(shader);
  }
  owned.shaders = [];
  owned.program = null;
  let disposed = false;
  return {
    program,
    label,
    uniforms: Object.freeze(uniforms),
    use: () => {
      gl.useProgram(program);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      gl.deleteProgram(program);
    },
  };
}

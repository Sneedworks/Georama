import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'vite';

type AstNode = { type: string; [key: string]: unknown };
type Stage = 'vert' | 'frag';
const VERSION_LINE = /(?:^|\n)\s*#version\s+\d+/;

export interface GlslSource {
  readonly name: string;
  readonly stage: Stage;
  readonly source: string;
  readonly file: string;
}

function identifierName(node: unknown): string | null {
  if (node === null || typeof node !== 'object') return null;
  const value = node as AstNode;
  if (value.type === 'Identifier' && typeof value.name === 'string') return value.name;
  if (value.type === 'Literal' && typeof value.value === 'string') return value.value;
  return null;
}

function shaderStage(name: string, file: string): Stage {
  const vertex = /(?:^|_)(?:VERTEX|VERT)(?:_|$)/i.test(name) || /^vertex$/i.test(name);
  const fragment = /(?:^|_)(?:FRAGMENT|FRAG)(?:_|$)/i.test(name) || /^fragment$/i.test(name);
  if (vertex === fragment) throw new Error(`${file}: cannot determine GLSL stage for ${name}`);
  return vertex ? 'vert' : 'frag';
}

export function extractGlslSources(code: string, file: string): GlslSource[] {
  const ast = parseAst(code, { lang: 'ts' }) as unknown as AstNode;
  const shaders: GlslSource[] = [];

  function visit(value: unknown, context = ''): void {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, context);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const node = value as AstNode;

    if (node.type === 'VariableDeclarator') {
      visit(node.init, identifierName(node.id) ?? context);
      return;
    }
    if (node.type === 'Property' || node.type === 'PropertyDefinition') {
      visit(node.value, identifierName(node.key) ?? context);
      return;
    }

    let source: string | null = null;
    if (node.type === 'TemplateLiteral') {
      const quasis = node.quasis as { value: { cooked: string | null; raw: string } }[];
      const first = quasis[0]?.value;
      if (first && VERSION_LINE.test(first.cooked ?? first.raw)) {
        const expressions = node.expressions as unknown[];
        if (expressions.length) throw new Error(`${file}: interpolated GLSL is unsupported (${context})`);
        if (first.cooked === null) throw new Error(`${file}: invalid escape in GLSL template (${context})`);
        source = first.cooked;
      }
    } else if (node.type === 'Literal' && typeof node.value === 'string') {
      if (VERSION_LINE.test(node.value)) source = node.value;
    }

    if (source !== null) {
      shaders.push({ name: context, stage: shaderStage(context, file), source, file });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== 'type' && key !== 'start' && key !== 'end') visit(child, context);
    }
  }

  visit(ast);
  return shaders;
}

function collectShaders(root: string): GlslSource[] {
  const shaders: GlslSource[] = [];
  function scan(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (entry.isFile() && path.endsWith('.ts')) {
        const name = relative(process.cwd(), path);
        shaders.push(...extractGlslSources(readFileSync(path, 'utf8'), name));
      }
    }
  }
  scan(root);
  if (shaders.length === 0) throw new Error(`No GLSL shaders found under ${root}`);
  return shaders;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--source-dir')) {
    throw new Error('Usage: node scripts/check-glsl.ts [--source-dir <directory>]');
  }
  const root = args.length === 2 ? resolve(args[1] as string) : resolve(import.meta.dirname, '../src/renderer');
  const shaders = collectShaders(root);
  const tmp = mkdtempSync(join(tmpdir(), 'georama-glsl-'));
  let failed = 0;
  try {
    for (const [index, shader] of shaders.entries()) {
      const path = join(tmp, `${index}.${shader.stage}`);
      writeFileSync(path, shader.source);
      const result = spawnSync('glslangValidator', ['-S', shader.stage, path], { encoding: 'utf8' });
      if (result.error) {
        if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error('glslangValidator not found in PATH; install glslang-tools (see docs/DEV.md)');
        }
        throw result.error;
      }
      if (result.status !== 0) {
        failed++;
        console.error(`GLSL FAIL ${shader.file}:${shader.name} (${shader.stage})`);
        console.error(`${result.stdout}${result.stderr}`.replaceAll(path, basename(path)).trim());
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (failed) throw new Error(`${failed}/${shaders.length} GLSL shaders failed validation`);
  console.log(`GLSL OK: ${shaders.length} shaders compiled (${shaders.filter(s => s.stage === 'vert').length} vertex, ${shaders.filter(s => s.stage === 'frag').length} fragment)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`GLSL check: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

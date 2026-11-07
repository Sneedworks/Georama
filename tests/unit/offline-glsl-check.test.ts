import { describe, expect, it } from 'vitest';
import { extractGlslSources } from '../../scripts/check-glsl.ts';

describe('offline GLSL extraction', () => {
  it('finds and classifies vertex and fragment shaders in TypeScript strings', () => {
    const code = [
      'export const TEST_VERTEX = `#version 300 es\\nvoid main() {}\\n`;',
      'const TEST_FRAGMENT = "#version 300 es\\nvoid main() {}\\n";',
    ].join('\n');
    expect(extractGlslSources(code, 'example.ts').map(({ name, stage }) => ({ name, stage }))).toEqual([
      { name: 'TEST_VERTEX', stage: 'vert' },
      { name: 'TEST_FRAGMENT', stage: 'frag' },
    ]);
  });

  it('ignores unrelated strings and commented-out shader examples', () => {
    const code = '// const OLD_VERTEX = `#version 300 es`\nconst text = `not GLSL`;';
    expect(extractGlslSources(code, 'example.ts')).toEqual([]);
  });

  it('recognizes a shader with a GLSL comment before the version directive', () => {
    const code = 'const TEST_VERTEX = `// introductory comment\n#version 300 es\nvoid main() {}`;';
    expect(extractGlslSources(code, 'example.ts').map(({ stage }) => stage)).toEqual(['vert']);
  });

  it('rejects interpolated shaders rather than silently dropping them', () => {
    const code = 'const TEST_FRAGMENT = `#version 300 es\\n${part}\\nvoid main() {}`;';
    expect(() => extractGlslSources(code, 'example.ts')).toThrow(/interpolat/i);
  });

  it('rejects a shader whose stage cannot be determined', () => {
    const code = 'const shader = `#version 300 es\\nvoid main() {}`;';
    expect(() => extractGlslSources(code, 'example.ts')).toThrow(/stage/i);
  });
});

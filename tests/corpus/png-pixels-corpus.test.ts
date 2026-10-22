import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePngRgba8 } from '../../src/core/assets/png-pixels.ts';
import { readPngInfo } from '../../src/core/assets/png.ts';

const file = process.env.GEORAMA_PNG_FILE as string | undefined;

describe.skipIf(!file)('png pixels corpus', () => {
  it('decodes the reference file', () => {
    const bytes = new Uint8Array(readFileSync(file as string));
    const info = readPngInfo(bytes);
    const decoded = decodePngRgba8(bytes);
    expect(decoded.width).toBe(info.width);
    expect(decoded.height).toBe(info.height);
    expect(decoded.rgba.length).toBe(decoded.width * decoded.height * 4);
    let lo = 255;
    let hi = 0;
    for (let i = 3; i < decoded.rgba.length; i += 4) {
      const alpha = decoded.rgba[i];
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(255);
      if (alpha < lo) lo = alpha;
      if (alpha > hi) hi = alpha;
    }
    console.log(`PNG pixels ok: colour=${info.colorType} alpha-min=${lo} alpha-max=${hi}`);
  });
});

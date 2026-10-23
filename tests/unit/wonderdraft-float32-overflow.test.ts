import { describe, expect, it } from 'vitest';
import { WdSchemaError, writeColor, writeVec2 } from '../../src/core/formats/wonderdraft-map-engine.ts';

describe('Wonderdraft float32 math serialization', () => {
  it.each([
    [{ x: 1e308, y: 0 }, '/symbol/position'],
    [{ x: 0, y: -1e308 }, '/symbol/offset'],
  ])('rejects finite Vec2 components that overflow float32', (value, path) => {
    expect(() => writeVec2(value, path)).toThrowError(WdSchemaError);
    try {
      writeVec2(value, path);
    } catch (error) {
      expect(error).toMatchObject({ code: 'FORMAT', path });
    }
  });

  it.each([
    [{ r: 1e308, g: 0, b: 0, a: 1 }, '/theme/coastline_color'],
    [{ r: 0, g: 0, b: 0, a: -1e308 }, '/theme/path_color'],
  ])('rejects finite Color components that overflow float32', (value, path) => {
    expect(() => writeColor(value, path)).toThrowError(WdSchemaError);
    try {
      writeColor(value, path);
    } catch (error) {
      expect(error).toMatchObject({ code: 'FORMAT', path });
    }
  });

  it('accepts representable large Vec2 components', () => {
    const value = writeVec2({ x: 1e30, y: -1e30 }, '/v');
    expect(Array.from(value.v).every(Number.isFinite)).toBe(true);
  });

  it('accepts representable large Color components', () => {
    const value = writeColor({ r: 1e30, g: -1e30, b: 0, a: 1 }, '/c');
    expect(Array.from(value.v).every(Number.isFinite)).toBe(true);
  });
});

// 0.11b symbols GPU draw: portable atlas pixels + CPU reference (T1-T11, C10).
import { describe, expect, it } from 'vitest';
import { decodePngRgba8, PngPixelError } from '../../src/core/assets/png-pixels.ts';
import {
  AtlasPixelError,
  buildAtlasPixels,
  cpuReference,
  textureClassAfterDecode,
} from '../../src/core/symbols/pixels.ts';

const PAGE = 32;
const RESERVED = { key: '', page: 0, x: 0, y: 0, width: 16, height: 16 };

function atlasFor(placements: readonly { key: string; page: number; x: number; y: number; width: number; height: number }[], pages = 1) {
  return { pageSize: PAGE, pages, reserved: RESERVED, placements, oversize: [] as string[] };
}

function texel(page: Uint8Array, x: number, y: number): [number, number, number, number] {
  const i = (y * PAGE + x) * 4;
  return [page[i], page[i + 1], page[i + 2], page[i + 3]];
}

function outTexel(out: Uint8Array, width: number, x: number, y: number): [number, number, number, number] {
  const i = (y * width + x) * 4;
  return [out[i], out[i + 1], out[i + 2], out[i + 3]];
}

// 3x2 image with distinct texels: row r, col c -> (10 + 30c + r, 20 + 30c + r, 30 + 30c + r, 255).
function image32(): Uint8Array {
  const rgba = new Uint8Array(3 * 2 * 4);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const i = (r * 3 + c) * 4;
      rgba[i] = 10 + 30 * c + r;
      rgba[i + 1] = 20 + 30 * c + r;
      rgba[i + 2] = 30 + 30 * c + r;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

// 2x2 image: (0,0) red, (1,0) green, (0,1) blue, (1,1) white.
function image22(): Uint8Array {
  return new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
  ]);
}

function recordOf(o: {
  a00: number; a01: number; a10: number; a11: number; tx: number; ty: number;
  u0: number; v0: number; w: number; h: number; r: number; g: number; b: number; a: number;
}): Float32Array {
  return new Float32Array([o.a00, o.a01, o.a10, o.a11, o.tx, o.ty, o.u0, o.v0, o.w, o.h, 0, o.r, o.g, o.b, o.a, 0]);
}

describe('T1 placement', () => {
  it('a 3x2 image at (u0,v0) appears at exactly those texels; padding is transparent', () => {
    const page = buildAtlasPixels(
      [{ key: 'test/sprite-a', width: 3, height: 2, rgba: image32() }],
      atlasFor([{ key: 'test/sprite-a', page: 0, x: 17, y: 5, width: 3, height: 2 }]),
    );
    expect(page.length).toBe(PAGE * PAGE * 4);
    expect(texel(page, 17, 5)).toEqual([10, 20, 30, 255]);
    expect(texel(page, 18, 5)).toEqual([40, 50, 60, 255]);
    expect(texel(page, 19, 5)).toEqual([70, 80, 90, 255]);
    expect(texel(page, 17, 6)).toEqual([11, 21, 31, 255]);
    expect(texel(page, 18, 6)).toEqual([41, 51, 61, 255]);
    expect(texel(page, 19, 6)).toEqual([71, 81, 91, 255]);
    expect(texel(page, 16, 5)).toEqual([0, 0, 0, 0]);
    expect(texel(page, 20, 5)).toEqual([0, 0, 0, 0]);
    expect(texel(page, 17, 4)).toEqual([0, 0, 0, 0]);
    expect(texel(page, 17, 7)).toEqual([0, 0, 0, 0]);
  });
});

describe('T2 reserved block', () => {
  it('is opaque white; every other non-placement texel is transparent', () => {
    const page = buildAtlasPixels(
      [{ key: 'test/sprite-a', width: 2, height: 2, rgba: image22() }],
      atlasFor([{ key: 'test/sprite-a', page: 0, x: 20, y: 20, width: 2, height: 2 }]),
    );
    expect(texel(page, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(texel(page, 15, 15)).toEqual([255, 255, 255, 255]);
    expect(texel(page, 7, 9)).toEqual([255, 255, 255, 255]);
    expect(texel(page, 16, 0)).toEqual([0, 0, 0, 0]);
    expect(texel(page, 0, 16)).toEqual([0, 0, 0, 0]);
    expect(texel(page, 19, 20 - 1)).toEqual([0, 0, 0, 0]);
    expect(texel(page, 31, 31)).toEqual([0, 0, 0, 0]);
  });
});

describe('T3 dimension mismatch', () => {
  it('throws a typed INPUT error that names the key', () => {
    let caught: unknown = null;
    try {
      buildAtlasPixels(
        [{ key: 'test/sprite-a', width: 3, height: 3, rgba: new Uint8Array(3 * 3 * 4).fill(7) }],
        atlasFor([{ key: 'test/sprite-a', page: 0, x: 17, y: 5, width: 2, height: 2 }]),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AtlasPixelError);
    expect((caught as AtlasPixelError).code).toBe('INPUT');
    expect((caught as AtlasPixelError).message).toContain('test/sprite-a');
  });
});

describe('T4 order', () => {
  it('shuffled items give a byte-identical page', () => {
    const a = { key: 'test/sprite-a', width: 2, height: 2, rgba: image22() };
    const b = { key: 'test/sprite-b', width: 3, height: 1, rgba: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255]) };
    const placements = [
      { key: 'test/sprite-a', page: 0, x: 16, y: 0, width: 2, height: 2 },
      { key: 'test/sprite-b', page: 0, x: 20, y: 5, width: 3, height: 1 },
    ];
    const fwd = buildAtlasPixels([a, b], atlasFor(placements));
    const rev = buildAtlasPixels([b, a], atlasFor([...placements].reverse()));
    expect(rev).toEqual(fwd);
  });
});

describe('T5 CPU reference identity', () => {
  it('the centre texel lands where C2 says', () => {
    const page = buildAtlasPixels(
      [{ key: 'test/sprite-a', width: 2, height: 2, rgba: image22() }],
      atlasFor([{ key: 'test/sprite-a', page: 0, x: 16, y: 10, width: 2, height: 2 }]),
    );
    const out = cpuReference(
      page, PAGE,
      recordOf({ a00: 1, a01: 0, a10: 0, a11: 1, tx: 2, ty: 2, u0: 16, v0: 10, w: 2, h: 2, r: 1, g: 1, b: 1, a: 1 }),
      4, 4,
    );
    // Window (1,1) centre (1.5,1.5): p = (-0.5,-0.5) -> atlas (16.5,10.5) -> texel (16,10) = red.
    expect(outTexel(out, 4, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(outTexel(out, 4, 2, 1)).toEqual([0, 255, 0, 255]);
    expect(outTexel(out, 4, 1, 2)).toEqual([0, 0, 255, 255]);
    expect(outTexel(out, 4, 2, 2)).toEqual([255, 255, 255, 255]);
    expect(outTexel(out, 4, 3, 3)).toEqual([0, 0, 0, 0]);
  });
});

describe('T6 rotation by 90 degrees', () => {
  it('texel mapping and the inside test on known pixels', () => {
    const page = buildAtlasPixels(
      [{ key: 'test/sprite-a', width: 2, height: 2, rgba: image22() }],
      atlasFor([{ key: 'test/sprite-a', page: 0, x: 16, y: 10, width: 2, height: 2 }]),
    );
    const out = cpuReference(
      page, PAGE,
      recordOf({ a00: 0, a01: -1, a10: 1, a11: 0, tx: 2, ty: 2, u0: 16, v0: 10, w: 2, h: 2, r: 1, g: 1, b: 1, a: 1 }),
      5, 5,
    );
    // q=(2.5,1.5): p=(-0.5,-0.5) -> red. q=(2.5,2.5): p=(0.5,-0.5) -> green.
    // q=(1.5,2.5): p=(0.5,0.5) -> white. (0,0) is outside the rotated quad.
    expect(outTexel(out, 5, 2, 1)).toEqual([255, 0, 0, 255]);
    expect(outTexel(out, 5, 2, 2)).toEqual([0, 255, 0, 255]);
    expect(outTexel(out, 5, 1, 2)).toEqual([255, 255, 255, 255]);
    expect(outTexel(out, 5, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe('T7 negative x scale', () => {
  it('texel order is reversed under mirror', () => {
    const page = buildAtlasPixels(
      [{ key: 'test/sprite-a', width: 2, height: 2, rgba: image22() }],
      atlasFor([{ key: 'test/sprite-a', page: 0, x: 16, y: 10, width: 2, height: 2 }]),
    );
    const out = cpuReference(
      page, PAGE,
      recordOf({ a00: -1, a01: 0, a10: 0, a11: 1, tx: 2, ty: 1, u0: 16, v0: 10, w: 2, h: 2, r: 1, g: 1, b: 1, a: 1 }),
      4, 3,
    );
    expect(outTexel(out, 4, 1, 0)).toEqual([0, 255, 0, 255]);
    expect(outTexel(out, 4, 2, 0)).toEqual([255, 0, 0, 255]);
  });
});

describe('T8 premultiplied over', () => {
  it('two overlapping instances blend to known values', () => {
    const page = buildAtlasPixels(
      [{ key: 'test/sprite-a', width: 2, height: 2, rgba: image22() }],
      atlasFor([{ key: 'test/sprite-a', page: 0, x: 16, y: 10, width: 2, height: 2 }]),
    );
    const records = new Float32Array(32);
    records.set(recordOf({ a00: 1, a01: 0, a10: 0, a11: 1, tx: 1, ty: 1, u0: 16, v0: 10, w: 2, h: 2, r: 1, g: 1, b: 1, a: 1 }), 0);
    records.set(recordOf({ a00: 1, a01: 0, a10: 0, a11: 1, tx: 2, ty: 1, u0: 16, v0: 10, w: 2, h: 2, r: 1, g: 1, b: 1, a: 0.5 }), 16);
    const out = cpuReference(page, PAGE, records, 4, 4);
    // (0,0): only instance 1, red texel, opaque.
    expect(outTexel(out, 4, 0, 0)).toEqual([255, 0, 0, 255]);
    // (1,0): red at a=0.5 over green opaque -> (0.5,0.5,0,1) -> (128,128,0,255).
    expect(outTexel(out, 4, 1, 0)).toEqual([128, 128, 0, 255]);
    // (2,0): only instance 2, green texel at a=0.5 over transparent -> (0,128,0,128).
    expect(outTexel(out, 4, 2, 0)).toEqual([0, 128, 0, 128]);
    expect(outTexel(out, 4, 3, 3)).toEqual([0, 0, 0, 0]);
  });
});

describe('T9 placeholder', () => {
  it('samples white times the record colour through the reserved block', () => {
    const page = buildAtlasPixels([], atlasFor([]));
    const out = cpuReference(
      page, PAGE,
      recordOf({ a00: 1, a01: 0, a10: 0, a11: 1, tx: 8, ty: 8, u0: 0, v0: 0, w: 16, h: 16, r: 0, g: 1, b: 1, a: 1 }),
      20, 20,
    );
    expect(outTexel(out, 20, 8, 8)).toEqual([0, 255, 255, 255]);
    expect(outTexel(out, 20, 0, 0)).toEqual([0, 255, 255, 255]);
    expect(outTexel(out, 20, 16, 8)).toEqual([0, 0, 0, 0]);
  });
});

describe('T10 edge', () => {
  it('a pixel centre 0.5 px outside an edge is outside', () => {
    const page = buildAtlasPixels(
      [{ key: 'test/sprite-a', width: 2, height: 2, rgba: image22() }],
      atlasFor([{ key: 'test/sprite-a', page: 0, x: 16, y: 10, width: 2, height: 2 }]),
    );
    const out = cpuReference(
      page, PAGE,
      recordOf({ a00: 1, a01: 0, a10: 0, a11: 1, tx: 2, ty: 2, u0: 16, v0: 10, w: 2, h: 2, r: 1, g: 1, b: 1, a: 1 }),
      4, 4,
    );
    // Quad x in [1,3]: pixel (0,1) centre x=0.5 is 0.5 px outside; (1,1) is inside.
    expect(outTexel(out, 4, 0, 1)).toEqual([0, 0, 0, 0]);
    expect(outTexel(out, 4, 1, 1)).toEqual([255, 0, 0, 255]);
  });
});

describe('T11 decode failure', () => {
  it('a rejected pack image maps its symbol to the invalid class (C8)', () => {
    let code: string | null = null;
    try {
      decodePngRgba8(new Uint8Array([1, 2, 3]));
    } catch (error) {
      expect(error).toBeInstanceOf(PngPixelError);
      code = (error as PngPixelError).code;
    }
    expect(code).toBe('signature');
    const texture = 'res://sprites/test/sprite-a';
    expect(textureClassAfterDecode(texture, false).class).toBe('asset');
    const failed = textureClassAfterDecode(texture, true);
    expect(failed.class).toBe('invalid');
    expect(textureClassAfterDecode({}, true).class).toBe('embedded');
  });
});

describe('C10 one page', () => {
  it('a placement off page 0 stops with LIMIT', () => {
    let caught: unknown = null;
    try {
      buildAtlasPixels(
        [{ key: 'test/sprite-a', width: 2, height: 2, rgba: image22() }],
        atlasFor([{ key: 'test/sprite-a', page: 1, x: 0, y: 0, width: 2, height: 2 }], 2),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AtlasPixelError);
    expect((caught as AtlasPixelError).code).toBe('LIMIT');
  });
});

// 0.11b parent pins (sweep 1): boundary, blend and degenerate cases that T1-T11 did not pin.
describe('sweep pins (boundaries, blend, degenerate)', () => {
  function lookupAt(placements: { key: string; page: number; x: number; y: number; width: number; height: number }[]) {
    return { pageSize: PAGE, pages: 1, reserved: { x: 16, y: 16, width: 16, height: 16 }, placements, oversize: [] as string[] };
  }

  function redSquare3(): Uint8Array {
    const rgba = new Uint8Array(3 * 3 * 4);
    for (let i = 0; i < 9; i++) rgba.set([255, 0, 0, 255], i * 4);
    return rgba;
  }

  // Unit square of a 3x3 quad at (2,2): edges at x = 0.5 and 3.5, y = 0.5 and 3.5.
  function squareRecord(r: number, g: number, b: number, a: number): Float32Array {
    return recordOf({ a00: 1, a01: 0, a10: 0, a11: 1, tx: 2, ty: 2, u0: 0, v0: 0, w: 3, h: 3, r, g, b, a });
  }

  it('a placement at the page corner (0,0) is accepted and painted', () => {
    const lookup = lookupAt([{ key: 'corner', page: 0, x: 0, y: 0, width: 3, height: 2 }]);
    let page: Uint8Array = new Uint8Array(0);
    expect(() => {
      page = buildAtlasPixels([{ key: 'corner', width: 3, height: 2, rgba: image32() }], lookup);
    }).not.toThrow();
    expect(texel(page, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(texel(page, 2, 1)).toEqual([71, 81, 91, 255]);
  });

  it('a placement and the reserved block flush to the far edge are accepted and painted', () => {
    const rgba = new Uint8Array(4 * 4 * 4);
    rgba.set([7, 8, 9, 255], (3 * 4 + 3) * 4);
    const lookup = {
      pageSize: PAGE, pages: 1, reserved: { x: 16, y: 0, width: 16, height: 16 },
      placements: [{ key: 'edge', page: 0, x: 28, y: 28, width: 4, height: 4 }], oversize: [] as string[],
    };
    let page: Uint8Array = new Uint8Array(0);
    expect(() => {
      page = buildAtlasPixels([{ key: 'edge', width: 4, height: 4, rgba }], lookup);
    }).not.toThrow();
    expect(texel(page, 31, 31)).toEqual([7, 8, 9, 255]);
    expect(texel(page, 31, 0)).toEqual([255, 255, 255, 255]);
  });

  it('overlapping placements paint in key order, the later key on top', () => {
    const red = new Uint8Array(2 * 2 * 4);
    const blue = new Uint8Array(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      red.set([255, 0, 0, 255], i * 4);
      blue.set([0, 0, 255, 255], i * 4);
    }
    const lookup = lookupAt([
      { key: 'a', page: 0, x: 0, y: 0, width: 2, height: 2 },
      { key: 'b', page: 0, x: 1, y: 0, width: 2, height: 2 },
    ]);
    const page = buildAtlasPixels(
      [{ key: 'b', width: 2, height: 2, rgba: blue }, { key: 'a', width: 2, height: 2, rgba: red }],
      lookup,
    );
    expect(texel(page, 1, 0)).toEqual([0, 0, 255, 255]);
    expect(texel(page, 0, 0)).toEqual([255, 0, 0, 255]);
  });

  it('a decoded height that differs from the placement is INPUT even when the width matches', () => {
    const lookup = lookupAt([{ key: 'h', page: 0, x: 4, y: 4, width: 3, height: 2 }]);
    let code = '';
    try {
      buildAtlasPixels([{ key: 'h', width: 3, height: 3, rgba: new Uint8Array(3 * 3 * 4) }], lookup);
    } catch (e) {
      code = (e as AtlasPixelError).code;
    }
    expect(code).toBe('INPUT');
  });

  it('a pixel buffer longer than width x height x 4 is INPUT', () => {
    const lookup = lookupAt([{ key: 'long', page: 0, x: 4, y: 4, width: 3, height: 2 }]);
    expect(() =>
      buildAtlasPixels([{ key: 'long', width: 3, height: 2, rgba: new Uint8Array(3 * 2 * 4 + 4) }], lookup),
    ).toThrow('invalid image bytes for long');
  });

  it('a pixel centre exactly on the left edge of a quad is inside (exact reference, C6 tie rule)', () => {
    const page = buildAtlasPixels(
      [{ key: 'red', width: 3, height: 3, rgba: redSquare3() }],
      lookupAt([{ key: 'red', page: 0, x: 0, y: 0, width: 3, height: 3 }]),
    );
    const out = cpuReference(page, PAGE, squareRecord(1, 1, 1, 1), 4, 4);
    expect(outTexel(out, 4, 0, 1)).toEqual([255, 0, 0, 255]);
  });

  it('a pixel centre exactly on the right edge is outside (sampled index equals u0 + w)', () => {
    const blue = new Uint8Array(1 * 3 * 4);
    for (let i = 0; i < 3; i++) blue.set([0, 0, 255, 255], i * 4);
    const lookup = lookupAt([
      { key: 'red', page: 0, x: 0, y: 0, width: 3, height: 3 },
      { key: 'blue', page: 0, x: 3, y: 0, width: 1, height: 3 },
    ]);
    const page = buildAtlasPixels(
      [{ key: 'red', width: 3, height: 3, rgba: redSquare3() }, { key: 'blue', width: 1, height: 3, rgba: blue }],
      lookup,
    );
    const out = cpuReference(page, PAGE, squareRecord(1, 1, 1, 1), 4, 4);
    expect(outTexel(out, 4, 3, 1)).toEqual([0, 0, 0, 0]);
    expect(outTexel(out, 4, 2, 1)).toEqual([255, 0, 0, 255]);
  });

  it('a zero-area instance is skipped and leaves earlier output unchanged', () => {
    const page = buildAtlasPixels(
      [{ key: 'red', width: 3, height: 3, rgba: redSquare3() }],
      lookupAt([{ key: 'red', page: 0, x: 0, y: 0, width: 3, height: 3 }]),
    );
    const good = squareRecord(1, 1, 1, 1);
    const degenerate = recordOf({ a00: 0, a01: 0, a10: 0, a11: 0, tx: 2, ty: 2, u0: 0, v0: 0, w: 3, h: 3, r: 1, g: 1, b: 1, a: 1 });
    const both = new Float32Array(32);
    both.set(good, 0);
    both.set(degenerate, 16);
    expect(cpuReference(page, PAGE, both, 4, 4)).toEqual(cpuReference(page, PAGE, good, 4, 4));
  });

  it('the red channel blends with the destination red, not only the alpha', () => {
    const page = buildAtlasPixels(
      [{ key: 'w', width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 255]) }],
      lookupAt([{ key: 'w', page: 0, x: 0, y: 0, width: 1, height: 1 }]),
    );
    const records = new Float32Array(32);
    records.set(recordOf({ a00: 1, a01: 0, a10: 0, a11: 1, tx: 0.5, ty: 0.5, u0: 0, v0: 0, w: 1, h: 1, r: 1, g: 0, b: 0, a: 1 }), 0);
    records.set(recordOf({ a00: 1, a01: 0, a10: 0, a11: 1, tx: 0.5, ty: 0.5, u0: 0, v0: 0, w: 1, h: 1, r: 0, g: 0, b: 1, a: 0.5 }), 16);
    expect(outTexel(cpuReference(page, PAGE, records, 1, 1), 1, 0, 0)).toEqual([128, 0, 128, 255]);
  });

  it('the alpha channel blends with a partly transparent destination', () => {
    const page = buildAtlasPixels(
      [{ key: 'w', width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 255]) }],
      lookupAt([{ key: 'w', page: 0, x: 0, y: 0, width: 1, height: 1 }]),
    );
    const half = { a00: 1, a01: 0, a10: 0, a11: 1, tx: 0.5, ty: 0.5, u0: 0, v0: 0, w: 1, h: 1, r: 1, g: 1, b: 1, a: 0.5 };
    const records = new Float32Array(32);
    records.set(recordOf(half), 0);
    records.set(recordOf(half), 16);
    expect(outTexel(cpuReference(page, PAGE, records, 1, 1), 1, 0, 0)).toEqual([191, 191, 191, 191]);
  });
});

// Correction (review follow-up; card C1 and T2): a placement that overlaps the
// reserved block would overwrite opaque white. It is rejected with INPUT.
// Placements that only touch the block on a side are accepted.
describe('C1 reserved block is never overwritten (T2)', () => {
  it('a placement overlapping the reserved block is rejected with INPUT', () => {
    const cases = [
      { x: 8, y: 8 }, // inside the block
      { x: 15, y: 15 }, // corner overlap
      { x: 0, y: 14 }, // bottom-left overlap
      { x: 15, y: 10 }, // one column into the block on the right edge
      { x: 10, y: 15 }, // one row into the block on the bottom edge
    ];
    for (const at of cases) {
      let caught: unknown = null;
      try {
        buildAtlasPixels(
          [{ key: 'test/sprite-a', width: 2, height: 2, rgba: image22() }],
          atlasFor([{ key: 'test/sprite-a', page: 0, x: at.x, y: at.y, width: 2, height: 2 }]),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AtlasPixelError);
      expect((caught as AtlasPixelError).code).toBe('INPUT');
      expect((caught as AtlasPixelError).message).toContain('reserved block');
    }
  });

  it('placements that only touch the reserved block on each side are accepted', () => {
    const img = image22();
    const names = ['test/left', 'test/right', 'test/top', 'test/bottom', 'test/corner'];
    const at = [
      { x: 6, y: 10 }, // left of the block (block spans x 8..15)
      { x: 16, y: 10 }, // right of the block
      { x: 10, y: 6 }, // above the block (block spans y 8..15)
      { x: 10, y: 16 }, // below the block
      { x: 16, y: 16 }, // diagonal corner
    ];
    let caught: unknown = null;
    let page: Uint8Array = new Uint8Array(0);
    try {
      page = buildAtlasPixels(
        names.map((key) => ({ key, width: 2, height: 2, rgba: img })),
        {
          pageSize: PAGE,
          pages: 1,
          reserved: { x: 8, y: 8, width: 8, height: 8 },
          placements: names.map((key, i) => ({ key, page: 0, x: at[i].x, y: at[i].y, width: 2, height: 2 })),
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeNull();
    expect(texel(page, 8, 8)).toEqual([255, 255, 255, 255]);
    expect(texel(page, 15, 15)).toEqual([255, 255, 255, 255]);
    for (const a of at) {
      expect(texel(page, a.x, a.y)).toEqual([img[0], img[1], img[2], img[3]]);
    }
  });

  it('a non-square reserved block: each axis rejects an overlap and accepts a touch', () => {
    // The block spans x 4..11 and y 1..2: wide and short, so swapping axes changes the answer.
    const img = image22();
    const reserved = { x: 4, y: 1, width: 8, height: 2 };
    const lookupFor = (placements: { key: string; page: number; x: number; y: number; width: number; height: number }[]) => ({
      pageSize: PAGE,
      pages: 1,
      reserved,
      placements,
    });
    const overlaps = [
      { x: 6, y: 2 }, // inside the block
      { x: 11, y: 1 }, // one column into the block on the right edge
      { x: 5, y: 0 }, // one row into the block on the top edge
    ];
    for (const at of overlaps) {
      let caught: unknown = null;
      try {
        buildAtlasPixels(
          [{ key: 'test/sprite-a', width: 2, height: 2, rgba: img }],
          lookupFor([{ key: 'test/sprite-a', page: 0, x: at.x, y: at.y, width: 2, height: 2 }]),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AtlasPixelError);
      expect((caught as AtlasPixelError).code).toBe('INPUT');
    }
    // The block starts at row 1, so the placements above it and at its top-left corner are one row tall.
    // Touches must not overlap one another, or a later key would paint over an origin texel.
    const touches = [
      { x: 6, y: 3, h: 2 }, // below the block
      { x: 12, y: 1, h: 2 }, // right of the block
      { x: 2, y: 1, h: 2 }, // left of the block
      { x: 6, y: 0, h: 1 }, // above the block
      { x: 12, y: 3, h: 2 }, // diagonal corner
      { x: 2, y: 0, h: 1 }, // diagonal corner (row 0 only, so it does not overlap the left touch)
    ];
    let caught: unknown = null;
    let page: Uint8Array = new Uint8Array(0);
    try {
      page = buildAtlasPixels(
        touches.map((t, i) => ({ key: `test/touch-${i}`, width: 2, height: t.h, rgba: t.h === 2 ? img : img.slice(0, 8) })),
        lookupFor(touches.map((t, i) => ({ key: `test/touch-${i}`, page: 0, x: t.x, y: t.y, width: 2, height: t.h }))),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeNull();
    expect(texel(page, 4, 1)).toEqual([255, 255, 255, 255]);
    expect(texel(page, 11, 2)).toEqual([255, 255, 255, 255]);
    for (const t of touches) {
      expect(texel(page, t.x, t.y)).toEqual([img[0], img[1], img[2], img[3]]);
    }
  });
});

// Correction 2 (owner decision 2026-10-22, option 1b; record
// docs/plans/2026-10-22-0.11b-correction2-decision.md). C2 samples
// floor(local + 1e-3 texel). A sample 0.5e-3 texel below a texel boundary takes
// the texel above it. A sample in the last 1e-3 texel slice of a sprite maps
// outside the sprite and contributes nothing.
describe('C2 sampling bias (correction 2, 1e-3 texel)', () => {
  // 2x2 sprite at (16, 10): texel (0,0) red, (1,0) green, (0,1) blue, (1,1) white.
  // Opaque neighbours sit on its right (18, 10) and below it (16, 12). A sliver that
  // borrowed a neighbour's texel would show colour instead of transparency.
  function sprite(): Uint8Array {
    return buildAtlasPixels(
      [
        { key: 'test/sprite-a', width: 2, height: 2, rgba: image22() },
        { key: 'test/right', width: 2, height: 2, rgba: image22() },
        { key: 'test/below', width: 2, height: 2, rgba: image22() },
      ],
      atlasFor([
        { key: 'test/sprite-a', page: 0, x: 16, y: 10, width: 2, height: 2 },
        { key: 'test/right', page: 0, x: 18, y: 10, width: 2, height: 2 },
        { key: 'test/below', page: 0, x: 16, y: 12, width: 2, height: 2 },
      ]),
    );
  }

  // Pixel (1,1) has centre (1.5, 1.5). With the identity matrix, local = centre - t + 1.
  function sampleAt(tx: number, ty: number): [number, number, number, number] {
    const out = cpuReference(
      sprite(),
      PAGE,
      recordOf({ a00: 1, a01: 0, a10: 0, a11: 1, tx, ty, u0: 16, v0: 10, w: 2, h: 2, r: 1, g: 1, b: 1, a: 1 }),
      4,
      4,
    );
    return outTexel(out, 4, 1, 1);
  }

  it('x: local 0.9995, just below the boundary at 1, samples column 1 (green)', () => {
    // local x = 1.5 - 1.5005 + 1 = 0.9995; local y = 1.5 - 2 + 1 = 0.5.
    expect(sampleAt(1.5005, 2)).toEqual([0, 255, 0, 255]);
  });

  it('y: local 0.9995, just below the boundary at 1, samples row 1 (blue)', () => {
    // local x = 0.5; local y = 1.5 - 1.5005 + 1 = 0.9995.
    expect(sampleAt(2, 1.5005)).toEqual([0, 0, 255, 255]);
  });

  it('x: local 1.9995 (last 1e-3 slice of the sprite) is discarded', () => {
    // local x = 1.5 - 0.5005 + 1 = 1.9995 maps to column 2, outside the 2-wide sprite.
    expect(sampleAt(0.5005, 2)).toEqual([0, 0, 0, 0]);
  });

  it('y: local 1.9995 (last 1e-3 slice of the sprite) is discarded', () => {
    // local y = 1.5 - 0.5005 + 1 = 1.9995 maps to row 2, outside the 2-high sprite.
    expect(sampleAt(2, 0.5005)).toEqual([0, 0, 0, 0]);
  });

  // Band pins: the bias is exactly 1e-3, so the thresholds sit at 0.9990 and 1.9990.
  // local = 2.5 - t for the centre at 1.5 and hx = 1.
  it('x: the bias is pinned to 1e-3: local 0.9991 takes the texel above, 0.9989 does not', () => {
    expect(sampleAt(1.5009, 2)).toEqual([0, 255, 0, 255]);
    expect(sampleAt(1.5011, 2)).toEqual([255, 0, 0, 255]);
  });

  it('y: the bias is pinned to 1e-3: local 0.9991 takes the row above, 0.9989 does not', () => {
    expect(sampleAt(2, 1.5009)).toEqual([0, 0, 255, 255]);
    expect(sampleAt(2, 1.5011)).toEqual([255, 0, 0, 255]);
  });

  it('x: the far-edge band is pinned: local 1.9989 is kept, 1.9991 is discarded', () => {
    expect(sampleAt(0.5011, 2)).toEqual([0, 255, 0, 255]);
    expect(sampleAt(0.5009, 2)).toEqual([0, 0, 0, 0]);
  });

  it('y: the far-edge band is pinned: local 1.9989 is kept, 1.9991 is discarded', () => {
    expect(sampleAt(2, 0.5011)).toEqual([0, 0, 255, 255]);
    expect(sampleAt(2, 0.5009)).toEqual([0, 0, 0, 0]);
  });
});

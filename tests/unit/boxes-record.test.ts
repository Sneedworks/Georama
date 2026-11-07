import { describe, expect, it } from 'vitest';
import { GdDict, GdMath, GdObject } from '../../src/core/formats/godot-var.ts';
import type { GdValue } from '../../src/core/formats/godot-var.ts';
import { BoxError, readBox } from '../../src/core/boxes/record.ts';

const IMAGE_WIDTH = 4;
const IMAGE_HEIGHT = 3;

function white(): GdMath {
  return new GdMath('Color', new Float32Array([1, 1, 1, 1]));
}

function vec2(x: number, y: number): GdMath {
  return new GdMath('Vector2', new Float32Array([x, y]));
}

/** Small synthetic RGBA8 bytes (a generated gradient, not map data). */
function imageBytes(): Uint8Array {
  const out = new Uint8Array(IMAGE_WIDTH * IMAGE_HEIGHT * 4);
  for (let p = 0; p < IMAGE_WIDTH * IMAGE_HEIGHT; p++) {
    out[p * 4] = (p * 37) % 256;
    out[p * 4 + 1] = (p * 91) % 256;
    out[p * 4 + 2] = (p * 53) % 256;
    out[p * 4 + 3] = 255;
  }
  return out;
}

function imageDict(bytes: Uint8Array, format = 'RGBA8'): GdDict {
  return new GdDict([
    ['width', BigInt(IMAGE_WIDTH)],
    ['height', BigInt(IMAGE_HEIGHT)],
    ['format', format],
    ['mipmaps', false],
    ['data', bytes],
  ]);
}

function texture(props?: Array<[string, GdValue]>): GdObject {
  const image = new GdObject('Image', [
    ['resource_local_to_scene', false],
    ['data', imageDict(imageBytes())],
  ]);
  return new GdObject('ImageTexture', props ?? [['storage', 0n], ['flags', 2n], ['image', image]]);
}

function boxProps(): Array<[string, GdValue]> {
  return [
    ['visible', true],
    ['modulate', white()],
    ['self_modulate', white()],
    ['rect_rotation', 0],
    ['rect_scale', vec2(1, 1)],
    ['rect_pivot_offset', vec2(0, 0)],
    ['anchor_left', 0],
    ['anchor_top', 0],
    ['anchor_right', 0],
    ['anchor_bottom', 0],
    ['margin_left', 10],
    ['margin_top', 20],
    ['margin_right', 34],
    ['margin_bottom', 44],
    ['patch_margin_left', 1n],
    ['patch_margin_top', 2n],
    ['patch_margin_right', 1n],
    ['patch_margin_bottom', 2n],
    ['axis_stretch_horizontal', 2n],
    ['axis_stretch_vertical', 2n],
    ['draw_center', true],
    ['texture', texture()],
    ['mouse_filter', 2n],
    ['grow_horizontal', 1n],
  ];
}

function makeBox(): GdObject {
  return new GdObject('NinePatchRect', boxProps());
}

function withProp(box: GdObject, key: string, value: GdValue): GdObject {
  return new GdObject(
    box.cls,
    box.props.map((p): [string, GdValue] => (p[0] === key ? [key, value] : p)),
  );
}

function withoutProp(box: GdObject, key: string): GdObject {
  return new GdObject(
    box.cls,
    box.props.filter((p) => p[0] !== key),
  );
}

function expectBoxError(fn: () => unknown, code: 'param' | 'length'): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BoxError);
    expect((error as BoxError).code).toBe(code);
    return;
  }
  throw new Error(`expected a BoxError with code '${code}'`);
}

describe('readBox', () => {
  it('reads a valid synthetic box', () => {
    const record = readBox(makeBox());
    expect(record.margin).toEqual({ left: 10, top: 20, right: 34, bottom: 44 });
    expect(record.patch).toEqual({ left: 1, top: 2, right: 1, bottom: 2 });
    expect(record.stretch).toEqual({ horizontal: 2, vertical: 2 });
    expect(record.drawCenter).toBe(true);
    expect(record.visible).toBe(true);
    expect(record.image.width).toBe(IMAGE_WIDTH);
    expect(record.image.height).toBe(IMAGE_HEIGHT);
    expect(record.image.format).toBe('RGBA8');
    expect(record.image.data).toEqual(imageBytes());
  });

  it('refuses a missing key with param', () => {
    expectBoxError(() => readBox(withoutProp(makeBox(), 'margin_left')), 'param');
    expectBoxError(() => readBox(withoutProp(makeBox(), 'texture')), 'param');
  });

  it('refuses a wrongly typed key with param', () => {
    expectBoxError(() => readBox(withProp(makeBox(), 'margin_left', 'left')), 'param');
    expectBoxError(() => readBox(withProp(makeBox(), 'draw_center', 1n)), 'param');
  });

  it('refuses a data length mismatch with length', () => {
    const short = imageBytes().slice(0, IMAGE_WIDTH * IMAGE_HEIGHT * 4 - 1);
    const bad = withProp(makeBox(), 'texture', texture([['image', new GdObject('Image', [['data', imageDict(short)]])]]));
    expectBoxError(() => readBox(bad), 'length');
  });

  it('refuses an unsupported format with param', () => {
    const bad = withProp(
      makeBox(),
      'texture',
      texture([['image', new GdObject('Image', [['data', imageDict(imageBytes(), 'PNG')]])]]),
    );
    expectBoxError(() => readBox(bad), 'param');
  });

  it('refuses a non-zero anchor with param', () => {
    expectBoxError(() => readBox(withProp(makeBox(), 'anchor_left', 0.5)), 'param');
    expectBoxError(() => readBox(withProp(makeBox(), 'anchor_bottom', 1)), 'param');
  });

  it('refuses a stretch value other than 2 with param', () => {
    expectBoxError(() => readBox(withProp(makeBox(), 'axis_stretch_horizontal', 1n)), 'param');
    expectBoxError(() => readBox(withProp(makeBox(), 'axis_stretch_vertical', 0n)), 'param');
  });

  it('refuses a non-white modulate with param', () => {
    const red = new GdMath('Color', new Float32Array([1, 0, 0, 1]));
    expectBoxError(() => readBox(withProp(makeBox(), 'modulate', red)), 'param');
    const clear = new GdMath('Color', new Float32Array([1, 1, 1, 0]));
    expectBoxError(() => readBox(withProp(makeBox(), 'self_modulate', clear)), 'param');
  });

  it('refuses a non-identity rotation, scale or pivot with param', () => {
    expectBoxError(() => readBox(withProp(makeBox(), 'rect_rotation', 0.5)), 'param');
    expectBoxError(() => readBox(withProp(makeBox(), 'rect_scale', vec2(2, 1))), 'param');
    expectBoxError(() => readBox(withProp(makeBox(), 'rect_pivot_offset', vec2(1, 0))), 'param');
  });

  it('skips a visible-false box and counts it', () => {
    const record = readBox(withProp(makeBox(), 'visible', false));
    expect(record.visible).toBe(false);
    const kept = [record].filter((r) => r.visible);
    expect(kept).toHaveLength(0);
    const skippedHidden = [record].filter((r) => !r.visible).length;
    expect(skippedHidden).toBe(1);
  });

  it('refuses a non-box object with param', () => {
    expectBoxError(() => readBox(new GdObject('TextureRect', boxProps())), 'param');
    expectBoxError(() => readBox(null), 'param');
  });

  it('refuses a texture without an embedded image with param', () => {
    expectBoxError(() => readBox(withProp(makeBox(), 'texture', new GdObject('ImageTexture', []))), 'param');
  });
});

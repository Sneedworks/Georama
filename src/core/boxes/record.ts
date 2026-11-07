// Card 1.9b, GREEN (core): NinePatchRect box records. Detail v2.3 D1, D2, D3, D8, D9.
// Pure: no DOM, no GL, no I/O. Reads a decoded Godot NinePatchRect object into a
// typed record and refuses what v1 does not support: a missing or wrongly typed
// key, a non-zero anchor, an unsupported image format, a stretch value other than
// 2, a non-white modulate, or a non-identity rotation, scale or pivot ('param');
// an image byte length other than width x height x 4 ('length').
import { GdDict, GdMath, GdObject } from '../formats/godot-var.ts';
import type { GdValue } from '../formats/godot-var.ts';

export type BoxErrorCode = 'param' | 'length';

export class BoxError extends Error {
  readonly code: BoxErrorCode;
  constructor(code: BoxErrorCode, message: string) {
    super(message);
    this.name = 'BoxError';
    this.code = code;
  }
}

function fail(code: BoxErrorCode, message: string): never {
  throw new BoxError(code, message);
}

export interface BoxMargin {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface BoxPatch {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface BoxStretch {
  readonly horizontal: number;
  readonly vertical: number;
}

export interface BoxImage {
  readonly width: number;
  readonly height: number;
  readonly format: 'RGBA8';
  readonly data: Uint8Array;
}

export interface BoxRecord {
  readonly margin: BoxMargin;
  readonly patch: BoxPatch;
  readonly stretch: BoxStretch;
  readonly drawCenter: boolean;
  readonly visible: boolean;
  readonly image: BoxImage;
}

const MAX_SAFE_BIG = BigInt(Number.MAX_SAFE_INTEGER);

/** Index the object's props by name; a malformed pair is refused with 'param'. */
function propMap(obj: GdObject, what: string): Map<string, GdValue> {
  const out = new Map<string, GdValue>();
  for (const prop of obj.props) {
    if (!Array.isArray(prop) || prop.length !== 2 || typeof prop[0] !== 'string') {
      fail('param', `${what}: malformed property pair`);
    }
    if (!out.has(prop[0])) out.set(prop[0], prop[1]);
  }
  return out;
}

function required(props: Map<string, GdValue>, key: string, what: string): GdValue {
  const v = props.get(key);
  if (v === undefined) fail('param', `${what}: missing key '${key}'`);
  return v;
}

function readReal(props: Map<string, GdValue>, key: string, what: string): number {
  const v = required(props, key, what);
  if (typeof v !== 'number' || !Number.isFinite(v)) fail('param', `${what}: '${key}' must be a finite Real`);
  return v;
}

/** An Int property as a safe number. */
function readInt(props: Map<string, GdValue>, key: string, what: string): number {
  const v = required(props, key, what);
  if (typeof v !== 'bigint' || v < -MAX_SAFE_BIG || v > MAX_SAFE_BIG) {
    fail('param', `${what}: '${key}' must be an Int in the safe range`);
  }
  return Number(v);
}

function readBool(props: Map<string, GdValue>, key: string, what: string): boolean {
  const v = required(props, key, what);
  if (typeof v !== 'boolean') fail('param', `${what}: '${key}' must be a bool`);
  return v;
}

/** Anchors and rotation must be a numeric zero (F20, D1, D8). */
function readZero(props: Map<string, GdValue>, key: string, what: string): void {
  const v = required(props, key, what);
  if (!((typeof v === 'number' && v === 0) || (typeof v === 'bigint' && v === 0n))) {
    fail('param', `${what}: '${key}' must be zero`);
  }
}

/** Stored stretch value 2 on both axes (F14, D3); anything else is refused. */
function readStretch(props: Map<string, GdValue>, key: string, what: string): number {
  const v = required(props, key, what);
  if (typeof v !== 'bigint' || v !== 2n) fail('param', `${what}: '${key}' must be the stored value 2`);
  return 2;
}

function readVec2(props: Map<string, GdValue>, key: string, what: string): { x: number; y: number } {
  const v = required(props, key, what);
  if (!(v instanceof GdMath) || v.kind !== 'Vector2' || v.v.length !== 2) {
    fail('param', `${what}: '${key}' must be a Vector2`);
  }
  const x = v.v[0];
  const y = v.v[1];
  if (!Number.isFinite(x) || !Number.isFinite(y)) fail('param', `${what}: '${key}' must be finite`);
  return { x, y };
}

/** modulate and self_modulate must be white (F16, D9). */
function readWhite(props: Map<string, GdValue>, key: string, what: string): void {
  const v = required(props, key, what);
  if (!(v instanceof GdMath) || v.kind !== 'Color' || v.v.length !== 4) {
    fail('param', `${what}: '${key}' must be a Color`);
  }
  if (v.v[0] !== 1 || v.v[1] !== 1 || v.v[2] !== 1 || v.v[3] !== 1) {
    fail('param', `${what}: '${key}' must be white`);
  }
}

/** The embedded RGBA8 image, via the ImageTexture's Image object (F11, D2). */
function readBoxImage(texture: GdValue, what: string): BoxImage {
  if (!(texture instanceof GdObject) || texture.cls !== 'ImageTexture') {
    fail('param', `${what}: 'texture' must be an ImageTexture object`);
  }
  let image: GdObject | null = null;
  for (const prop of texture.props) {
    if (!Array.isArray(prop) || prop.length !== 2 || typeof prop[0] !== 'string') {
      fail('param', `${what}: malformed texture property pair`);
    }
    if (image === null && prop[1] instanceof GdObject && (prop[1] as GdObject).cls === 'Image') {
      image = prop[1];
    }
  }
  if (image === null) fail('param', `${what}: texture holds no Image`);
  const found = image as GdObject;
  const inner = propMap(found, `${what}/image`);
  let dataCount = 0;
  let data: GdValue | undefined;
  for (const [name, value] of inner) {
    if (name === 'data') {
      dataCount++;
      data = value;
    }
  }
  if (dataCount !== 1 || data === undefined) fail('param', `${what}/image: exactly one 'data' prop is required`);
  if (!(data instanceof GdDict)) fail('param', `${what}/image/data: expected a Dictionary`);
  const dict = data as GdDict;
  const widthValue = dict.get('width');
  const heightValue = dict.get('height');
  if (
    typeof widthValue !== 'bigint' || widthValue < 1n || widthValue > MAX_SAFE_BIG ||
    typeof heightValue !== 'bigint' || heightValue < 1n || heightValue > MAX_SAFE_BIG
  ) {
    fail('param', `${what}/image/data: width and height must be positive Ints`);
  }
  const width = Number(widthValue as bigint);
  const height = Number(heightValue as bigint);
  if (dict.get('format') !== 'RGBA8') fail('param', `${what}/image/data: unsupported format (v1 reads RGBA8 only)`);
  if (dict.get('mipmaps') !== false) fail('param', `${what}/image/data: expected no mipmaps`);
  const bytes = dict.get('data');
  if (!(bytes instanceof Uint8Array)) fail('param', `${what}/image/data: 'data' must be a PoolByteArray`);
  if ((bytes as Uint8Array).length !== width * height * 4) {
    fail('length', `${what}/image/data: byte length does not match width x height x 4`);
  }
  return { width, height, format: 'RGBA8', data: bytes as Uint8Array };
}

/**
 * Read one boxes[] entry into a typed record. The input is a decoded
 * NinePatchRect object; every anchor is an absolute offset because all four
 * anchors are zero (F20). A box with visible false is returned as-is so the
 * caller can skip and count it (D8); it is not a refusal.
 */
export function readBox(input: unknown): BoxRecord {
  if (!(input instanceof GdObject) || input.cls !== 'NinePatchRect') {
    fail('param', 'box: expected a NinePatchRect object');
  }
  const box = input as GdObject;
  const props = propMap(box, 'box');
  const visible = readBool(props, 'visible', 'box');
  const margin: BoxMargin = {
    left: readReal(props, 'margin_left', 'box'),
    top: readReal(props, 'margin_top', 'box'),
    right: readReal(props, 'margin_right', 'box'),
    bottom: readReal(props, 'margin_bottom', 'box'),
  };
  const patch: BoxPatch = {
    left: readInt(props, 'patch_margin_left', 'box'),
    top: readInt(props, 'patch_margin_top', 'box'),
    right: readInt(props, 'patch_margin_right', 'box'),
    bottom: readInt(props, 'patch_margin_bottom', 'box'),
  };
  for (const [name, value] of [ ['left', patch.left], ['top', patch.top], ['right', patch.right], ['bottom', patch.bottom] ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) fail('param', `box: patch margin '${name}' must be a safe integer >= 0`);
  }
  const stretch: BoxStretch = {
    horizontal: readStretch(props, 'axis_stretch_horizontal', 'box'),
    vertical: readStretch(props, 'axis_stretch_vertical', 'box'),
  };
  const drawCenter = readBool(props, 'draw_center', 'box');
  readZero(props, 'anchor_left', 'box');
  readZero(props, 'anchor_top', 'box');
  readZero(props, 'anchor_right', 'box');
  readZero(props, 'anchor_bottom', 'box');
  readWhite(props, 'modulate', 'box');
  readWhite(props, 'self_modulate', 'box');
  readZero(props, 'rect_rotation', 'box');
  const scale = readVec2(props, 'rect_scale', 'box');
  if (scale.x !== 1 || scale.y !== 1) fail('param', "box: 'rect_scale' must be (1, 1)");
  const pivot = readVec2(props, 'rect_pivot_offset', 'box');
  if (pivot.x !== 0 || pivot.y !== 0) fail('param', "box: 'rect_pivot_offset' must be (0, 0)");
  const image = readBoxImage(required(props, 'texture', 'box'), 'box');
  return { margin, patch, stretch, drawCenter, visible, image };
}

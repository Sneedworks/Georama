/**
 * Frozen codec conformance vectors, independent of Georama's fixture encoders.
 *
 * Construction and oracle provenance: tests/fixtures/codec-conformance/README.md.
 * Do not regenerate expected values with the implementation under test.
 */
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePngRgba8 } from '../../src/core/assets/png-pixels.ts';
import { decodeGcpf, readGcpfHeader } from '../../src/core/formats/gcpf.ts';
import { GdDict, GdMath, decodeStoreVar, encodeStoreVar } from '../../src/core/formats/godot-var.ts';

function fromHex(text: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/.test(text)) throw new Error('invalid test fixture hex');
  return Uint8Array.from(Buffer.from(text, 'hex'));
}

function pinnedFixture(hex: string, sha256: string): Uint8Array {
  const bytes = fromHex(hex);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
  return bytes;
}

/** An intentionally simple framing reader used only with the fixed valid PNGs. */
function pngChunks(bytes: Uint8Array): Array<{ type: string; data: Uint8Array }> {
  const result: Array<{ type: string; data: Uint8Array }> = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at < bytes.length;) {
    const length = view.getUint32(at, false);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    result.push({ type, data: bytes.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return result;
}

function assertVariantShape(bytes: Uint8Array): void {
  const decoded = decodeStoreVar(bytes);
  expect(decoded).toBeInstanceOf(GdDict);
  if (!(decoded instanceof GdDict)) return;
  expect(decoded.shared).toBe(false);
  expect(decoded.entries).toHaveLength(3);
  expect(decoded.entries.map(([key]) => key)).toEqual(['é', 'x', 'x']);
  const vector = decoded.entries[0]?.[1];
  expect(vector).toBeInstanceOf(GdMath);
  if (!(vector instanceof GdMath)) return;
  expect(vector.kind).toBe('Vector2');
  expect(Object.is(vector.v[0], -0)).toBe(true);
  expect(vector.v[1]).toBe(2.5);
  expect(decoded.entries[1]?.[1]).toEqual(Uint8Array.from([0, 255, 1]));
  expect(decoded.entries[2]?.[1]).toBeNull();
  // The duplicate dictionary key and its first-match semantics must survive.
  expect(decoded.get('x')).toEqual(Uint8Array.from([0, 255, 1]));
  expect(encodeStoreVar(decoded)).toEqual(bytes);
}

/** Check that the decoder uses the supplied byte view, not its backing buffer. */
function withOffset(source: Uint8Array, offset: number): Uint8Array {
  const backing = new Uint8Array(source.length + offset + 13).fill(0xa5);
  backing.set(source, offset);
  return backing.subarray(offset, offset + source.length);
}

const PNG_RGBA = [
  '89504e470d0a1a0a0000000d49484452000000030000000208060000009d74661a00000025744558746e6f7465006669',
  '78747572653a20726762612066696c74657220737562202b2070616574685db3846900000001494441547876e684e600',
  '00000449444154da63e41220f08c230000001e494441549163f8f0e6e57f761dcf46164626d6ffbf99998c19b9bf9d03',
  '0072fb090d9efc9ddd0000000049454e44ae426082',
].join('');
const PNG_PALETTE = [
  '89504e470d0a1a0a0000000d4948445200000004000000010803000000cee2ffff0000000c504c54450a141e28323c46',
  '505a78828c9b6fa72e0000000374524e53ff007f84549c9e00000001494441547876e684e60000000449444154da6360',
  '60c114c17c000000084944415464620600000f0007e5a19f890000000049454e44ae426082',
].join('');
const GCPF_TWO_BLOCKS = [
  '4743504600000000100000001400000011000000110000000f000102030405060708090a0b0c0d0e0f0f101112130000',
  '0000000000000000000047435046',
].join('');
const GODOT_STORE = [
  '4800000012000000030000000400000002000000c3a90000050000000000008000002040040000000100000078000000',
  '140000000300000000ff010004000000010000007800000000000000',
].join('');
const GCPF_STORE = [
  '4743504600000000800000004c0000004f0000001f4800000012000000030000000400000002000000c3a90000050000',
  '00000000801f00002040040000000100000078000000140000000300000000ff0100040000000b010000007800000000',
  '00000047435046',
].join('');


describe('frozen PNG conformance vectors', () => {
  it('decodes 3x2 RGBA with Sub, Paeth, ancillary data, and three split IDATs', () => {
    const bytes = pinnedFixture(PNG_RGBA, 'f4ec8773fb46d054eef8f8cc962d4a476fb1b9402483d922069dfcc7f9c76f3b');
    const chunks = pngChunks(bytes);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'tEXt', 'IDAT', 'IDAT', 'IDAT', 'IEND']);
    // Independent zlib reference: this is the filtered scanline payload,
    // not an expected value calculated by the Georama PNG decoder.
    const zlib = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
    expect(inflateSync(zlib)).toEqual(Buffer.from('010a141e00f0ece9ff072c498104010205fffb030233010bf6ce', 'hex'));
    const result = decodePngRgba8(bytes);
    expect([result.width, result.height]).toEqual([3, 2]);
    expect(result.rgba).toEqual(fromHex('0a141e00fa0007ff012c50800b1623fff503093202374600'));
  });

  it('decodes four indexed colors with partial tRNS and unspecified opaque alpha', () => {
    const bytes = pinnedFixture(PNG_PALETTE, 'b895d3109781e0c1ad6bb3a3601037b5e042eba39bf186872ee92cfc645d9d20');
    const chunks = pngChunks(bytes);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IDAT', 'IDAT', 'IEND']);
    const zlib = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
    expect(inflateSync(zlib)).toEqual(Buffer.from('0000010203', 'hex'));
    const result = decodePngRgba8(bytes);
    expect([result.width, result.height]).toEqual([4, 1]);
    expect(result.rgba).toEqual(fromHex('0a141eff28323c0046505a7f78828cff'));
  });

  it.each([0, 1, 3, 7])('is invariant under a %i-byte source-view offset', (offset) => {
    const original = fromHex(PNG_RGBA);
    const result = decodePngRgba8(withOffset(original, offset));
    expect(result.rgba).toEqual(fromHex('0a141e00fa0007ff012c50800b1623fff503093202374600'));
  });
});

describe('frozen GCPF / FastLZ conformance vectors', () => {
  it('decodes two independent literal blocks, including a zero-padded final block', () => {
    const file = pinnedFixture(GCPF_TWO_BLOCKS, 'ab6f669810111bb4602c33e35a618df68c4a314ec501936b10a888451d38332b');
    const header = readGcpfHeader(file);
    expect([header.blockSize, header.totalSize, header.blockCount]).toEqual([16, 20, 2]);
    expect(Array.from(header.compressedSizes)).toEqual([17, 17]);
    expect(header.blockOffsets).toEqual([24, 41]);
    expect(header.dataEnd).toBe(58);
    const decoded = decodeGcpf(file);
    expect(decoded.payload).toEqual(Uint8Array.from(Array.from({ length: 20 }, (_, i) => i)));
    expect(decoded.footerOk).toBe(true);
    expect(decoded.trailingBytes).toBe(4);
  });

  it.each([0, 1, 5])('is invariant under a %i-byte source-view offset', (offset) => {
    const file = withOffset(fromHex(GCPF_TWO_BLOCKS), offset);
    expect(decodeGcpf(file).payload).toEqual(Uint8Array.from(Array.from({ length: 20 }, (_, i) => i)));
    expect(readGcpfHeader(file).blockOffsets).toEqual([24, 41]);
  });
});

describe('frozen Godot 3 Variant conformance vectors', () => {
  it('preserves nested values, duplicate keys, Unicode, signed zero, and padded byte arrays', () => {
    const bytes = pinnedFixture(GODOT_STORE, 'aa095ce32ec04464e844620224f4a6d876a8c668a4e58f076ce1a4e4a5071f55');
    expect(bytes.length).toBe(76);
    assertVariantShape(bytes);
  });

  it.each([0, 1, 2, 7])('decodes an unaligned store_var view at offset %i', (offset) => {
    assertVariantShape(withOffset(fromHex(GODOT_STORE), offset));
  });
});

describe('frozen cross-codec pipeline vector', () => {
  it('decodes a GCPF literal block carrying a Godot store_var message', () => {
    const file = pinnedFixture(GCPF_STORE, 'eb5be4c7670679768b46329140ec42bcc5252a04dd30659bde96f6243b9d99c3');
    const decoded = decodeGcpf(file);
    expect(decoded.footerOk).toBe(true);
    expect(decoded.trailingBytes).toBe(4);
    // This fixture was assembled by an independent byte writer, not encodeGcpf.
    expect(decoded.payload).toEqual(fromHex(GODOT_STORE));
    assertVariantShape(decoded.payload);
  });
});

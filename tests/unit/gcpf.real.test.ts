import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeGcpf, encodeGcpf, readGcpfHeader } from '../../src/core/formats/gcpf.ts';

const sample = process.env.GEORAMA_SAMPLE_MAP;

describe.skipIf(!sample)('private real GCPF sample (opt-in)', () => {
  it('decodes with a footer and re-encodes byte-identically to Godot', () => {
    const file = readFileSync(sample!);
    const decoded = decodeGcpf(file);
    expect(decoded.footerOk).toBe(true);
    const encoded = encodeGcpf(decoded.payload, { blockSize: decoded.header.blockSize });
    if (!file.equals(encoded)) {
      const actual = readGcpfHeader(encoded);
      for (let i = 0; i < decoded.header.blockCount; i++) {
        const expectedBlock = file.subarray(decoded.header.blockOffsets[i], decoded.header.blockOffsets[i] + decoded.header.compressedSizes[i]);
        const actualBlock = encoded.subarray(actual.blockOffsets[i], actual.blockOffsets[i] + actual.compressedSizes[i]);
        if (!expectedBlock.equals(actualBlock)) {
          throw new Error(`BYTES-DIFFER@block ${i}, file offset ${decoded.header.blockOffsets[i]}, expected=${expectedBlock.toString('hex')}, actual=${Buffer.from(actualBlock).toString('hex')}`);
        }
      }
      throw new Error('Encoded header/footer differs although compressed blocks match');
    }
    expect(file.equals(encoded)).toBe(true);
  }, 60_000);
});

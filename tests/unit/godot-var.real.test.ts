import { describe, expect, it } from 'vitest';
import { decodeStoreVar, encodeStoreVar, GdDict } from '../../src/core/formats/godot-var.ts';
import { difference } from '../../scripts/var-check.ts';

interface ContainerReader { readGcpf(path: string): { data: Uint8Array } }

describe.skipIf(!process.env.GEORAMA_SAMPLE_MAP)('real Godot store_var payload', () => {
  it('re-encodes every payload byte identically (first mismatch includes offset and key path)', async () => {
    const { readGcpf } = await import(new URL('../../spike/gcpf.mjs', import.meta.url).href) as ContainerReader;
    const payload = readGcpf(process.env.GEORAMA_SAMPLE_MAP!).data;
    const tree = decodeStoreVar(payload);
    expect(tree).toBeInstanceOf(GdDict);
    const output = encodeStoreVar(tree);
    expect(difference(payload, output, tree)).toBeUndefined();
    console.log(`REAL payload_bytes=${payload.length} encoded_bytes=${output.length} IDENTICAL`);
  }, 60_000);
});

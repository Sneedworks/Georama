// Portable-global policy: add a global only if it exists identically in browsers,
// Web Workers and Node >= 22. Record every addition and its rationale in docs/DEV.md.
// This allow-list belongs ONLY to tsconfig.core.json, never the DOM or Node projects.
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  readonly encoding: string;
  decode(input?: ArrayBufferView | ArrayBuffer, options?: { stream?: boolean }): string;
}

declare class TextEncoder {
  constructor();
  readonly encoding: string;
  encode(input?: string): Uint8Array;
  encodeInto(source: string, destination: Uint8Array): { read: number; written: number };
}

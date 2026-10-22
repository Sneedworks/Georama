declare class Buffer {
  static from(text: string): Uint8Array;
}
export const bytes = Buffer.from('x');

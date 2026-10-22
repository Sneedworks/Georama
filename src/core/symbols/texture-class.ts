import type { AssetRef, RefErrorCode } from '../assets/resolve.ts';
import { RefError, assetKey, resolveRef } from '../assets/resolve.ts';

export type SymbolTexture =
  | { readonly class: 'asset'; readonly key: string; readonly ref: AssetRef }
  | { readonly class: 'embedded' }
  | { readonly class: 'invalid'; readonly code: RefErrorCode | 'TYPE' };

export function classifySymbolTexture(texture: unknown): SymbolTexture {
  if (typeof texture === 'string') {
    try {
      const ref = resolveRef('symbol', texture);
      return { class: 'asset', key: assetKey(ref), ref };
    } catch (error) {
      if (error instanceof RefError) {
        return { class: 'invalid', code: error.code };
      }
      throw error;
    }
  }
  if (typeof texture === 'object' && texture !== null && !Array.isArray(texture)) {
    return { class: 'embedded' };
  }
  return { class: 'invalid', code: 'TYPE' };
}

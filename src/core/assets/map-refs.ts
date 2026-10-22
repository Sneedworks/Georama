/** Portable pure inventory of image references in an already validated map.
 *
 * This is an inventory only: raw reference strings stay opaque (even empty),
 * every occurrence is recorded exactly once with its location, and no
 * resolution, validation, authorization, rendering availability, filesystem,
 * or network access happens here. Embedded symbol textures contribute their
 * location to `embeddedSymbolLocations` and never to an external group.
 */
import type { WdMap } from '../formats/wonderdraft-map.ts';
import type { RefKind } from './resolve.ts';

export interface MapAssetInput {
  readonly theme: Readonly<Pick<WdMap['theme'], 'waterTexture' | 'groundTexture'>>;
  readonly frame: Readonly<Pick<WdMap['frame'], 'texture'>>;
  readonly paths: readonly Readonly<Pick<WdMap['paths'][number], 'style'>>[];
  readonly territories: Readonly<{
    territories: readonly Readonly<Pick<WdMap['territories']['territories'][number], 'style'>>[];
  }>;
  readonly symbols: readonly Readonly<Pick<WdMap['symbols'][number], 'texture'>>[];
}

export interface MapAssetGroup {
  readonly kind: RefKind;
  readonly reference: string;
  readonly locations: readonly string[];
}

export interface MapAssetInventory {
  readonly groups: readonly MapAssetGroup[];
  readonly embeddedSymbolLocations: readonly string[];
}

/** Compile-time proof: an actual validated WdMap is assignable to the projection. */
function wdMapToInput(map: WdMap): MapAssetInput {
  return map;
}
void wdMapToInput;

export function collectMapAssetRefs(map: MapAssetInput): MapAssetInventory {
  const byKind = new Map<RefKind, Map<string, string[]>>();
  const embedded: string[] = [];
  const add = (kind: RefKind, reference: string, location: string): void => {
    let inner = byKind.get(kind);
    if (inner === undefined) {
      inner = new Map<string, string[]>();
      byKind.set(kind, inner);
    }
    const locations = inner.get(reference);
    if (locations === undefined) {
      inner.set(reference, [location]);
    } else {
      locations.push(location);
    }
  };
  add('water-texture', map.theme.waterTexture, '/theme/water_texture');
  add('ground-texture', map.theme.groundTexture, '/theme/ground_texture');
  add('frame-texture', map.frame.texture, '/frame/texture');
  const paths = map.paths;
  for (let i = 0; i < paths.length; i += 1) {
    add('path-style', paths[i].style, '/paths/' + i + '/style');
  }
  const borders = map.territories.territories;
  for (let i = 0; i < borders.length; i += 1) {
    add('border-style', borders[i].style, '/territories/territories/' + i + '/style');
  }
  const symbols = map.symbols;
  for (let i = 0; i < symbols.length; i += 1) {
    const texture = symbols[i].texture;
    if (typeof texture === 'string') {
      add('symbol', texture, '/symbols/' + i + '/texture');
    } else {
      embedded.push('/symbols/' + i + '/texture');
    }
  }
  const groups: MapAssetGroup[] = [];
  for (const [kind, inner] of byKind) {
    for (const [reference, locations] of inner) {
      groups.push(Object.freeze({ kind, reference, locations: Object.freeze(locations) }));
    }
  }
  groups.sort((a, b) => {
    if (a.kind < b.kind) return -1;
    if (a.kind > b.kind) return 1;
    if (a.reference < b.reference) return -1;
    if (a.reference > b.reference) return 1;
    return 0;
  });
  return Object.freeze({
    groups: Object.freeze(groups),
    embeddedSymbolLocations: Object.freeze(embedded),
  });
}

import { describe, expect, it } from 'vitest';
import type { MapAssetInput } from '../../src/core/assets/map-refs.ts';
import { collectMapAssetRefs } from '../../src/core/assets/map-refs.ts';
import type { WdMap } from '../../src/core/formats/wonderdraft-map.ts';
import { GdObject } from '../../src/core/formats/godot-var.ts';

/** Compile-time proof: an actual validated WdMap is assignable to the projection. */
function wdMapToInput(map: WdMap): MapAssetInput {
  return map;
}
void wdMapToInput;

describe('collectMapAssetRefs initial contract', () => {
  it('inventories the theme and frame references sorted by kind then reference', () => {
    const input: MapAssetInput = {
      theme: { waterTexture: 'synthetic-water', groundTexture: 'synthetic-ground' },
      frame: { texture: '' },
      paths: [],
      territories: { territories: [] },
      symbols: [],
    };
    const inventory = collectMapAssetRefs(input);
    expect(inventory.groups.map((group) => [group.kind, group.reference])).toEqual([
      ['frame-texture', ''],
      ['ground-texture', 'synthetic-ground'],
      ['water-texture', 'synthetic-water'],
    ]);
    expect(inventory.groups.map((group) => [...group.locations])).toEqual([
      ['/frame/texture'],
      ['/theme/ground_texture'],
      ['/theme/water_texture'],
    ]);
    expect([...inventory.embeddedSymbolLocations]).toEqual([]);
    expect(Object.isFrozen(inventory)).toBe(true);
    expect(Object.isFrozen(inventory.groups)).toBe(true);
    expect(Object.isFrozen(inventory.embeddedSymbolLocations)).toBe(true);
    for (const group of inventory.groups) {
      expect(Object.isFrozen(group)).toBe(true);
      expect(Object.isFrozen(group.locations)).toBe(true);
    }
  });

  it('visits path styles and border styles in index order', () => {
    const input: MapAssetInput = {
      theme: { waterTexture: 'synthetic-water', groundTexture: 'synthetic-ground' },
      frame: { texture: '' },
      paths: [{ style: 'synthetic-path-a' }, { style: 'synthetic-path-b' }],
      territories: {
        territories: [{ style: 'synthetic-border-a' }, { style: 'synthetic-border-b' }],
      },
      symbols: [],
    };
    const inventory = collectMapAssetRefs(input);
    const pathGroups = inventory.groups.filter((group) => group.kind === 'path-style');
    expect(pathGroups.map((group) => [group.reference, [...group.locations]])).toEqual([
      ['synthetic-path-a', ['/paths/0/style']],
      ['synthetic-path-b', ['/paths/1/style']],
    ]);
    const borderGroups = inventory.groups.filter((group) => group.kind === 'border-style');
    expect(borderGroups.map((group) => [group.reference, [...group.locations]])).toEqual([
      ['synthetic-border-a', ['/territories/territories/0/style']],
      ['synthetic-border-b', ['/territories/territories/1/style']],
    ]);
  });

  it('groups string symbol textures and records embedded symbol locations', () => {
    const shared = new GdObject('ImageTexture', []);
    const input: MapAssetInput = {
      theme: { waterTexture: 'synthetic-water', groundTexture: 'synthetic-ground' },
      frame: { texture: '' },
      paths: [],
      territories: { territories: [] },
      symbols: [
        { texture: 'synthetic-symbol-a' },
        { texture: shared },
        { texture: 'synthetic-symbol-a' },
        { texture: shared },
      ],
    };
    const inventory = collectMapAssetRefs(input);
    const symbolGroups = inventory.groups.filter((group) => group.kind === 'symbol');
    expect(symbolGroups.map((group) => [group.reference, [...group.locations]])).toEqual([
      ['synthetic-symbol-a', ['/symbols/0/texture', '/symbols/2/texture']],
    ]);
    expect([...inventory.embeddedSymbolLocations]).toEqual([
      '/symbols/1/texture',
      '/symbols/3/texture',
    ]);
  });

  it('keeps raw references opaque with per-kind grouping and visit-order locations', () => {
    const odd = 'a b&c%d' + String.fromCharCode(0);
    const input: MapAssetInput = {
      theme: { waterTexture: 'Shared', groundTexture: 'shared' },
      frame: { texture: 'Shared' },
      paths: [{ style: 'dup' }, { style: 'Dup' }, { style: 'dup' }, { style: '' }],
      territories: { territories: [{ style: 'dup' }] },
      symbols: [{ texture: 'dup' }, { texture: odd }],
    };
    const inventory = collectMapAssetRefs(input);
    const pathGroups = inventory.groups.filter((group) => group.kind === 'path-style');
    expect(pathGroups.map((group) => [group.reference, [...group.locations]])).toEqual([
      ['', ['/paths/3/style']],
      ['Dup', ['/paths/1/style']],
      ['dup', ['/paths/0/style', '/paths/2/style']],
    ]);
    const sharedGroups = inventory.groups.filter(
      (group) => group.reference === 'Shared' || group.reference === 'shared',
    );
    expect(sharedGroups.map((group) => [group.kind, group.reference])).toEqual([
      ['frame-texture', 'Shared'],
      ['ground-texture', 'shared'],
      ['water-texture', 'Shared'],
    ]);
    const dupGroups = inventory.groups.filter((group) => group.reference === 'dup');
    expect(dupGroups.map((group) => [group.kind, [...group.locations]])).toEqual([
      ['border-style', ['/territories/territories/0/style']],
      ['path-style', ['/paths/0/style', '/paths/2/style']],
      ['symbol', ['/symbols/0/texture']],
    ]);
    const oddGroups = inventory.groups.filter((group) => group.reference === odd);
    expect(oddGroups.map((group) => [group.kind, [...group.locations]])).toEqual([
      ['symbol', ['/symbols/1/texture']],
    ]);
  });

  it('returns fresh frozen outputs without mutating or retaining the input', () => {
    const input: MapAssetInput = {
      theme: { waterTexture: 'synthetic-water', groundTexture: 'synthetic-ground' },
      frame: { texture: '' },
      paths: [{ style: 'synthetic-path' }],
      territories: { territories: [{ style: 'synthetic-border' }] },
      symbols: [{ texture: 'synthetic-symbol' }],
    };
    const snapshot: unknown = JSON.parse(JSON.stringify(input));
    const first = collectMapAssetRefs(input);
    const second = collectMapAssetRefs(input);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.groups).not.toBe(first.groups);
    expect(second.embeddedSymbolLocations).not.toBe(first.embeddedSymbolLocations);
    expect(second.groups.length).toBe(first.groups.length);
    for (let i = 0; i < first.groups.length; i += 1) {
      expect(second.groups[i]).not.toBe(first.groups[i]);
      expect(second.groups[i].locations).not.toBe(first.groups[i].locations);
    }
    expect(JSON.parse(JSON.stringify(input)) as unknown).toEqual(snapshot);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.paths)).toBe(false);
    expect(Object.isFrozen(input.symbols)).toBe(false);
    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.isFrozen(second.groups)).toBe(true);
    expect(Object.isFrozen(second.embeddedSymbolLocations)).toBe(true);
    for (const group of second.groups) {
      expect(Object.isFrozen(group)).toBe(true);
      expect(Object.isFrozen(group.locations)).toBe(true);
    }
  });
});

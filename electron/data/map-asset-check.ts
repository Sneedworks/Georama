import { readSelectedConfigFile } from './config-file.ts';
import { readSelectedDataFile, SELECTED_FILE_LIMITS } from './selected-file.ts';
import { createAssetStore } from '../assets/store.ts';
import { collectMapAssetRefs } from '../../src/core/assets/map-refs.ts';
import { readWdMap, validateWdMap } from '../../src/core/formats/wonderdraft-map-file.ts';
import type { RefKind } from '../../src/core/assets/resolve.ts';

export interface AssetCheckEntry {
  readonly kind: RefKind;
  readonly reference: string;
  readonly locations: readonly string[];
  readonly status: 'valid' | 'unresolved' | 'empty';
}

export interface MapAssetCheckReport {
  readonly version: 1;
  readonly ok: boolean;
  readonly groups: number;
  readonly checked: number;
  readonly valid: number;
  readonly unresolved: number;
  readonly empty: number;
  readonly embeddedSymbols: number;
  readonly entries: readonly AssetCheckEntry[];
}

export class MapAssetCheckError extends Error {
  readonly code = 'VALIDATION' as const;
  readonly issueCount: number;
  constructor(issueCount: number) {
    super('Selected map failed semantic validation');
    this.name = 'MapAssetCheckError';
    this.issueCount = issueCount;
  }
}

export async function checkSelectedMapAssets(mapFilename: string, configFilename: string): Promise<MapAssetCheckReport> {
  const config = await readSelectedConfigFile(configFilename);
  const bytes = await readSelectedDataFile(mapFilename, SELECTED_FILE_LIMITS.maxReadBytes);
  const map = readWdMap(bytes);
  const issues = validateWdMap(map);
  if (issues.length > 0) {
    throw new MapAssetCheckError(issues.length);
  }
  const inventory = collectMapAssetRefs(map);
  const store = await createAssetStore({ installRoot: config.wonderdraftInstall, userDataRoot: config.wonderdraftUserData });
  try {
    let valid = 0;
    let unresolved = 0;
    let empty = 0;
    const entries: AssetCheckEntry[] = [];
    for (const group of inventory.groups) {
      if (group.reference === '') {
        empty += 1;
        entries.push(Object.freeze({ kind: group.kind, reference: group.reference, locations: group.locations, status: 'empty' as const }));
        continue;
      }
      try {
        await store.readImage(group.kind, group.reference);
        valid += 1;
        entries.push(Object.freeze({ kind: group.kind, reference: group.reference, locations: group.locations, status: 'valid' as const }));
      } catch {
        unresolved += 1;
        entries.push(Object.freeze({ kind: group.kind, reference: group.reference, locations: group.locations, status: 'unresolved' as const }));
      }
    }
    return Object.freeze({
      version: 1 as const,
      ok: unresolved === 0,
      groups: entries.length,
      checked: valid + unresolved,
      valid,
      unresolved,
      empty,
      embeddedSymbols: inventory.embeddedSymbolLocations.length,
      entries: Object.freeze(entries),
    });
  } finally {
    await store.close();
  }
}

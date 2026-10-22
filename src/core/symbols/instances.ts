import type { AtlasPlacement } from './atlas.ts';
import { classifySymbolTexture } from './texture-class.ts';

export type PlaceholderKind = 'embedded' | 'invalid' | 'unresolved' | 'oversize';

export interface SymbolInput {
  readonly position: { readonly x: number; readonly y: number };
  readonly rotation: number;
  readonly scale: { readonly x: number; readonly y: number };
  readonly zIndex: number;
  readonly offset: { readonly x: number; readonly y: number };
  readonly mirror: boolean;
  readonly texture: unknown;
  readonly sample: unknown;
  readonly customColors: unknown;
}

export interface AtlasLookup {
  readonly pageSize: number;
  readonly reserved: AtlasPlacement;
  readonly placements: readonly AtlasPlacement[];
  readonly oversize: readonly string[];
}

export interface InstanceCounts {
  readonly total: number;
  readonly sprites: number;
  readonly placeholders: Readonly<Record<PlaceholderKind, number>>;
  readonly unapplied: { readonly sample: number; readonly customColors: number };
}

export type InstanceVerdict =
  | { readonly ok: true; readonly records: Float32Array; readonly order: Uint32Array; readonly counts: InstanceCounts }
  | { readonly ok: false; readonly code: 'INPUT'; readonly message: string };

function isFiniteNumber(v: unknown): boolean {
  return typeof v === 'string' || typeof v === 'number' ? typeof v === 'number' && Number.isFinite(v) : false;
}

function readField(sym: unknown, path: string): unknown {
  const s = sym as Record<string, unknown> | null | undefined;
  if (s === null || s === undefined || typeof s !== 'object') return undefined;
  if (path === 'position.x') {
    const p = s['position'] as Record<string, unknown> | null | undefined;
    if (p === null || p === undefined || typeof p !== 'object') return undefined;
    return p['x'];
  }
  if (path === 'position.y') {
    const p = s['position'] as Record<string, unknown> | null | undefined;
    if (p === null || p === undefined || typeof p !== 'object') return undefined;
    return p['y'];
  }
  if (path === 'rotation') return s['rotation'];
  if (path === 'scale.x') {
    const q = s['scale'] as Record<string, unknown> | null | undefined;
    if (q === null || q === undefined || typeof q !== 'object') return undefined;
    return q['x'];
  }
  if (path === 'scale.y') {
    const q = s['scale'] as Record<string, unknown> | null | undefined;
    if (q === null || q === undefined || typeof q !== 'object') return undefined;
    return q['y'];
  }
  if (path === 'offset.x') {
    const q = s['offset'] as Record<string, unknown> | null | undefined;
    if (q === null || q === undefined || typeof q !== 'object') return undefined;
    return q['x'];
  }
  if (path === 'offset.y') {
    const q = s['offset'] as Record<string, unknown> | null | undefined;
    if (q === null || q === undefined || typeof q !== 'object') return undefined;
    return q['y'];
  }
  if (path === 'zIndex') return s['zIndex'];
  if (path === 'mirror') return s['mirror'];
  return undefined;
}

function isValidReserved(r: unknown): boolean {
  if (r === null || typeof r !== 'object') return false;
  const b = r as Record<string, unknown>;
  return isFiniteNumber(b['x']) && isFiniteNumber(b['y']) && isFiniteNumber(b['width']) && isFiniteNumber(b['height']) && isFiniteNumber(b['page']);
}

export function buildInstances(symbols: readonly SymbolInput[], atlas: AtlasLookup): InstanceVerdict {
  if (!Array.isArray(symbols) || symbols.length > 1_000_000) {
    return { ok: false, code: 'INPUT', message: 'I1: too many symbols' };
  }
  if (atlas === null || atlas === undefined || typeof atlas !== 'object') {
    return { ok: false, code: 'INPUT', message: 'I1: invalid atlas' };
  }
  if (!isValidReserved((atlas as { reserved?: unknown }).reserved)) {
    return { ok: false, code: 'INPUT', message: 'I1: invalid atlas' };
  }
  const fields: readonly string[] = ['position.x', 'position.y', 'rotation', 'scale.x', 'scale.y', 'offset.x', 'offset.y'];
  for (let i = 0; i < symbols.length; i += 1) {
    const s = symbols[i] as unknown;
    for (const f of fields) {
      if (!isFiniteNumber(readField(s, f))) {
        return { ok: false, code: 'INPUT', message: `I1: invalid ${f} at ${i}` };
      }
    }
    const z = readField(s, 'zIndex');
    if (typeof z !== 'number' || !Number.isInteger(z)) {
      return { ok: false, code: 'INPUT', message: `I1: invalid zIndex at ${i}` };
    }
    const m = readField(s, 'mirror');
    if (typeof m !== 'boolean') {
      return { ok: false, code: 'INPUT', message: `I1: invalid mirror at ${i}` };
    }
  }

  const placements = Array.isArray(atlas.placements) ? atlas.placements : [];
  const overList = Array.isArray(atlas.oversize) ? atlas.oversize : [];
  const byKey = new Map<string, AtlasPlacement>();
  for (const p of placements) {
    if (p !== null && typeof p === 'object' && typeof (p as AtlasPlacement).key === 'string') {
      byKey.set((p as AtlasPlacement).key, p as AtlasPlacement);
    }
  }
  const overSet = new Set<string>(overList as string[]);

  type Kind = 'sprite' | PlaceholderKind;
  const kinds: Kind[] = new Array(symbols.length);
  let sprites = 0;
  let embedded = 0;
  let invalid = 0;
  let unresolved = 0;
  let oversize = 0;
  let sampleCount = 0;
  let customCount = 0;

  for (let i = 0; i < symbols.length; i += 1) {
    const s = symbols[i] as SymbolInput;
    if (s.sample !== null && s.sample !== undefined) sampleCount += 1;
    if (s.customColors !== null && s.customColors !== undefined) customCount += 1;
    const t = classifySymbolTexture(s.texture);
    if (t.class === 'embedded') {
      kinds[i] = 'embedded';
      embedded += 1;
    } else if (t.class === 'invalid') {
      kinds[i] = 'invalid';
      invalid += 1;
    } else if (overSet.has(t.key)) {
      kinds[i] = 'oversize';
      oversize += 1;
    } else if (byKey.has(t.key)) {
      kinds[i] = 'sprite';
      sprites += 1;
    } else {
      kinds[i] = 'unresolved';
      unresolved += 1;
    }
  }

  const idx: number[] = new Array(symbols.length);
  for (let i = 0; i < symbols.length; i += 1) idx[i] = i;
  idx.sort((a, b) => {
    const sa = symbols[a] as SymbolInput;
    const sb = symbols[b] as SymbolInput;
    if (sa.zIndex !== sb.zIndex) return sa.zIndex - sb.zIndex;
    if (sa.position.y !== sb.position.y) return sa.position.y - sb.position.y;
    return a - b;
  });

  const records = new Float32Array(symbols.length * 16);
  const order = new Uint32Array(symbols.length);
  const res = atlas.reserved as AtlasPlacement;
  const ru0 = res.x;
  const rv0 = res.y;
  const rw = res.width;
  const rh = res.height;
  const rpage = res.page;

  for (let k = 0; k < idx.length; k += 1) {
    const i = idx[k] as number;
    order[k] = i;
    const s = symbols[i] as SymbolInput;
    const kind = kinds[i] as Kind;
    const base = k * 16;
    if (kind === 'sprite') {
      const t = classifySymbolTexture(s.texture);
      const key = t.class === 'asset' ? t.key : '';
      const p = byKey.get(key) as AtlasPlacement;
      const c = Math.cos(s.rotation);
      const sn = Math.sin(s.rotation);
      const f = s.mirror ? -1 : 1;
      const sx = s.scale.x;
      const sy = s.scale.y;
      const a00 = c * sx * f;
      const a01 = -sn * sy;
      const a10 = sn * sx * f;
      const a11 = c * sy;
      const tx = s.position.x + c * sx * s.offset.x - sn * sy * s.offset.y;
      const ty = s.position.y + sn * sx * s.offset.x + c * sy * s.offset.y;
      records[base] = a00;
      records[base + 1] = a01;
      records[base + 2] = a10;
      records[base + 3] = a11;
      records[base + 4] = tx;
      records[base + 5] = ty;
      records[base + 6] = p.x;
      records[base + 7] = p.y;
      records[base + 8] = p.width;
      records[base + 9] = p.height;
      records[base + 10] = p.page;
      records[base + 11] = 1;
      records[base + 12] = 1;
      records[base + 13] = 1;
      records[base + 14] = 1;
      records[base + 15] = 0;
    } else {
      let r = 1;
      let g = 0;
      let b = 1;
      if (kind === 'embedded') {
        r = 0;
        g = 1;
        b = 1;
      } else if (kind === 'invalid') {
        r = 1;
        g = 0;
        b = 1;
      } else if (kind === 'unresolved') {
        r = 1;
        g = 1;
        b = 0;
      } else {
        r = 1;
        g = 0.5;
        b = 0;
      }
      records[base] = 1;
      records[base + 1] = 0;
      records[base + 2] = 0;
      records[base + 3] = 1;
      records[base + 4] = s.position.x;
      records[base + 5] = s.position.y;
      records[base + 6] = ru0;
      records[base + 7] = rv0;
      records[base + 8] = rw;
      records[base + 9] = rh;
      records[base + 10] = rpage;
      records[base + 11] = r;
      records[base + 12] = g;
      records[base + 13] = b;
      records[base + 14] = 1;
      records[base + 15] = 0;
    }
  }

  return {
    ok: true,
    records,
    order,
    counts: {
      total: symbols.length,
      sprites,
      placeholders: { embedded, invalid, unresolved, oversize },
      unapplied: { sample: sampleCount, customColors: customCount },
    },
  };
}

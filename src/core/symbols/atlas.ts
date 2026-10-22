export const RESERVED_BLOCK = 16;

export interface AtlasItem {
  readonly key: string;
  readonly width: number;
  readonly height: number;
}

export interface AtlasPlacement {
  readonly key: string;
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AtlasOptions {
  readonly maxSide: number;
  readonly maxPages: number;
  readonly padding: number;
}

export type AtlasVerdict =
  | {
      readonly ok: true;
      readonly pageSize: number;
      readonly pages: number;
      readonly reserved: AtlasPlacement;
      readonly placements: readonly AtlasPlacement[];
      readonly oversize: readonly string[];
    }
  | { readonly ok: false; readonly code: 'INPUT' | 'LIMIT'; readonly message: string };

interface PageState {
  top: number;
  shelfH: number;
  x: number;
  hasShelf: boolean;
}

function isInt(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n);
}

export function packAtlas(items: readonly AtlasItem[], options: AtlasOptions): AtlasVerdict {
  const count = Array.isArray(items) ? items.length : 0;
  const itemsIsArray = Array.isArray(items);
  if (!itemsIsArray) {
    return { ok: false, code: 'INPUT', message: 'A1: invalid items' };
  }
  if (count > 1_000_000) {
    return { ok: false, code: 'INPUT', message: 'A1: too many items' };
  }
  const opts = options as AtlasOptions | null | undefined;
  const maxSide = opts?.maxSide;
  const maxPages = opts?.maxPages;
  const padding = opts?.padding;
  if (!isInt(maxSide) || (maxSide as number) < 32 || (maxSide as number) > 16384) {
    return { ok: false, code: 'INPUT', message: 'A1: invalid maxSide' };
  }
  if (!isInt(maxPages) || (maxPages as number) < 1) {
    return { ok: false, code: 'INPUT', message: 'A1: invalid maxPages' };
  }
  if (!isInt(padding) || (padding as number) < 0) {
    return { ok: false, code: 'INPUT', message: 'A1: invalid padding' };
  }
  const side = maxSide as number;
  const pagesMax = maxPages as number;
  const pad = padding as number;

  const seen = new Set<string>();
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] as AtlasItem | null | undefined;
    const key = (item as AtlasItem | null)?.key;
    const w = (item as AtlasItem | null)?.width;
    const h = (item as AtlasItem | null)?.height;
    if (typeof key !== 'string' || key.length === 0) {
      return { ok: false, code: 'INPUT', message: 'A1: invalid key' };
    }
    if (!isInt(w) || (w as number) < 1) {
      return { ok: false, code: 'INPUT', message: 'A1: invalid width' };
    }
    if (!isInt(h) || (h as number) < 1) {
      return { ok: false, code: 'INPUT', message: 'A1: invalid height' };
    }
    if (seen.has(key)) {
      return { ok: false, code: 'INPUT', message: 'A1: duplicate key' };
    }
    seen.add(key);
  }

  const oversize: string[] = [];
  const placeable: AtlasItem[] = [];
  for (const item of items) {
    if (item.width > side || item.height > side) {
      oversize.push(item.key);
    } else {
      placeable.push(item);
    }
  }
  oversize.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  placeable.sort((a, b) => {
    if (a.height !== b.height) return b.height - a.height;
    if (a.width !== b.width) return b.width - a.width;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const shelfStart = (page: number): number => (page === 0 ? RESERVED_BLOCK + pad : 0);
  const states: PageState[] = [{ top: 0, shelfH: 0, x: 0, hasShelf: false }];
  const placements: AtlasPlacement[] = [];
  let cur = 0;

  for (const item of placeable) {
    const w = item.width;
    const h = item.height;
    const st = states[cur] as PageState;
    if (st.hasShelf && st.x + w <= side) {
      placements.push({ key: item.key, page: cur, x: st.x, y: st.top, width: w, height: h });
      st.x += w + pad;
      continue;
    }
    const newTop = st.hasShelf ? st.top + st.shelfH + pad : 0;
    const newX = shelfStart(cur);
    if (newX + w <= side && newTop + h <= side) {
      st.top = newTop;
      st.shelfH = h;
      st.x = newX;
      st.hasShelf = true;
      placements.push({ key: item.key, page: cur, x: st.x, y: st.top, width: w, height: h });
      st.x += w + pad;
      continue;
    }
    const next = cur + 1;
    if (next >= pagesMax) {
      return { ok: false, code: 'LIMIT', message: 'A3: page limit exceeded' };
    }
    const fresh: PageState = { top: 0, shelfH: h, x: 0, hasShelf: true };
    fresh.x = w + pad;
    states.push(fresh);
    cur = next;
    placements.push({ key: item.key, page: cur, x: 0, y: 0, width: w, height: h });
  }

  return {
    ok: true,
    pageSize: side,
    pages: states.length,
    reserved: { key: '', page: 0, x: 0, y: 0, width: RESERVED_BLOCK, height: RESERVED_BLOCK },
    placements,
    oversize,
  };
}

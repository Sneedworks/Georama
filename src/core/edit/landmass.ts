// Card 2.5, detail v3.1 (75cb9a9; GREEN 69fc71b): the landmass brush. One stroke becomes the
// tile-write list for one layer of the card 2.4 stack. Core code: no DOM and no Node APIs.
// Card 2.6, detail v1.11 section 4 (extraction base b413894, committed as fd402de): the stroke geometry and its constants live in
// stroke-geometry.ts. The constants are re-exported here, so this file's exports are unchanged.
import type { CellWrite } from './tile-command.ts';
import { strokeCells } from './stroke-geometry.ts';

export { MAX_POINTS, MAX_RADIUS, MAX_STROKE_CELLS, MAX_WORK } from './stroke-geometry.ts';

/** D2: editor convention. A binary mask; the format argument is not a verified export. */
export const LAND = 255;
export const WATER = 0;

export type LandmassCode = 'range' | 'too-large';

export type LandmassVerdict<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: LandmassCode };

export interface StrokeOptions {
  readonly width: number;
  readonly height: number;
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly radius: number;
  readonly paint: 'land' | 'water';
}

/**
 * Turns one stroke into the write list for one layer (D1 to D9). Nothing is written to any grid here; the
 * caller passes the list to one writeTiles call. The geometry and its checks are in strokeCells.
 */
export function strokeWrites(options: StrokeOptions): LandmassVerdict<CellWrite[]> {
  const cells = strokeCells({
    width: options.width,
    height: options.height,
    points: options.points,
    radius: options.radius,
  });
  if (!cells.ok) return { ok: false, code: cells.code };
  const value = options.paint === 'land' ? LAND : WATER;
  const writes: CellWrite[] = cells.value.map(({ x, y }) => ({ x, y, channels: 1, value: new Uint8Array([value]) }));
  return { ok: true, value: writes };
}

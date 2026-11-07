// Card 2.6, detail v1.11 section 4 (GREEN approved at fd402de): the ground tool's pure write builder.
// One brush stroke becomes the tile-write list for one four-channel ground layer, [R, G, B, 255] per cell.
// The geometry (disc, line cells, bounds, limits) is shared with the landmass brush in stroke-geometry.ts.
// Core code: no DOM and no Node APIs. Nothing is written to any grid here; the caller passes the list to
// one writeTiles call, so one stroke is one undo step.
import { strokeCells } from './stroke-geometry.ts';
import type { CellWrite } from './tile-command.ts';

/** D1: the ground layer's channel count. A layer with another count is refused by writeTiles (`channels`). */
export const GROUND_CHANNELS = 4;

export type GroundCode = 'range' | 'too-large';

export type GroundVerdict<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: GroundCode };

/** D2: an RGB triple of integers from 0 to 255. */
export interface GroundColour {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface GroundStrokeOptions {
  readonly width: number;
  readonly height: number;
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly radius: number;
  readonly colour: GroundColour;
}

/** D9 (G): a colour component is an integer from 0 to 255. These are decimal byte values, not limits. */
function isByte(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= 255;
}

/**
 * Turns one stroke into the write list for one four-channel ground layer (D1 to D9). The colour is checked
 * first; the geometry checks and the cell list come from strokeCells. Every write is channels 4 with the
 * value [r, g, b, 255] (D2, F2). A stroke wholly outside the layer gives an empty list.
 */
export function groundWrites(options: GroundStrokeOptions): GroundVerdict<CellWrite[]> {
  const { r, g, b } = options.colour;
  if (!isByte(r) || !isByte(g) || !isByte(b)) return { ok: false, code: 'range' };

  const cells = strokeCells({
    width: options.width,
    height: options.height,
    points: options.points,
    radius: options.radius,
  });
  if (!cells.ok) return { ok: false, code: cells.code };

  const writes: CellWrite[] = cells.value.map(({ x, y }) => ({
    x,
    y,
    channels: GROUND_CHANNELS,
    value: new Uint8Array([r, g, b, 255]),
  }));
  return { ok: true, value: writes };
}

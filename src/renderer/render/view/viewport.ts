export interface ViewState {
  readonly scale: number;
  readonly tx: number;
  readonly ty: number;
}

export const MIN_SCALE = 1 / 256;
export const MAX_SCALE = 64;

export type ViewportErrorCode = 'INPUT' | 'LIMIT';

export type FitViewOk = { ok: true; view: ViewState };
export type FitViewErr = { ok: false; code: ViewportErrorCode; message: string };
export type FitViewVerdict = FitViewOk | FitViewErr;

export type OneToOneOk = { ok: true; view: ViewState };
export type OneToOneErr = { ok: false; code: ViewportErrorCode; message: string };
export type OneToOneVerdict = OneToOneOk | OneToOneErr;

export type MapPointOk = { ok: true; u: number; v: number };
export type MapPointErr = { ok: false; code: ViewportErrorCode; message: string };
export type MapPointVerdict = MapPointOk | MapPointErr;

export type ZoomOk = { ok: true; view: ViewState };
export type ZoomErr = { ok: false; code: ViewportErrorCode; message: string };
export type ZoomVerdict = ZoomOk | ZoomErr;

export type PanOk = { ok: true; view: ViewState };
export type PanErr = { ok: false; code: ViewportErrorCode; message: string };
export type PanVerdict = PanOk | PanErr;

function dimsValid(mapW: number, mapH: number, viewW: number, viewH: number): boolean {
  if (!Number.isFinite(mapW) || !Number.isFinite(mapH)) return false;
  if (!Number.isFinite(viewW) || !Number.isFinite(viewH)) return false;
  if (mapW <= 0 || mapH <= 0 || viewW <= 0 || viewH <= 0) return false;
  return true;
}

export function fitView(
  mapW: number,
  mapH: number,
  viewW: number,
  viewH: number,
): FitViewVerdict {
  if (!dimsValid(mapW, mapH, viewW, viewH)) {
    return { ok: false, code: 'INPUT', message: 'dims must be finite and > 0' };
  }
  const scale = Math.min(viewW / mapW, viewH / mapH);
  if (!scaleWithinLimits(scale)) {
    return { ok: false, code: 'LIMIT', message: 'scale outside limits' };
  }
  const tx = (viewW - mapW * scale) / 2;
  const ty = (viewH - mapH * scale) / 2;
  return { ok: true, view: { scale, tx, ty } };
}

export function oneToOne(
  mapW: number,
  mapH: number,
  viewW: number,
  viewH: number,
): OneToOneVerdict {
  if (!dimsValid(mapW, mapH, viewW, viewH)) {
    return { ok: false, code: 'INPUT', message: 'dims must be finite and > 0' };
  }
  const scale = 1;
  const tx = (viewW - mapW) / 2;
  const ty = (viewH - mapH) / 2;
  return { ok: true, view: { scale, tx, ty } };
}

function scaleWithinLimits(scale: number): boolean {
  return scale >= MIN_SCALE && scale <= MAX_SCALE;
}

function viewValid(view: ViewState): boolean {
  if (view === null || view === undefined) return false;
  if (!Number.isFinite(view.scale) || view.scale <= 0) return false;
  if (!Number.isFinite(view.tx) || !Number.isFinite(view.ty)) return false;
  return true;
}

export function screenToMap(view: ViewState, sx: number, sy: number): MapPointVerdict {
  if (!viewValid(view)) {
    return { ok: false, code: 'INPUT', message: 'view scale must be finite and > 0' };
  }
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
    return { ok: false, code: 'INPUT', message: 'screen point must be finite' };
  }
  const u = (sx - view.tx) / view.scale;
  const v = (sy - view.ty) / view.scale;
  return { ok: true, u, v };
}

export function zoomAt(view: ViewState, factor: number, sx: number, sy: number): ZoomVerdict {
  if (!Number.isFinite(factor) || factor <= 0) {
    return { ok: false, code: 'INPUT', message: 'factor must be finite and > 0' };
  }
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
    return { ok: false, code: 'INPUT', message: 'screen point must be finite' };
  }
  if (!viewValid(view)) {
    return { ok: false, code: 'INPUT', message: 'view scale must be finite and > 0' };
  }
  const u = (sx - view.tx) / view.scale;
  const v = (sy - view.ty) / view.scale;
  const newScale = view.scale * factor;
  if (!scaleWithinLimits(newScale)) {
    return { ok: false, code: 'LIMIT', message: 'scale outside limits' };
  }
  const tx = sx - u * newScale;
  const ty = sy - v * newScale;
  return { ok: true, view: { scale: newScale, tx, ty } };
}

export function panBy(view: ViewState, dx: number, dy: number): PanVerdict {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return { ok: false, code: 'INPUT', message: 'delta must be finite' };
  }
  if (!viewValid(view)) {
    return { ok: false, code: 'INPUT', message: 'view scale must be finite and > 0' };
  }
  return { ok: true, view: { scale: view.scale, tx: view.tx + dx, ty: view.ty + dy } };
}

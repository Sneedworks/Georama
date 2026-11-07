import { describe, expect, it } from 'vitest';
import type { WdScale } from '../../src/core/formats/wonderdraft-map.ts';
import type { ElementView } from '../../src/core/elements/grid.ts';
import { cssRgba, scaleLabelsToPlan, scaleRects } from '../../src/core/elements/scale.ts';

const black = { r: 0, g: 0, b: 0, a: 1 };
const white = { r: 1, g: 1, b: 1, a: 1 };
const red = { r: 1, g: 0, b: 0, a: 1 };

const scale: WdScale = {
  position: { x: 16, y: 160 },
  rotation: 0,
  colors: [black, white, red],
  size: { x: 160, y: 8 },
  segments: 4,
  lineWidth: 6,
  segmentDistance: 100,
  numbersDisplay: 3,
  font: 'sans',
  fontSize: 10,
  outlineWidth: 1,
  fontColor: white,
  outlineColor: black,
  units: 'km',
};
const view: ElementView = { scale: 1, offsetX: 0, offsetY: 0, width: 256, height: 192 };

describe('scaleRects (fixture)', () => {
  it('draws four segments that alternate colours 0 and 1', () => {
    const out = scaleRects(scale, view);
    expect(out.reports).toEqual([]);
    expect(out.rects.map((r) => [r.x0, r.x1, r.y0, r.y1])).toEqual([
      [16, 56, 160, 168],
      [56, 96, 160, 168],
      [96, 136, 160, 168],
      [136, 176, 160, 168],
    ]);
    expect(out.rects.map((r) => r.rgba.join())).toEqual(['0,0,0,1', '1,1,1,1', '0,0,0,1', '1,1,1,1']);
  });

  it('places five labels, the last one carrying the units', () => {
    const out = scaleRects(scale, view);
    expect(out.labels.map((l) => l.id)).toEqual(['scale-0', 'scale-1', 'scale-2', 'scale-3', 'scale-4']);
    expect(out.labels.map((l) => l.text)).toEqual(['0', '100', '200', '300', '400 km']);
    expect(out.labels.map((l) => l.anchorX)).toEqual([16, 56, 96, 136, 176]);
    expect(out.labels.every((l) => l.anchorY === 178)).toBe(true);
    expect(out.labels[4]).toMatchObject({
      fontSize: 10,
      colour: [1, 1, 1, 1],
      outlineSize: 1,
      outlineColour: 'rgba(0, 0, 0, 1)',
    });
  });

  it('scales spans, anchors and the label offset with the view scale', () => {
    const big: ElementView = { scale: 2, offsetX: 0, offsetY: 0, width: 512, height: 384 };
    const out = scaleRects(scale, big);
    expect(out.rects.map((r) => [r.x0, r.x1, r.y0, r.y1])).toEqual([
      [32, 112, 320, 336],
      [112, 192, 320, 336],
      [192, 272, 320, 336],
      [272, 352, 320, 336],
    ]);
    expect(out.labels.map((l) => l.anchorX)).toEqual([32, 112, 192, 272, 352]);
    // y0 + H + fontSize x scale = 320 + 16 + 20
    expect(out.labels.every((l) => l.anchorY === 356)).toBe(true);
  });

  it('reports and draws nothing for each refused record', () => {
    const refused: Array<[WdScale, string]> = [
      [{ ...scale, segments: 0 }, 'segments'],
      [{ ...scale, segments: 33 }, 'segments'],
      [{ ...scale, segments: 1.5 }, 'segments'],
      [{ ...scale, segmentDistance: 0 }, 'distance'],
      [{ ...scale, rotation: 90 }, 'rotation'],
      [{ ...scale, colors: [black] }, 'colours'],
      [{ ...scale, size: { x: 0, y: 8 } }, 'size'],
      [{ ...scale, fontSize: 0 }, 'size'],
    ];
    for (const [record, code] of refused) {
      expect(scaleRects(record, view)).toEqual({ rects: [], labels: [], reports: [{ element: 'scale', code }] });
    }
  });

  it('refuses non-finite and non-positive values', () => {
    const refused: Array<[WdScale, string]> = [
      [{ ...scale, segmentDistance: Number.NaN }, 'distance'],
      [{ ...scale, segmentDistance: -5 }, 'distance'],
      [{ ...scale, segmentDistance: Number.POSITIVE_INFINITY }, 'distance'],
      [{ ...scale, colors: [] }, 'colours'],
      [{ ...scale, rotation: Number.NaN }, 'rotation'],
      [{ ...scale, size: { x: 160, y: -1 } }, 'size'],
    ];
    for (const [record, code] of refused) {
      expect(scaleRects(record, view)).toEqual({ rects: [], labels: [], reports: [{ element: 'scale', code }] });
    }
  });

  it('reports the first failing check only, in the documented order', () => {
    expect(scaleRects({ ...scale, segments: 0, colors: [black] }, view).reports).toEqual([
      { element: 'scale', code: 'segments' },
    ]);
    expect(scaleRects({ ...scale, rotation: 90, size: { x: 0, y: 8 } }, view).reports).toEqual([
      { element: 'scale', code: 'rotation' },
    ]);
  });

  it('applies the view offset and clips a bar that starts off the target', () => {
    const shifted: ElementView = { scale: 1, offsetX: 5, offsetY: 3, width: 256, height: 192 };
    const moved = scaleRects(scale, shifted);
    expect(moved.rects.map((r) => [r.x0, r.x1, r.y0, r.y1])).toEqual([
      [21, 61, 163, 171],
      [61, 101, 163, 171],
      [101, 141, 163, 171],
      [141, 181, 163, 171],
    ]);
    expect(moved.labels.map((l) => l.anchorX)).toEqual([21, 61, 101, 141, 181]);
    expect(moved.labels.every((l) => l.anchorY === 181)).toBe(true);
    // x0 = 16 - 100 = -84: segments 0 and 1 lie wholly left of the target; segment 2 is clipped; segment 3 is kept.
    const left: ElementView = { scale: 1, offsetX: -100, offsetY: 0, width: 256, height: 192 };
    expect(scaleRects(scale, left).rects.map((r) => [r.x0, r.x1])).toEqual([
      [0, 36],
      [36, 76],
    ]);
  });

  it('checks the view first, before the record checks', () => {
    expect(scaleRects({ ...scale, segments: 0 }, { ...view, scale: 0 })).toEqual({
      rects: [],
      labels: [],
      reports: [{ element: 'scale', code: 'INPUT' }],
    });
  });

  it('formats label numbers to 12 significant digits and omits empty units', () => {
    const decimal: WdScale = { ...scale, segments: 3, segmentDistance: 0.1 };
    expect(scaleRects(decimal, view).labels.map((l) => l.text)).toEqual(['0', '0.1', '0.2', '0.3 km']);
    expect(scaleRects({ ...decimal, units: '' }, view).labels.map((l) => l.text)).toEqual(['0', '0.1', '0.2', '0.3']);
  });
});

describe('cssRgba', () => {
  it('converts channels with floor(255 x c + 0.5) and keeps alpha', () => {
    expect(cssRgba([1, 1, 1, 1])).toBe('rgba(255, 255, 255, 1)');
    expect(cssRgba([0, 0, 0, 1])).toBe('rgba(0, 0, 0, 1)');
    expect(cssRgba([0.5, 0, 0, 0.25])).toBe('rgba(128, 0, 0, 0.25)');
  });
});

describe('scaleLabelsToPlan', () => {
  it('maps the first scale label to the origin anchor', () => {
    const first = scaleLabelsToPlan(scaleRects(scale, view).labels)[0];
    expect(first).toMatchObject({ id: 'scale-0', text: '0', anchor: { x: 16, y: 178 } });
  });

  it('maps the last scale label to a plan label with the fixed fields', () => {
    const labels = scaleRects(scale, view).labels;
    expect(scaleLabelsToPlan(labels)[4]).toEqual({
      id: 'scale-4',
      text: '400 km',
      anchor: { x: 176, y: 178 },
      rotation: 0,
      size: 10,
      curve: 0,
      extraSpacingChar: 0,
      familyKey: 'sans',
      outlineSize: 1,
      outlineColour: 'rgba(0, 0, 0, 1)',
      colour: [1, 1, 1, 1],
    });
  });
});

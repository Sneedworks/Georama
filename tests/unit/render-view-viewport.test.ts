import { describe, expect, it } from 'vitest';
import {
  MIN_SCALE,
  MAX_SCALE,
  fitView,
  oneToOne,
  screenToMap,
  zoomAt,
  panBy,
} from '../../src/renderer/render/view/viewport';

describe('viewport constants', () => {
  it('exposes the scale limits', () => {
    expect(MIN_SCALE).toBe(1 / 256);
    expect(MAX_SCALE).toBe(64);
  });
});

describe('fitView', () => {
  it('fits 1024x512 into 512x512', () => {
    const r = fitView(1024, 512, 512, 512);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.view.scale).toBe(0.5);
      expect(r.view.tx).toBe(0);
      expect(r.view.ty).toBe(128);
    }
  });

  it('rejects zero map width as INPUT', () => {
    const r = fitView(0, 512, 512, 512);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('rejects negative view height as INPUT', () => {
    const r = fitView(1024, 512, 512, -1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('rejects NaN as INPUT', () => {
    const r = fitView(Number.NaN, 512, 512, 512);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('rejects Infinity as INPUT', () => {
    const r = fitView(1024, 512, Number.POSITIVE_INFINITY, 512);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('rejects scale above MAX as LIMIT', () => {
    const r = fitView(1, 1, 128, 128);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('LIMIT');
  });

  it('rejects scale below MIN as LIMIT', () => {
    const r = fitView(1024, 1024, 1, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('LIMIT');
  });

  it('rejects horizontal translation overflow from finite dimensions as LIMIT', () => {
    const r = fitView(1.7191700431418136e308, 1, Number.MAX_VALUE, Number.MAX_VALUE);
    expect(r).toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('rejects vertical translation overflow from finite dimensions as LIMIT', () => {
    const r = fitView(1, 1.7191700431418136e308, Number.MAX_VALUE, Number.MAX_VALUE);
    expect(r).toMatchObject({ ok: false, code: 'LIMIT' });
  });
});

describe('oneToOne', () => {
  it('centers 1024x512 in 512x512 at scale 1', () => {
    const r = oneToOne(1024, 512, 512, 512);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.view.scale).toBe(1);
      expect(r.view.tx).toBe(-256);
      expect(r.view.ty).toBe(0);
    }
  });

  it('rejects zero view width as INPUT', () => {
    const r = oneToOne(1024, 512, 0, 512);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('rejects NaN map height as INPUT', () => {
    const r = oneToOne(1024, Number.NaN, 512, 512);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('keeps translations finite for extreme finite dimensions', () => {
    const r = oneToOne(Number.MAX_VALUE, 1, 1, Number.MAX_VALUE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Number.isFinite(r.view.tx)).toBe(true);
      expect(Number.isFinite(r.view.ty)).toBe(true);
    }
  });
});

describe('screenToMap', () => {
  it('maps screen to map through the one-to-one view', () => {
    const r = screenToMap({ scale: 1, tx: -256, ty: 0 }, 256, 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.u).toBe(512);
      expect(r.v).toBe(0);
    }
  });

  it('maps screen to map through the fit view', () => {
    const r = screenToMap({ scale: 0.5, tx: 0, ty: 128 }, 0, 128);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.u).toBe(0);
      expect(r.v).toBe(0);
    }
  });

  it('rejects zero scale as INPUT', () => {
    const r = screenToMap({ scale: 0, tx: 0, ty: 0 }, 10, 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('rejects NaN screen x as INPUT', () => {
    const r = screenToMap({ scale: 1, tx: 0, ty: 0 }, Number.NaN, 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('rejects Infinity screen y as INPUT', () => {
    const r = screenToMap({ scale: 1, tx: 0, ty: 0 }, 10, Number.POSITIVE_INFINITY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });
});

describe('zoomAt', () => {
  it('keeps the map point under the cursor fixed at factor 2', () => {
    const view = { scale: 1, tx: -256, ty: 0 };
    const sx = 256;
    const sy = 256;
    const before = screenToMap(view, sx, sy);
    const z = zoomAt(view, 2, sx, sy);
    expect(z.ok).toBe(true);
    if (z.ok && before.ok) {
      expect(z.view.scale).toBe(2);
      const after = screenToMap(z.view, sx, sy);
      expect(after.ok).toBe(true);
      if (after.ok) {
        expect(after.u).toBe(before.u);
        expect(after.v).toBe(before.v);
      }
    }
  });

  it('rejects zoom past MAX as LIMIT', () => {
    const r = zoomAt({ scale: 64, tx: 0, ty: 0 }, 2, 0, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('LIMIT');
  });

  it('rejects zoom below MIN as LIMIT', () => {
    const r = zoomAt({ scale: 1 / 256, tx: 0, ty: 0 }, 0.5, 0, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('LIMIT');
  });

  it('rejects zero factor as INPUT', () => {
    const r = zoomAt({ scale: 1, tx: 0, ty: 0 }, 0, 10, 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('rejects NaN anchor as INPUT', () => {
    const r = zoomAt({ scale: 1, tx: 0, ty: 0 }, 2, Number.NaN, 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('rejects zero-scale view as INPUT', () => {
    const r = zoomAt({ scale: 0, tx: 0, ty: 0 }, 2, 10, 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('rejects Infinity anchor y as INPUT', () => {
    const r = zoomAt({ scale: 1, tx: 0, ty: 0 }, 2, 10, Number.POSITIVE_INFINITY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });
});

describe('panBy', () => {
  it('shifts tx and ty and keeps scale', () => {
    const r = panBy({ scale: 1, tx: -256, ty: 0 }, 10, 20);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.view.scale).toBe(1);
      expect(r.view.tx).toBe(-246);
      expect(r.view.ty).toBe(20);
    }
  });

  it('rejects NaN dx as INPUT', () => {
    const r = panBy({ scale: 1, tx: 0, ty: 0 }, Number.NaN, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('rejects infinite dy as INPUT', () => {
    const r = panBy({ scale: 1, tx: 0, ty: 0 }, 5, Number.POSITIVE_INFINITY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('rejects zero-scale view as INPUT', () => {
    const r = panBy({ scale: 0, tx: 0, ty: 0 }, 5, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });
});

describe('viewport strength: boundary, non-finite and centering cases', () => {
  it('fitView rejects zero map height as INPUT', () => {
    const r = fitView(512, 0, 512, 512);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('fitView rejects zero view height as INPUT', () => {
    const r = fitView(512, 512, 512, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('fitView rejects NaN and Infinity view height as INPUT', () => {
    const nan = fitView(1024, 512, 512, Number.NaN);
    const inf = fitView(1024, 512, 512, Number.POSITIVE_INFINITY);
    expect(nan.ok).toBe(false);
    expect(inf.ok).toBe(false);
    if (!nan.ok) expect(nan.code).toBe('INPUT');
    if (!inf.ok) expect(inf.code).toBe('INPUT');
  });

  it('fitView keeps the exact MIN_SCALE and MAX_SCALE bounds', () => {
    const lo = fitView(256, 256, 1, 1);
    const hi = fitView(8, 8, 512, 512);
    expect(lo.ok).toBe(true);
    expect(hi.ok).toBe(true);
    if (lo.ok) expect(lo.view.scale).toBe(MIN_SCALE);
    if (hi.ok) expect(hi.view.scale).toBe(MAX_SCALE);
  });

  it('fitView centers horizontally when the map is taller than the view is wide', () => {
    const r = fitView(512, 1024, 512, 512);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.view.scale).toBe(0.5);
      expect(r.view.tx).toBe(128);
      expect(r.view.ty).toBe(0);
    }
  });

  it('oneToOne centers vertically when the map is shorter than the view', () => {
    const r = oneToOne(512, 256, 512, 512);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.view.scale).toBe(1);
      expect(r.view.tx).toBe(0);
      expect(r.view.ty).toBe(128);
    }
  });

  it('screenToMap, zoomAt and panBy reject null and undefined views as INPUT', () => {
    const a = screenToMap(undefined as never, 10, 10);
    const b = zoomAt(null as never, 2, 10, 10);
    const c = panBy(undefined as never, 1, 1);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(c.ok).toBe(false);
    if (!a.ok) expect(a.code).toBe('INPUT');
    if (!b.ok) expect(b.code).toBe('INPUT');
    if (!c.ok) expect(c.code).toBe('INPUT');
  });

  it('screenToMap rejects a non-finite view scale as INPUT', () => {
    const nan = screenToMap({ scale: Number.NaN, tx: 0, ty: 0 }, 10, 10);
    const inf = screenToMap({ scale: Number.POSITIVE_INFINITY, tx: 0, ty: 0 }, 10, 10);
    expect(nan.ok).toBe(false);
    expect(inf.ok).toBe(false);
    if (!nan.ok) expect(nan.code).toBe('INPUT');
    if (!inf.ok) expect(inf.code).toBe('INPUT');
  });

  it('panBy rejects a non-finite view translation as INPUT', () => {
    const txBad = panBy({ scale: 1, tx: Number.NaN, ty: 0 }, 1, 1);
    const tyBad = panBy({ scale: 1, tx: 0, ty: Number.POSITIVE_INFINITY }, 1, 1);
    expect(txBad.ok).toBe(false);
    expect(tyBad.ok).toBe(false);
    if (!txBad.ok) expect(txBad.code).toBe('INPUT');
    if (!tyBad.ok) expect(tyBad.code).toBe('INPUT');
  });

  it('zoomAt rejects a non-finite factor as INPUT', () => {
    const nan = zoomAt({ scale: 1, tx: 0, ty: 0 }, Number.NaN, 10, 10);
    const inf = zoomAt({ scale: 1, tx: 0, ty: 0 }, Number.POSITIVE_INFINITY, 10, 10);
    expect(nan.ok).toBe(false);
    expect(inf.ok).toBe(false);
    if (!nan.ok) expect(nan.code).toBe('INPUT');
    if (!inf.ok) expect(inf.code).toBe('INPUT');
  });

  it('zoomAt keeps the anchor fixed on a non-zero vertical offset', () => {
    const z = zoomAt({ scale: 1, tx: 0, ty: 10 }, 2, 100, 100);
    expect(z.ok).toBe(true);
    if (z.ok) {
      expect(z.view.tx).toBe(-100);
      expect(z.view.ty).toBe(-80);
      const after = screenToMap(z.view, 100, 100);
      expect(after.ok).toBe(true);
      if (after.ok) {
        expect(after.u).toBe(100);
        expect(after.v).toBe(90);
      }
    }
  });
});

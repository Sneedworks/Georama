import { describe, expect, it } from 'vitest';
import { panBy, screenToMap, zoomAt } from '../../src/renderer/render/view/viewport.ts';

const MAX = Number.MAX_VALUE;
const MIN_SCALE = 1 / 256;

describe('viewport arithmetic overflow', () => {
  it('screenToMap rejects x subtraction overflow from finite inputs', () => {
    expect(screenToMap({ scale: 1, tx: -MAX, ty: 0 }, MAX, 0))
      .toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('screenToMap rejects y subtraction overflow from finite inputs', () => {
    expect(screenToMap({ scale: 1, tx: 0, ty: MAX }, 0, -MAX))
      .toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('screenToMap rejects x division overflow at the supported minimum scale', () => {
    expect(screenToMap({ scale: MIN_SCALE, tx: 0, ty: 0 }, MAX, 0))
      .toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('screenToMap rejects y division overflow at the supported minimum scale', () => {
    expect(screenToMap({ scale: MIN_SCALE, tx: 0, ty: 0 }, 0, -MAX))
      .toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('screenToMap keeps representable large coordinates valid', () => {
    const result = screenToMap({ scale: MIN_SCALE, tx: 0, ty: 0 }, MAX / 512, 0);
    expect(result).toEqual({ ok: true, u: MAX / 2, v: 0 });
  });

  it('zoomAt rejects overflow while computing the horizontal map anchor', () => {
    expect(zoomAt({ scale: 1, tx: -MAX, ty: 0 }, 2, MAX, 0))
      .toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('zoomAt rejects overflow while computing the vertical map anchor', () => {
    expect(zoomAt({ scale: 1, tx: 0, ty: MAX }, 2, 0, -MAX))
      .toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('zoomAt rejects horizontal translation overflow even when the map anchor is finite', () => {
    // u = MAX is finite; u * newScale (64) is not.
    expect(zoomAt({ scale: 1, tx: 0, ty: 0 }, 64, MAX, 0))
      .toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('zoomAt rejects vertical translation overflow even when the map anchor is finite', () => {
    expect(zoomAt({ scale: 1, tx: 0, ty: 0 }, 64, 0, -MAX))
      .toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('zoomAt preserves finite translations at the maximum supported zoom', () => {
    expect(zoomAt({ scale: 1, tx: 0, ty: 0 }, 64, 1, -2))
      .toEqual({ ok: true, view: { scale: 64, tx: -63, ty: 126 } });
  });

  it('panBy rejects positive horizontal translation overflow', () => {
    expect(panBy({ scale: 1, tx: MAX, ty: 0 }, MAX, 0))
      .toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('panBy rejects negative vertical translation overflow', () => {
    expect(panBy({ scale: 1, tx: 0, ty: -MAX }, 0, -MAX))
      .toMatchObject({ ok: false, code: 'LIMIT' });
  });

  it('panBy keeps finite extreme translations, including the representable limits', () => {
    expect(panBy({ scale: 1, tx: MAX / 2, ty: -MAX / 2 }, MAX / 2, -MAX / 2))
      .toEqual({ ok: true, view: { scale: 1, tx: MAX, ty: -MAX } });
  });
});

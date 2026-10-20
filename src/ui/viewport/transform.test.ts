import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  clampView,
  fitScale,
  fitView,
  imageToScreen,
  panBy,
  screenToImage,
  viewScale,
  zoomAbout,
  zoomTo,
} from './transform';

const image = { width: 2000, height: 1000 };
const box = { width: 400, height: 600 };

describe('fit', () => {
  it('fits the limiting side', () => {
    expect(fitScale(image, box)).toBeCloseTo(0.2);
    expect(fitScale({ width: 1000, height: 2000 }, box)).toBeCloseTo(0.3);
  });

  it('can upscale small images to fit', () => {
    expect(fitScale({ width: 100, height: 100 }, { width: 400, height: 400 })).toBe(4);
  });

  it('is safe for degenerate sizes', () => {
    expect(fitScale({ width: 0, height: 0 }, box)).toBe(1);
    expect(fitScale(image, { width: 0, height: 0 })).toBe(1);
  });

  it('centres the fitted image', () => {
    const v = fitView(image, box);
    expect(v.zoom).toBe(1);
    expect(v.tx).toBeCloseTo(0);
    expect(v.ty).toBeCloseTo((600 - 200) / 2);
    expect(imageToScreen(v, image, box, { x: 1000, y: 500 })).toEqual({ x: 200, y: 300 });
  });
});

describe('zoom', () => {
  it('keeps the anchor point fixed', () => {
    const v0 = fitView(image, box);
    const anchor = { x: 300, y: 320 };
    const before = screenToImage(v0, image, box, anchor);
    // 4x is large enough that the image covers the box on both axes, so no clamping interferes.
    const v1 = zoomAbout(v0, image, box, 4, anchor);
    expect(v1.zoom).toBeCloseTo(4);
    const after = screenToImage(v1, image, box, anchor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('clamps to 1x..8x of fit', () => {
    const v0 = fitView(image, box);
    expect(zoomAbout(v0, image, box, 0.1, { x: 10, y: 10 }).zoom).toBe(1);
    expect(zoomAbout(v0, image, box, 100, { x: 10, y: 10 }).zoom).toBe(MAX_ZOOM);
    expect(zoomTo(v0, image, box, 50, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
    expect(zoomTo(v0, image, box, NaN, { x: 0, y: 0 }).zoom).toBe(1);
  });

  it('returns to the centred fit when zooming back out', () => {
    const v0 = fitView(image, box);
    const zoomed = zoomAbout(v0, image, box, 4, { x: 380, y: 590 });
    const back = zoomAbout(zoomed, image, box, 0.01, { x: 380, y: 590 });
    expect(back).toEqual(v0);
  });

  it('scale is fit scale times zoom', () => {
    const v = zoomTo(fitView(image, box), image, box, 2, { x: 200, y: 300 });
    expect(viewScale(v, image, box)).toBeCloseTo(0.4);
  });
});

describe('pan', () => {
  it('does not pan at fit zoom when the image fits that axis', () => {
    const v0 = fitView(image, box);
    const v1 = panBy(v0, image, box, 50, 80);
    expect(v1).toEqual(v0);
  });

  it('pans when zoomed in and clamps at the edges', () => {
    const v0 = zoomTo(fitView(image, box), image, box, 4, { x: 200, y: 300 });
    const s = viewScale(v0, image, box); // 0.8
    const contentW = image.width * s; // 1600
    const right = panBy(v0, image, box, 100000, 0);
    expect(right.tx).toBe(0);
    const left = panBy(v0, image, box, -100000, 0);
    expect(left.tx).toBeCloseTo(box.width - contentW);
    const moved = panBy(v0, image, box, 10, 0);
    expect(moved.tx).toBeCloseTo(Math.min(0, v0.tx + 10));
  });

  it('keeps no gaps at any edge after clamping', () => {
    const v = clampView({ zoom: 3, tx: 999, ty: -999 }, image, box);
    const s = viewScale(v, image, box);
    expect(v.tx).toBeLessThanOrEqual(0);
    expect(v.tx + image.width * s).toBeGreaterThanOrEqual(box.width - 1e-9);
    expect(v.ty).toBeLessThanOrEqual(0);
    expect(v.ty + image.height * s).toBeGreaterThanOrEqual(box.height - 1e-9);
  });
});

describe('coordinate mapping', () => {
  it('round-trips screen and image coordinates', () => {
    const v = zoomAbout(fitView(image, box), image, box, 2.5, { x: 123, y: 456 });
    const p = { x: 777, y: 333 };
    const s = imageToScreen(v, image, box, p);
    const back = screenToImage(v, image, box, s);
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it('maps image corners onto the box at fit', () => {
    const v = fitView({ width: 400, height: 600 }, box);
    expect(imageToScreen(v, { width: 400, height: 600 }, box, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(imageToScreen(v, { width: 400, height: 600 }, box, { x: 400, y: 600 })).toEqual({
      x: 400,
      y: 600,
    });
  });
});

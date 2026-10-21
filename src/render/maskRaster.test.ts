import { describe, expect, it } from 'vitest';
import { centredFrame } from '../model/coords';
import {
  brushAlpha,
  finishOutline,
  greyscaleToRgba,
  imageLengthToMaskPx,
  imageToMaskPx,
  maskRectPx,
  maskSizeFor,
  maskToImagePx,
  polygonArea,
  rgbaToGreyscale,
  simplifyRDP,
  stampSoftCircle,
  strokeSpacing,
  strokeStamps,
  wholeImageMaskRect,
} from './maskRaster';

describe('maskSizeFor', () => {
  it('caps the long side at 512 and keeps the aspect', () => {
    expect(maskSizeFor(2048, 1536)).toEqual({ width: 512, height: 384 });
    expect(maskSizeFor(1000, 2000)).toEqual({ width: 256, height: 512 });
  });
  it('never enlarges small images', () => {
    expect(maskSizeFor(200, 100)).toEqual({ width: 200, height: 100 });
  });
  it('is at least 1 px per side', () => {
    expect(maskSizeFor(10000, 1)).toEqual({ width: 512, height: 1 });
  });
});

describe('mask geometry', () => {
  const frame = { width: 800, height: 600, fixation: { x: 300, y: 200 } };
  it('whole-image rect covers exactly the image', () => {
    const rect = maskRectPx(wholeImageMaskRect(frame), frame);
    expect(rect.x).toBeCloseTo(0);
    expect(rect.y).toBeCloseTo(0);
    expect(rect.width).toBeCloseTo(800);
    expect(rect.height).toBeCloseTo(600);
  });
  it('maps image px to mask px and back', () => {
    const rect = { x: 0, y: 0, width: 800, height: 600 };
    const m = imageToMaskPx({ x: 400, y: 150 }, rect, 512, 384);
    expect(m).toEqual({ x: 256, y: 96 });
    const back = maskToImagePx(m, rect, 512, 384);
    expect(back.x).toBeCloseTo(400);
    expect(back.y).toBeCloseTo(150);
  });
  it('honours a rect that does not start at the origin', () => {
    const rect = { x: 100, y: 50, width: 200, height: 100 };
    expect(imageToMaskPx({ x: 100, y: 50 }, rect, 20, 10)).toEqual({ x: 0, y: 0 });
    expect(imageToMaskPx({ x: 300, y: 150 }, rect, 20, 10)).toEqual({ x: 20, y: 10 });
  });
  it('scales lengths', () => {
    expect(imageLengthToMaskPx(100, { x: 0, y: 0, width: 1000, height: 500 }, 500, 250)).toBeCloseTo(50);
  });
  it('centred frame mask rect starts at minus half the image', () => {
    const r = wholeImageMaskRect(centredFrame(800, 600));
    expect(r.x).toBeCloseTo(-400 / 600);
    expect(r.width).toBeCloseTo(800 / 600);
  });
});

describe('brushAlpha', () => {
  it('is 1 at the centre, 0 at and beyond the radius, and falls monotonically', () => {
    expect(brushAlpha(0, 10, 0.5)).toBe(1);
    expect(brushAlpha(10, 10, 0.5)).toBe(0);
    expect(brushAlpha(12, 10, 0.5)).toBe(0);
    let last = 1;
    for (let d = 0; d <= 10; d += 0.5) {
      const a = brushAlpha(d, 10, 0.8);
      expect(a).toBeLessThanOrEqual(last + 1e-9);
      last = a;
    }
  });
  it('a hard brush is full strength until the last pixel', () => {
    expect(brushAlpha(8.9, 10, 0)).toBe(1);
    expect(brushAlpha(9.5, 10, 0)).toBeGreaterThan(0);
    expect(brushAlpha(9.5, 10, 0)).toBeLessThan(1);
  });
});

describe('stampSoftCircle', () => {
  const w = 21;
  const h = 21;
  it('paints a round dab and leaves the rest alone', () => {
    const buf = new Uint8Array(w * h);
    stampSoftCircle(buf, w, h, 10.5, 10.5, 5, 0.3, 'paint');
    expect(buf[10 * w + 10]).toBe(255);
    expect(buf[0]).toBe(0);
    expect(buf[10 * w + 20]).toBe(0);
    const painted = buf.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
    expect(painted).toBeGreaterThan(60);
    expect(painted).toBeLessThan(110);
  });
  it('is soft: edge values lie strictly between 0 and 255', () => {
    const buf = new Uint8Array(w * h);
    stampSoftCircle(buf, w, h, 10.5, 10.5, 8, 0.9, 'paint');
    const mid = buf[10 * w + 16] as number;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(255);
  });
  it('repeating a dab does not build up', () => {
    const a = new Uint8Array(w * h);
    stampSoftCircle(a, w, h, 10.5, 10.5, 6, 0.6, 'paint');
    const b = a.slice();
    stampSoftCircle(b, w, h, 10.5, 10.5, 6, 0.6, 'paint');
    expect(b).toEqual(a);
  });
  it('erase removes paint and never adds it', () => {
    const buf = new Uint8Array(w * h).fill(255);
    stampSoftCircle(buf, w, h, 10.5, 10.5, 5, 0.3, 'erase');
    expect(buf[10 * w + 10]).toBe(0);
    expect(buf[0]).toBe(255);
    const blank = new Uint8Array(w * h);
    stampSoftCircle(blank, w, h, 10.5, 10.5, 5, 0.3, 'erase');
    expect(blank.every((v) => v === 0)).toBe(true);
  });
  it('clips at the edges without throwing', () => {
    const buf = new Uint8Array(w * h);
    stampSoftCircle(buf, w, h, -3, -3, 6, 0.5, 'paint');
    stampSoftCircle(buf, w, h, 100, 100, 6, 0.5, 'paint');
    expect(buf[0]).toBeGreaterThan(0);
  });
  it('ignores bad input', () => {
    const buf = new Uint8Array(w * h);
    stampSoftCircle(buf, w, h, NaN, 5, 5, 0.5, 'paint');
    stampSoftCircle(buf, w, h, 5, 5, 0, 0.5, 'paint');
    expect(buf.every((v) => v === 0)).toBe(true);
  });
});

describe('strokeStamps', () => {
  it('stamps the first point once', () => {
    expect(strokeStamps(null, { x: 5, y: 5 }, 2, 0)).toEqual({ stamps: [{ x: 5, y: 5 }], carry: 0 });
  });
  it('places stamps at the requested spacing', () => {
    const r = strokeStamps({ x: 0, y: 0 }, { x: 10, y: 0 }, 2, 0);
    expect(r.stamps.map((s) => s.x)).toEqual([2, 4, 6, 8, 10]);
    expect(r.carry).toBeCloseTo(0);
  });
  it('carries the remainder across segments so spacing stays even', () => {
    const a = strokeStamps({ x: 0, y: 0 }, { x: 5, y: 0 }, 2, 0);
    expect(a.stamps.map((s) => s.x)).toEqual([2, 4]);
    expect(a.carry).toBeCloseTo(1);
    const b = strokeStamps({ x: 5, y: 0 }, { x: 9, y: 0 }, 2, a.carry);
    expect(b.stamps.map((s) => s.x)).toEqual([6, 8]);
    expect(b.carry).toBeCloseTo(1);
  });
  it('a segment shorter than the remaining gap adds only to the carry', () => {
    const r = strokeStamps({ x: 0, y: 0 }, { x: 0.5, y: 0 }, 2, 0.5);
    expect(r.stamps).toEqual([]);
    expect(r.carry).toBeCloseTo(1);
  });
  it('handles zero-length and diagonal segments', () => {
    expect(strokeStamps({ x: 1, y: 1 }, { x: 1, y: 1 }, 2, 0.7)).toEqual({ stamps: [], carry: 0.7 });
    const d = strokeStamps({ x: 0, y: 0 }, { x: 3, y: 4 }, 2.5, 0);
    expect(d.stamps).toHaveLength(2);
    expect(d.stamps[1]).toEqual({ x: 3, y: 4 });
  });
  it('spacing is a quarter radius with a floor', () => {
    expect(strokeSpacing(20)).toBe(5);
    expect(strokeSpacing(1)).toBe(0.5);
  });
});

describe('rgbaToGreyscale / greyscaleToRgba', () => {
  it('converts luma and weights by alpha', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 0, 255, 0, 0, 255]);
    const g = rgbaToGreyscale(rgba, 4, 1);
    expect(g[0]).toBe(255);
    expect(g[1]).toBe(0);
    expect(g[2]).toBe(0);
    expect(g[3]).toBe(76);
  });
  it('round-trips greyscale through RGBA', () => {
    const grey = new Uint8Array([0, 10, 128, 255]);
    expect(rgbaToGreyscale(greyscaleToRgba(grey), 4, 1)).toEqual(grey);
  });
});

describe('simplifyRDP', () => {
  it('keeps the ends and drops points on a straight line', () => {
    const line: [number, number][] = Array.from({ length: 50 }, (_, i) => [i * 0.01, 0]);
    expect(simplifyRDP(line, 0.003)).toEqual([[0, 0], [0.49, 0]]);
  });
  it('keeps real corners', () => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 10; i++) pts.push([i * 0.01, 0]);
    for (let i = 1; i <= 10; i++) pts.push([0.1, i * 0.01]);
    const out = simplifyRDP(pts, 0.003);
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual([0.1, 0]);
  });
  it('drops small wobble within tolerance but keeps big deviations', () => {
    const wobble: [number, number][] = [[0, 0], [0.1, 0.001], [0.2, -0.001], [0.3, 0]];
    expect(simplifyRDP(wobble, 0.003)).toHaveLength(2);
    expect(simplifyRDP([[0, 0], [0.1, 0.05], [0.2, 0]], 0.003)).toHaveLength(3);
  });
  it('passes tiny inputs through and does not mutate', () => {
    const two: [number, number][] = [[0, 0], [1, 1]];
    const out = simplifyRDP(two, 0.1);
    expect(out).toEqual(two);
    expect(out).not.toBe(two);
  });
  it('copes with a long trace', () => {
    const pts: [number, number][] = Array.from({ length: 5000 }, (_, i) => [Math.cos(i / 800) * 0.2, Math.sin(i / 800) * 0.2]);
    const out = simplifyRDP(pts, 0.003);
    expect(out.length).toBeGreaterThan(8);
    expect(out.length).toBeLessThan(200);
  });
});

describe('finishOutline', () => {
  const circle = (n: number, r: number): [number, number][] =>
    Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]);

  it('simplifies a dense circle but keeps its area', () => {
    const trace = [...circle(400, 0.1), [0.1, 0]] as [number, number][];
    const out = finishOutline(trace);
    expect(out).not.toBeNull();
    expect((out as unknown[]).length).toBeGreaterThanOrEqual(8);
    expect((out as unknown[]).length).toBeLessThan(60);
    expect(polygonArea(out as [number, number][])).toBeCloseTo(Math.PI * 0.01, 2);
  });
  it('drops a closing point that lands on the start', () => {
    const out = finishOutline([[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0.0005, 0.0005]]);
    expect(out).toHaveLength(4);
  });
  it('rejects fewer than 3 points and zero-area traces', () => {
    expect(finishOutline([[0, 0], [0.1, 0]])).toBeNull();
    expect(finishOutline([[0, 0], [0.1, 0], [0.2, 0], [0.3, 0]])).toBeNull();
    expect(finishOutline([[0, 0], [0.0001, 0], [0.0002, 0.0001]])).toBeNull();
  });
});

describe('polygonArea', () => {
  it('measures a unit square either way round', () => {
    expect(polygonArea([[0, 0], [1, 0], [1, 1], [0, 1]])).toBeCloseTo(1);
    expect(polygonArea([[0, 1], [1, 1], [1, 0], [0, 0]])).toBeCloseTo(1);
  });
});

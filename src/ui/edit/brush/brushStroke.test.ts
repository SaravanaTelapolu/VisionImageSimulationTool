import { describe, expect, it } from 'vitest';
import type { MaskData } from '../../../render/shapeCoverage';
import { createBrushStroke, sameMask } from './brushStroke';

function blank(w: number, h: number): MaskData {
  return { width: w, height: h, data: new Uint8Array(w * h) };
}

describe('createBrushStroke', () => {
  const rect = { x: 0, y: 0, width: 400, height: 300 };

  it('paints a single dab at the touch point (image px -> mask px)', () => {
    const mask = blank(100, 75); // 4 image px per mask px
    createBrushStroke({ mask, rect, diameter: 40, softness: 0.3, mode: 'paint' }).add({ x: 200, y: 150 });
    expect(mask.data[37 * 100 + 50]).toBe(255);
    expect(mask.data[0]).toBe(0);
    const painted = mask.data.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
    expect(painted).toBeGreaterThan(50); // radius 5 mask px ~ 78 px area
    expect(painted).toBeLessThan(110);
  });

  it('joins points into a continuous line with no gaps', () => {
    const mask = blank(100, 75);
    const s = createBrushStroke({ mask, rect, diameter: 24, softness: 0.2, mode: 'paint' });
    s.add({ x: 40, y: 150 });
    s.add({ x: 360, y: 150 }); // one long jump
    for (let x = 10; x <= 90; x++) expect(mask.data[37 * 100 + x]).toBeGreaterThan(200);
  });

  it('erase clears what paint made', () => {
    const mask = blank(100, 75);
    createBrushStroke({ mask, rect, diameter: 60, softness: 0.3, mode: 'paint' }).add({ x: 200, y: 150 });
    expect(mask.data[37 * 100 + 50]).toBe(255);
    createBrushStroke({ mask, rect, diameter: 20, softness: 0.3, mode: 'erase' }).add({ x: 200, y: 150 });
    expect(mask.data[37 * 100 + 50]).toBe(0);
    expect(mask.data[37 * 100 + 54]).toBe(255); // outside the small eraser
  });

  it('respects a mask rect that is offset in the image', () => {
    const mask = blank(50, 50);
    const offset = { x: 100, y: 100, width: 100, height: 100 };
    createBrushStroke({ mask, rect: offset, diameter: 10, softness: 0, mode: 'paint' }).add({ x: 150, y: 150 });
    expect(mask.data[25 * 50 + 25]).toBe(255);
    createBrushStroke({ mask, rect: offset, diameter: 10, softness: 0, mode: 'paint' }).add({ x: 50, y: 50 }); // off the mask
    expect(mask.data[0]).toBe(0);
  });

  it('ignores non-finite points', () => {
    const mask = blank(10, 10);
    createBrushStroke({ mask, rect: { x: 0, y: 0, width: 10, height: 10 }, diameter: 4, softness: 0, mode: 'paint' }).add({ x: NaN, y: 1 });
    expect(mask.data.every((v) => v === 0)).toBe(true);
  });
});

describe('sameMask', () => {
  it('compares pixels and size', () => {
    const a = blank(4, 4);
    const b = blank(4, 4);
    expect(sameMask(a, b)).toBe(true);
    b.data[3] = 1;
    expect(sameMask(a, b)).toBe(false);
    expect(sameMask(a, blank(2, 8))).toBe(false);
  });
});

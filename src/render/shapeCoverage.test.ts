import { describe, expect, it } from 'vitest';
import { centredFrame } from '../model/coords';
import type { RectShape } from '../model/types';
import { createCoverageSampler, type CoverageSampler } from './shapeCoverage';

// 200 x 200 image on a 200 x 200 map: one map pixel = one image pixel, fixation at (100, 100).
// Shape units: 1 = 200 px, so rx 0.2 = 40 px.
const frame = centredFrame(200, 200);
const MAP = 200;

function rect(rx: number, ry: number, rotation = 0, cx = 0, cy = 0): RectShape {
  return { type: 'rect', cx, cy, rx, ry, rotation };
}

function sampler(shape: RectShape, feather: number): CoverageSampler {
  const s = createCoverageSampler(shape, feather, frame, MAP, MAP);
  if (!s) throw new Error('expected a sampler');
  return s;
}

/** Coverage at image pixel (x, y), using the map pixel whose centre is (x + 0.5, y + 0.5). */
function at(s: CoverageSampler, x: number, y: number): number {
  if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) return 0;
  return s.sample(x, y);
}

describe('rect coverage', () => {
  it('is 1 in the middle and 0 far outside', () => {
    for (const f of [0, 0.3, 1]) {
      const s = sampler(rect(0.2, 0.1), f);
      // Pixel centre (100.5, 100.5) is half a pixel off-centre, so feather 1 is a hair below 1 there.
      expect(at(s, 100, 100)).toBeCloseTo(1, 2);
      expect(at(s, 199, 199)).toBe(0);
      expect(at(s, 100, 140)).toBe(0); // 40 px below centre, ry is 20 px
    }
  });

  it('has a one-pixel anti-aliased hard edge at the half-width', () => {
    const s = sampler(rect(0.2, 0.1), 0);
    // Half-width 40 px: the edge is at x = 140. Pixel centre 139.5 is half a pixel inside; 140.5 half outside.
    expect(at(s, 139, 100)).toBeCloseTo(1, 6);
    expect(at(s, 140, 100)).toBeCloseTo(0, 6);
    expect(at(s, 120, 100)).toBe(1);
    // Edge exactly through a pixel centre gives 0.5: shift the rectangle by half a pixel (0.0025 units).
    const shifted = sampler(rect(0.2, 0.1, 0, 0.0025), 0);
    expect(at(shifted, 140, 100)).toBeCloseTo(0.5, 6);
  });

  it('rotated 90 degrees equals the rectangle with swapped half-sizes', () => {
    for (const f of [0, 0.5]) {
      const a = sampler(rect(0.2, 0.1, 90), f);
      const b = sampler(rect(0.1, 0.2), f);
      for (let y = 50; y < 150; y += 3) {
        for (let x = 50; x < 150; x += 3) expect(at(a, x, y)).toBeCloseTo(at(b, x, y), 6);
      }
    }
  });

  it('falls off monotonically from the centre with feather 1', () => {
    const s = sampler(rect(0.2, 0.2), 1);
    let prev = 2;
    for (let x = 100; x <= 145; x++) {
      const v = at(s, x, 100);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
    expect(at(s, 141, 100)).toBe(0);
  });

  it('fades more at the corners than at the edge midpoints for the same inset', () => {
    const s = sampler(rect(0.2, 0.2), 0.4); // 40 px half-size, fade over the outer 16 px
    const inset = 8;
    const mid = at(s, 100 + 40 - inset, 100);
    const corner = at(s, 100 + 40 - inset, 100 - 40 + inset);
    expect(mid).toBeGreaterThan(0);
    expect(corner).toBeLessThan(mid);
    // Flat full strength inside the inner box.
    expect(at(s, 100 + 20, 100 - 20)).toBe(1);
  });

  it('row spans never drop pixels that have coverage (rotated, hard and soft)', () => {
    for (const rotation of [0, 2, 45, 135]) {
      for (const f of [0, 0.3]) {
        const s = sampler(rect(0.2, 0.08, rotation, 0.03, -0.02), f);
        const span = new Int32Array(2);
        for (let j = s.y0; j <= s.y1; j++) {
          const has = s.rowSpan!(j, span);
          for (let i = s.x0; i <= s.x1; i++) {
            const v = s.sample(i, j);
            if (v > 0) {
              expect(has, `rot ${rotation} f ${f} row ${j}`).toBe(true);
              expect(i).toBeGreaterThanOrEqual(span[0]!);
              expect(i).toBeLessThanOrEqual(span[1]!);
            }
          }
        }
      }
    }
  }, 20000);

  it('returns null for a degenerate or off-map rectangle', () => {
    expect(createCoverageSampler(rect(0, 0.1), 0.3, frame, MAP, MAP)).toBeNull();
    expect(createCoverageSampler(rect(0.1, 0.1, 0, 5, 5), 0.3, frame, MAP, MAP)).toBeNull();
  });
});

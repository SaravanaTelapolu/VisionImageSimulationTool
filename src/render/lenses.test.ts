import { describe, expect, it } from 'vitest';
import { centredFrame } from '../model/coords';
import { emptyEffects, newRegion } from '../model/defaults';
import { MAX_SIZE_CHANGE, MAX_SIZE_CHANGE_LENSES, type Effects, type Region, type Shape } from '../model/types';
import { collectLenses, lensWeight, warpByLenses } from './lenses';
import type { SizeChangeLens } from './types';

const frame = { width: 800, height: 600, fixation: { x: 300, y: 250 } }; // shorter side 600

function region(shape: Shape, effects: Partial<Effects>, extra: Partial<Region> = {}): Region {
  return { ...newRegion(shape), feather: 0.25, effects: { ...emptyEffects(), ...effects }, ...extra };
}

const ell = (over: object = {}): Shape => ({ type: 'ellipse', cx: 0.1, cy: -0.05, rx: 0.2, ry: 0.1, rotation: 90, ...over }) as Shape;

describe('collectLenses', () => {
  it('converts an ellipse region to pixels, radians and amount', () => {
    const lens = collectLenses([region(ell(), { sizeChange: 0.2 })], frame)[0]!;
    expect(lens.cx).toBeCloseTo(300 + 0.1 * 600);
    expect(lens.cy).toBeCloseTo(250 - 0.05 * 600);
    expect(lens.rx).toBeCloseTo(120);
    expect(lens.ry).toBeCloseTo(60);
    expect(lens.rotation).toBeCloseTo(Math.PI / 2);
    expect(lens.amount).toBeCloseTo(0.2);
    expect(lens.feather).toBeCloseTo(0.25);
  });

  it('keeps negative amounts and clamps to +-MAX_SIZE_CHANGE', () => {
    const lenses = collectLenses(
      [region(ell(), { sizeChange: -0.1 }), region(ell(), { sizeChange: 5 }), region(ell(), { sizeChange: -5 })],
      frame,
    );
    expect(lenses.map((l) => l.amount)).toEqual([-0.1, MAX_SIZE_CHANGE, -MAX_SIZE_CHANGE]);
  });

  it('skips hidden regions, non-ellipses and zero size change', () => {
    const lenses = collectLenses(
      [
        region(ell(), { sizeChange: 0.2 }, { visible: false }),
        region({ type: 'full' }, { sizeChange: 0.2 }),
        region({ type: 'path', points: [[0, 0], [1, 0], [1, 1]] }, { sizeChange: 0.2 }),
        region(ell(), { sizeChange: 0, blur: 10 }),
        region(ell({ rx: 0 }), { sizeChange: 0.2 }),
        region(ell({ cx: 0.3 }), { sizeChange: 0.1 }),
      ],
      frame,
    );
    expect(lenses).toHaveLength(1);
    expect(lenses[0]!.cx).toBeCloseTo(300 + 0.3 * 600);
  });

  it('keeps at most MAX_SIZE_CHANGE_LENSES, the first ones in order', () => {
    const regions = Array.from({ length: MAX_SIZE_CHANGE_LENSES + 3 }, (_, k) =>
      region(ell({ cx: k * 0.01 }), { sizeChange: 0.1 }),
    );
    const lenses = collectLenses(regions, centredFrame(600, 600));
    expect(lenses).toHaveLength(MAX_SIZE_CHANGE_LENSES);
    expect(lenses.map((l) => Math.round(l.cx))).toEqual(
      Array.from({ length: MAX_SIZE_CHANGE_LENSES }, (_, k) => Math.round(300 + k * 0.01 * 600)),
    );
  });

  it('does not count skipped regions towards the limit', () => {
    const regions = [
      ...Array.from({ length: 5 }, () => region(ell(), { sizeChange: 0.1 }, { visible: false })),
      ...Array.from({ length: MAX_SIZE_CHANGE_LENSES }, () => region(ell(), { sizeChange: 0.1 })),
    ];
    expect(collectLenses(regions, frame)).toHaveLength(MAX_SIZE_CHANGE_LENSES);
  });

  it('returns an empty list for no regions', () => {
    expect(collectLenses([], frame)).toEqual([]);
  });
});

describe('warpByLenses (overlap rule, L8)', () => {
  const lens = (over: Partial<SizeChangeLens> = {}): SizeChangeLens => ({
    cx: 500,
    cy: 500,
    rx: 200,
    ry: 200,
    rotation: 0,
    amount: 0.3,
    feather: 0,
    ...over,
  });
  /** Apparent magnification at a point offset `d` px to the right of (500, 500). */
  const magnification = (lenses: SizeChangeLens[], d = 20): number => d / (warpByLenses({ x: 500 + d, y: 500 }, lenses).x - 500);

  it('a single lens magnifies by 1 + amount inside and leaves the outside alone', () => {
    expect(magnification([lens()])).toBeCloseTo(1.3, 6);
    expect(magnification([lens({ amount: -0.2 })])).toBeCloseTo(0.8, 6);
    expect(warpByLenses({ x: 900, y: 500 }, [lens()])).toEqual({ x: 900, y: 500 });
  });

  it('two identical overlapping lenses look like one (no 1.69x compounding)', () => {
    expect(magnification([lens(), lens()])).toBeCloseTo(1.3, 6);
  });

  it('the stronger lens dominates where two lenses overlap, never exceeding the +-30% range', () => {
    const m = magnification([lens({ amount: 0.1 }), lens({ amount: 0.3 })]);
    expect(m).toBeGreaterThan(1.28);
    expect(m).toBeLessThanOrEqual(1.3 + 1e-9);
    const shrink = magnification([lens({ amount: -0.3 }), lens({ amount: -0.3, rx: 300, ry: 300 })]);
    expect(shrink).toBeCloseTo(0.7, 6);
  });

  it('a lens has no influence outside its own ellipse', () => {
    const a = lens();
    const far = lens({ cx: 1500 });
    const p = { x: 560, y: 470 };
    expect(warpByLenses(p, [a, far])).toEqual(warpByLenses(p, [a]));
  });

  it('is continuous across the seam between two offset, overlapping lenses', () => {
    const lenses = [lens({ feather: 0.3 }), lens({ cx: 750, amount: 0.15, feather: 0.3 })];
    let prev = warpByLenses({ x: 250, y: 520 }, lenses);
    let worst = 0;
    for (let x = 251; x <= 1000; x++) {
      const q = warpByLenses({ x, y: 520 }, lenses);
      worst = Math.max(worst, Math.hypot(q.x - prev.x, q.y - prev.y));
      prev = q;
    }
    expect(worst).toBeLessThan(3); // one output pixel step never jumps more than a few source pixels
  });

  it('agrees with lensWeight at the feather edge', () => {
    expect(lensWeight(1, 0.5)).toBe(0);
    expect(lensWeight(0.5, 0.5)).toBe(1);
    expect(lensWeight(0.75, 0.5)).toBeCloseTo(0.5, 6);
    expect(lensWeight(0.2, 0)).toBe(1);
  });
});

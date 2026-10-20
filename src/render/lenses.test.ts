import { describe, expect, it } from 'vitest';
import { centredFrame } from '../model/coords';
import { emptyEffects, newRegion } from '../model/defaults';
import { MAX_SIZE_CHANGE, MAX_SIZE_CHANGE_LENSES, type Effects, type Region, type Shape } from '../model/types';
import { collectLenses } from './lenses';

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

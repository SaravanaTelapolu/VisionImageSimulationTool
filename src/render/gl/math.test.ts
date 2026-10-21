import { describe, expect, it } from 'vitest';
import { defaultGlobals } from '../../model/defaults';
import { MAX_BLUR_PX } from '../../model/types';
import type { RenderParams, SizeChangeLens } from '../types';
import {
  BLUR_LEVELS_REF,
  CONTRAST_MEAN_LEVEL,
  FILL_BASE_LEVEL,
  FILL_TOP_LEVEL,
  MAX_KERNEL_PAIRS,
  channelHasAny,
  directionVector,
  fitToMaxSide,
  gaussianWeights,
  incrementalSigma,
  lensRadius,
  lensSample,
  lensWeight,
  levelFactor,
  levelWeights,
  linearKernel,
  pixelScale,
  planPyramid,
  scaleRenderParams,
} from './math';

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

describe('pixelScale', () => {
  it('is 1 at the reference shorter side and scales with the shorter side', () => {
    expect(pixelScale(1024, 768)).toBe(1);
    expect(pixelScale(768, 1024)).toBe(1);
    expect(pixelScale(4000, 3072)).toBe(4);
    expect(pixelScale(0, 100)).toBe(0);
  });
});

describe('gaussianWeights', () => {
  it('is symmetric-normalised (centre + 2 * sides = 1) and decreasing', () => {
    const g = gaussianWeights(3);
    expect(g.length).toBe(10); // radius ceil(3 * 3) = 9
    expect((g[0] ?? 0) + 2 * sum(g.slice(1))).toBeCloseTo(1, 10);
    for (let i = 1; i < g.length; i++) expect(g[i]).toBeLessThan(g[i - 1] ?? 0);
  });
  it('degenerates to identity for sigma 0', () => {
    expect(gaussianWeights(0)).toEqual([1]);
  });
});

describe('linearKernel', () => {
  it('reproduces the discrete Gaussian exactly once split back by bilinear filtering', () => {
    for (const sigma of [0.8, 2, 5.5, 12]) {
      const k = linearKernel(sigma);
      expect(k.centre + 2 * sum(k.weights)).toBeCloseTo(1, 10);
      const g = gaussianWeights(sigma);
      const effective = g.map(() => 0);
      effective[0] = k.centre;
      k.offsets.forEach((o, i) => {
        const lo = Math.floor(o);
        const frac = o - lo;
        const w = k.weights[i] ?? 0;
        effective[lo] = (effective[lo] ?? 0) + w * (1 - frac);
        if (lo + 1 < effective.length) effective[lo + 1] = (effective[lo + 1] ?? 0) + w * frac;
      });
      g.forEach((w, i) => expect(effective[i]).toBeCloseTo(w, 10));
    }
  });
  it('is identity for tiny sigmas', () => {
    expect(linearKernel(0.1)).toEqual({ centre: 1, offsets: [], weights: [] });
  });
  it('never exceeds the shader tap limit', () => {
    const k = linearKernel(500);
    expect(k.offsets.length).toBeLessThanOrEqual(MAX_KERNEL_PAIRS);
    expect(k.centre + 2 * sum(k.weights)).toBeCloseTo(1, 10);
  });
  it('offsets lie between the merged integer taps', () => {
    const k = linearKernel(4);
    k.offsets.forEach((o, i) => {
      expect(o).toBeGreaterThanOrEqual(2 * i + 1);
      expect(o).toBeLessThanOrEqual(2 * i + 2);
    });
  });
});

describe('incrementalSigma', () => {
  it('adds in quadrature', () => {
    expect(incrementalSigma(3, 5)).toBeCloseTo(4);
    expect(incrementalSigma(0, 2.5)).toBe(2.5);
    expect(incrementalSigma(5, 2)).toBe(0);
  });
});

describe('blur pyramid levels', () => {
  it('run from the source to MAX_BLUR_PX, neighbours at most 2x apart (no 20 -> 100 gap)', () => {
    expect(BLUR_LEVELS_REF[0]).toBe(0);
    expect(BLUR_LEVELS_REF[BLUR_LEVELS_REF.length - 1]).toBe(MAX_BLUR_PX);
    for (let i = 2; i < BLUR_LEVELS_REF.length; i++) {
      expect(BLUR_LEVELS_REF[i]!).toBeGreaterThan(BLUR_LEVELS_REF[i - 1]!);
      expect(BLUR_LEVELS_REF[i]! / BLUR_LEVELS_REF[i - 1]!).toBeLessThanOrEqual(2);
    }
  });
  it('keeps the fill and contrast levels where they were before v0.2', () => {
    expect(BLUR_LEVELS_REF[FILL_TOP_LEVEL]).toBe(40);
    expect(BLUR_LEVELS_REF[FILL_BASE_LEVEL]).toBe(10);
    expect(BLUR_LEVELS_REF[CONTRAST_MEAN_LEVEL]).toBe(20);
  });
});

describe('levelWeights', () => {
  it('hits exact levels with a single weight', () => {
    BLUR_LEVELS_REF.forEach((b, i) => {
      const w = levelWeights(b);
      expect(w[i]).toBeCloseTo(1);
      expect(sum(w)).toBeCloseTo(1);
    });
  });
  it('splits between the two nearest levels', () => {
    const w = levelWeights(7.5); // halfway between 5 and 10
    expect(w).toEqual([0, 0, 0.5, 0.5, 0, 0, 0, 0]);
    const w2 = levelWeights(1);
    expect(w2[0]).toBeCloseTo(0.6);
    expect(w2[1]).toBeCloseTo(0.4);
  });
  it('clamps out-of-range and non-finite values', () => {
    expect(levelWeights(-3)[0]).toBe(1);
    expect(levelWeights(999)[BLUR_LEVELS_REF.length - 1]).toBe(1);
    expect(levelWeights(Number.NaN)[0]).toBe(1);
  });
});

describe('levelFactor / planPyramid', () => {
  it('keeps at least 4 texels of sigma per level', () => {
    expect(levelFactor(2.5, 768)).toBe(1);
    expect(levelFactor(10, 768)).toBe(2);
    expect(levelFactor(40, 768)).toBe(8);
    expect(levelFactor(40, 20)).toBe(2); // short side would drop below 8 texels
  });
  it('plans monotone factors and quadrature increments that add up', () => {
    const plan = planPyramid(1024, 768);
    // 2.5 .. 100 reference px; the 70 and 100 px levels (v0.2) both stop at 1/16: 100 / 32 < 4 texels.
    expect(plan.map((p) => p.factor)).toEqual([1, 1, 1, 2, 4, 8, 16, 16]);
    expect(plan[5]?.width).toBe(128);
    expect(plan[5]?.height).toBe(96);
    expect(plan[7]?.width).toBe(64);
    expect(plan[7]?.height).toBe(48);
    expect(plan[7]?.sigmaPx).toBe(MAX_BLUR_PX);
    let total = 0;
    for (const p of plan) {
      total = Math.sqrt(total * total + p.incrementPx * p.incrementPx);
      expect(total).toBeCloseTo(p.sigmaPx, 8);
    }
  });
  it('scales sigmas with the image so export matches preview', () => {
    const small = planPyramid(1024, 768);
    const big = planPyramid(4096, 3072);
    big.forEach((p, i) => expect(p.sigmaPx).toBeCloseTo((small[i]?.sigmaPx ?? 0) * 4));
    // Same texel sigma at the 40 px and top levels: the big image just uses a bigger factor.
    for (const k of [5, small.length - 1]) {
      const s = small[k];
      const b = big[k];
      expect((b?.sigmaPx ?? 0) / (b?.factor ?? 1)).toBeCloseTo((s?.sigmaPx ?? 0) / (s?.factor ?? 1));
    }
  });
});

describe('lens maths', () => {
  const lens: SizeChangeLens = { cx: 100, cy: 100, rx: 50, ry: 25, rotation: 0, amount: 0.25, feather: 0.4 };

  it('lensWeight is 1 inside, 0 outside and smooth in the feather band', () => {
    expect(lensWeight(0, 0.4)).toBe(1);
    expect(lensWeight(0.6, 0.4)).toBe(1);
    expect(lensWeight(0.8, 0.4)).toBeCloseTo(0.5);
    expect(lensWeight(1, 0.4)).toBe(0);
    expect(lensWeight(2, 0.4)).toBe(0);
    expect(lensWeight(0.99, 0)).toBe(1); // hard edge
  });

  it('lensRadius respects axes and clockwise rotation', () => {
    expect(lensRadius(lens, 150, 100)).toBeCloseTo(1);
    expect(lensRadius(lens, 100, 125)).toBeCloseTo(1);
    const rotated = { ...lens, rotation: Math.PI / 2 }; // long axis now points down (+y)
    expect(lensRadius(rotated, 100, 150)).toBeCloseTo(1);
    expect(lensRadius(rotated, 125, 100)).toBeCloseTo(1);
  });

  it('enlarges by sampling closer to the centre, and is identity outside', () => {
    const inside = lensSample(lens, 110, 100);
    expect(inside.x).toBeCloseTo(100 + 10 / 1.25);
    expect(inside.y).toBeCloseTo(100);
    expect(lensSample(lens, 200, 100)).toEqual({ x: 200, y: 100 });
    const shrink = lensSample({ ...lens, amount: -0.2 }, 110, 100);
    expect(shrink.x).toBeCloseTo(100 + 10 / 0.8);
  });
});

describe('directionVector', () => {
  it('is clockwise on screen with +y down', () => {
    const [x, y] = directionVector(90);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(1);
  });
});

describe('fitToMaxSide', () => {
  it('leaves small images alone', () => {
    expect(fitToMaxSide(800, 600, 4096)).toEqual({ width: 800, height: 600, scale: 1, downscaled: false });
  });
  it('downscales keeping aspect ratio', () => {
    const r = fitToMaxSide(8000, 6000, 4096);
    expect(r).toEqual({ width: 4096, height: 3072, scale: 0.512, downscaled: true });
  });
});

describe('scaleRenderParams', () => {
  it('scales fixation and lenses, leaves maps and globals', () => {
    const maps = { width: 1, height: 1, a: new Uint8Array(4), b: new Uint8Array(4), c: new Uint8Array(4) };
    const globals = defaultGlobals();
    const p: RenderParams = {
      maps,
      globals,
      fixation: { x: 10, y: 20 },
      lenses: [{ cx: 1, cy: 2, rx: 3, ry: 4, rotation: 0.5, amount: 0.1, feather: 0.2 }],
    };
    const s = scaleRenderParams(p, 2);
    expect(s.fixation).toEqual({ x: 20, y: 40 });
    expect(s.lenses[0]).toEqual({ cx: 2, cy: 4, rx: 6, ry: 8, rotation: 0.5, amount: 0.1, feather: 0.2 });
    expect(s.maps).toBe(maps);
    expect(s.globals).toBe(globals);
    expect(p.fixation).toEqual({ x: 10, y: 20 }); // input untouched
  });
});

describe('channelHasAny', () => {
  it('looks at one channel only', () => {
    const d = new Uint8Array([9, 0, 9, 9, 9, 0, 9, 9]);
    expect(channelHasAny(d, 1)).toBe(false);
    d[5] = 1;
    expect(channelHasAny(d, 1)).toBe(true);
  });
});

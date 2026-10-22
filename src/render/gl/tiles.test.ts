import { describe, expect, it } from 'vitest';
import { defaultGlobals } from '../../model/defaults';
import { MAX_BLUR_PX } from '../../model/types';
import type { EffectMaps, RenderParams, SizeChangeLens } from '../types';
import { BLUR_LEVELS_REF, CONTRAST_MEAN_LEVEL, fitToMaxSide, linearKernel, planPyramid } from './math';
import {
  MIN_TILE_CORE,
  canvasSizeAllowed,
  channelMax,
  planTiles,
  pyramidAlign,
  sharedLevelsFrom,
  tileReach,
  topLevelFor,
  type Rect,
  type TilePlan,
} from './tiles';

function maps(channels: { a?: number[]; b?: number[] } = {}): EffectMaps {
  const a = new Uint8Array(16);
  const b = new Uint8Array(16);
  (channels.a ?? []).forEach((v, ch) => (a[4 + ch] = v));
  (channels.b ?? []).forEach((v, ch) => (b[4 + ch] = v));
  return { width: 2, height: 2, a, b, c: new Uint8Array(16) };
}

function params(m: EffectMaps, lenses: SizeChangeLens[] = [], g = defaultGlobals()): RenderParams {
  return { maps: m, globals: g, lenses, fixation: { x: 0, y: 0 } };
}

describe('tile reach (margin maths)', () => {
  const W = 6000;
  const H = 4000; // pixel scale 4000 / 768
  const plan = planPyramid(W, H);
  const scale = H / 768;

  it('picks the pyramid level the shader can read', () => {
    expect(topLevelFor(0)).toBe(0);
    expect(topLevelFor(2)).toBe(1);
    expect(topLevelFor(2.5)).toBe(1);
    expect(topLevelFor(12)).toBe(4);
    expect(topLevelFor(MAX_BLUR_PX)).toBe(BLUR_LEVELS_REF.length - 1);
    expect(channelMax(new Uint8Array([1, 9, 0, 0, 7, 3, 0, 0]), 1)).toBe(9);
  });

  it('needs almost nothing without effects', () => {
    const r = tileReach(params(maps()), W, H, plan);
    expect(r.warpPx).toBe(0);
    expect(r.topLevel).toBe(0);
    expect(r.marginPx).toBeLessThanOrEqual(4);
  });

  it('covers 3 sigma of the widest blur used, plus two texels of that level', () => {
    const r = tileReach(params(maps({ a: [255] })), W, H, plan);
    const top = plan[plan.length - 1]!;
    expect(r.topLevel).toBe(plan.length - 1);
    expect(top.sigmaPx).toBeCloseTo(MAX_BLUR_PX * scale, 6);
    expect(r.blurPx).toBeCloseTo(3 * top.sigmaPx + 2 * top.factor, 6);
    // Contrast loss reads the 20 px level even without blur.
    expect(tileReach(params(maps({ a: [0, 0, 10] })), W, H, plan).topLevel).toBe(CONTRAST_MEAN_LEVEL);
  });

  it('adds lens, distortion and ghost reach', () => {
    const lens: SizeChangeLens = { cx: 100, cy: 100, rx: 400, ry: 200, rotation: 0, amount: -0.3, feather: 0, box: false };
    const withLens = tileReach(params(maps(), [lens]), W, H, plan);
    expect(withLens.warpPx).toBeCloseTo((0.3 / 0.7) * 400, 6);
    const grow = tileReach(params(maps(), [{ ...lens, amount: 0.3 }]), W, H, plan);
    expect(grow.warpPx).toBeCloseTo((0.3 / 0.7) * 400, 6); // bounded by the same |a| / (1 - |a|)
    // A rectangle lens reaches its corners: radius = half-diagonal.
    const box = tileReach(params(maps(), [{ ...lens, box: true }]), W, H, plan);
    expect(box.warpPx).toBeCloseTo((0.3 / 0.7) * Math.hypot(400, 200), 6);

    const g = { ...defaultGlobals(), distortMaxAmplitude: 0.01, ghostOffset: [0.03, 0.04] as [number, number] };
    const dist = tileReach(params(maps({ a: [0, 255] }), [], g), W, H, plan);
    expect(dist.warpPx).toBeCloseTo(1.5 * 0.01 * H, 6);
    const ghost = tileReach(params(maps({ b: [0, 0, 0, 10] }), [], g), W, H, plan);
    expect(ghost.warpPx).toBeCloseTo(0.05 * H, 6);
    expect(ghost.marginPx).toBeGreaterThanOrEqual(Math.ceil(ghost.warpPx + ghost.blurPx));
  });

  it('keeps a rectangle lens whose corner, but not its inscribed circle, reaches the core', () => {
    // Axis-aligned 200 x 200 half-size box at (0, 0): its corner region reaches (180, 180);
    // max(rx, ry) = 200 would miss a core starting at (160, 160) (distance ~226), hypot does not.
    const lens: SizeChangeLens = { cx: 0, cy: 0, rx: 200, ry: 200, rotation: 0, amount: 0.3, feather: 0, box: true };
    const core = { x: 160, y: 160, width: 100, height: 100 };
    expect(tileReach(params(maps(), [lens]), W, H, plan, core).warpPx).toBeCloseTo((0.3 / 0.7) * Math.hypot(200, 200), 6);
    expect(tileReach(params(maps(), [{ ...lens, box: false }]), W, H, plan, core).warpPx).toBe(0);
  });
});

/**
 * True when every pixel of the image belongs to exactly one tile core: cores are non-empty, inside
 * the image, pairwise disjoint, and their areas add up to the image's (no per-pixel loop, so large
 * images stay fast).
 */
function coversOnce(plan: TilePlan, W: number, H: number): boolean {
  const cores = plan.tiles.map((t) => t.core);
  const inside = cores.every((c) => c.width > 0 && c.height > 0 && c.x >= 0 && c.y >= 0 && c.x + c.width <= W && c.y + c.height <= H);
  const disjoint = cores.every((a, i) =>
    cores.slice(i + 1).every((b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y),
  );
  const area = cores.reduce((s, c) => s + c.width * c.height, 0);
  return inside && disjoint && area === W * H;
}

describe('planTiles', () => {
  it.each([
    [6000, 4000, 4096, 700],
    [8191, 3001, 4096, 300],
    [4097, 4097, 4096, 0],
    [12000, 9000, 4096, 1200],
    [5000, 300, 2048, 100],
  ])('%i x %i (tiles %i, margin %i): cores cover the image once; sources are aligned and fit', (W, H, tileMax, margin) => {
    const align = pyramidAlign(W, H);
    const plan = planTiles(W, H, tileMax, margin, align)!;
    expect(plan).not.toBeNull();
    expect(plan.margin % align).toBe(0);
    expect(plan.margin).toBeGreaterThanOrEqual(margin);
    expect(coversOnce(plan, W, H)).toBe(true);
    for (const { core, src } of plan.tiles) {
      expect(src.width).toBeLessThanOrEqual(tileMax);
      expect(src.height).toBeLessThanOrEqual(tileMax);
      for (const v of [src.x, src.y, src.x + src.width, src.y + src.height]) expect(v % align).toBe(0);
      // The source holds the core plus the margin wherever the (padded) image has pixels.
      expect(src.x).toBe(Math.max(0, core.x - plan.margin));
      expect(src.y).toBe(Math.max(0, core.y - plan.margin));
      expect(src.x + src.width).toBeGreaterThanOrEqual(Math.min(plan.paddedWidth, core.x + core.width + plan.margin));
      expect(src.y + src.height).toBeGreaterThanOrEqual(Math.min(plan.paddedHeight, core.y + core.height + plan.margin));
      expect(src.x + src.width).toBeLessThanOrEqual(plan.paddedWidth);
    }
  });

  it('needs no margin along an axis that fits in one tile', () => {
    const plan = planTiles(6000, 3000, 4096, 1000, 32)!;
    expect(plan.tiles.every((t) => t.src.y === 0 && t.src.height === plan.paddedHeight)).toBe(true);
  });

  it('splits only where far-reaching effects need it (margin per core)', () => {
    // A heavy effect near the top-left corner only.
    const heavy = (r: Rect) => (r.x < 1000 && r.y < 1000 ? 1800 : 200);
    const local = planTiles(8000, 6000, 4096, heavy, 64)!;
    const global = planTiles(8000, 6000, 4096, 1800, 64)!;
    expect(coversOnce(local, 8000, 6000)).toBe(true);
    expect(local.tiles.length).toBeLessThan(global.tiles.length / 3);
    for (const t of local.tiles) {
      const m = Math.ceil(heavy(t.core) / 64) * 64;
      expect(t.src.x).toBe(Math.max(0, t.core.x - m));
      expect(t.src.width).toBeLessThanOrEqual(4096);
    }
    expect(local.margin).toBe(1856);
  });

  it('tiles 6000 x 4000 in a few pieces at a typical margin', () => {
    const plan = planTiles(6000, 4000, 4096, 704, 32)!;
    expect(plan.tiles.length).toBe(2); // 4000 rows fit in one 4096 px tile; two 3008 + 704 px sources
    expect(plan.tiles.every((t) => t.src.height === 4000)).toBe(true);
  });

  it('refuses when the margin leaves too small a core', () => {
    expect(planTiles(9000, 9000, 4096, 2000, 32)).toBeNull();
    expect(planTiles(9000, 9000, 4096, (4096 - MIN_TILE_CORE) / 2 - 64, 32)).not.toBeNull();
  });

  it('knows the usual canvas limits', () => {
    expect(canvasSizeAllowed(6000, 4000)).toBe(true);
    expect(canvasSizeAllowed(16384, 16384)).toBe(true);
    expect(canvasSizeAllowed(20000, 100)).toBe(false);
    expect(canvasSizeAllowed(0, 100)).toBe(false);
  });
});

// --- Seam test: the GPU blur pyramid emulated on the CPU, in one dimension (the passes are separable) ---
// Mirrors gl/pipeline.ts + shaders: each level is a Gaussian pass (merged bilinear taps, CLAMP_TO_EDGE,
// output texel i at uv = (i + 0.5) / wOut) from the previous level; the effects pass reads a level
// bilinearly at uv = (x + 0.5) / tileSize.

function sampleLinear(a: Float64Array, x: number): number {
  const n = a.length;
  const c = Math.min(Math.max(x, 0), n - 1);
  const i0 = Math.floor(c);
  const t = c - i0;
  return a[i0]! * (1 - t) + a[Math.min(i0 + 1, n - 1)]! * t;
}

function blurPass(input: Float64Array, wOut: number, sigmaTexels: number): Float64Array {
  const k = linearKernel(sigmaTexels);
  const out = new Float64Array(wOut);
  for (let i = 0; i < wOut; i++) {
    const x = ((i + 0.5) / wOut) * input.length - 0.5;
    let c = k.centre * sampleLinear(input, x);
    k.offsets.forEach((o, j) => (c += (k.weights[j] ?? 0) * (sampleLinear(input, x + o) + sampleLinear(input, x - o))));
    out[i] = c;
  }
  return out;
}

/** The pyramid of a 1-D source that is part of a full W x H image. */
function pyramid1D(src: Float64Array, full: { width: number; height: number }): Float64Array[] {
  const plan = planPyramid(src.length, full.height, BLUR_LEVELS_REF, full);
  const levels = [src];
  for (let k = 1; k < plan.length; k++) {
    levels.push(blurPass(levels[k - 1]!, plan[k]!.width, plan[k]!.incrementPx / plan[k - 1]!.factor));
  }
  return levels;
}

/** Level k read at local pixel x of a source of length n, as the effects shader does. */
function readLevel(levels: Float64Array[], k: number, x: number, n: number): number {
  const lvl = levels[k]!;
  return sampleLinear(lvl, ((x + 0.5) / n) * lvl.length - 0.5);
}

/** A test row: hard steps, a ramp and noise, so any seam shows. */
function testRow(n: number): Float64Array {
  const row = new Float64Array(n);
  let seed = 7;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const step = Math.floor(i / 97) % 2;
    row[i] = Math.min(1, Math.max(0, 0.6 * step + 0.2 * ((i % 1000) / 1000) + 0.2 * (seed / 2147483648)));
  }
  return row;
}

/**
 * Max difference between tiled and untiled reads of level k over every core pixel, when the tiles
 * build their own levels 0..localLevels - 1 (the rest are shared; see sharedError).
 */
function seamError(W: number, H: number, tileMax: number, margin: number, k: number, localLevels?: number): number {
  const align = pyramidAlign(W, H, localLevels);
  const plan = planTiles(W, H, tileMax, margin, align)!;
  expect(plan).not.toBeNull();
  const full = { width: W, height: H };
  // The untiled reference is the image padded (edge repeat) to a multiple of the alignment.
  const row = testRow(W);
  const padded = new Float64Array(plan.paddedWidth);
  for (let i = 0; i < padded.length; i++) padded[i] = row[Math.min(i, W - 1)]!;
  const ref = pyramid1D(padded, full);
  let worst = 0;
  for (const t of plan.tiles.filter((tile) => tile.core.y === 0)) {
    const src = padded.slice(t.src.x, t.src.x + t.src.width);
    const levels = pyramid1D(src, full);
    for (let x = t.core.x; x < t.core.x + t.core.width; x++) {
      const tiled = readLevel(levels, k, x - t.src.x, src.length);
      const untiled = readLevel(ref, k, x, padded.length);
      worst = Math.max(worst, Math.abs(tiled - untiled));
    }
  }
  return worst;
}

/**
 * Per level k >= 1: max difference from an exact Gaussian (of the level's sigma) of
 * - shared: level k of the whole-image copy (W scaled to the copy width by area averaging, like a
 *   high-quality canvas downscale), read at whole-image coordinates as the shader reads shared
 *   levels;
 * - full: level k of the full-size pyramid (what a tile builds itself).
 * Shared levels are the same for every tile (no seams), so their accuracy is all sharing changes.
 */
function levelErrors(W: number, H: number, tileMax: number): { shared: number[]; full: number[] } {
  const copy = fitToMaxSide(W, H, tileMax);
  const row = testRow(W);
  const at = (i: number) => row[Math.min(Math.max(i, 0), W - 1)]!;
  const small = new Float64Array(copy.width);
  const step = W / copy.width;
  for (let i = 0; i < copy.width; i++) {
    const a = i * step;
    const b = a + step;
    let sum = 0;
    for (let j = Math.floor(a); j < Math.ceil(b); j++) sum += at(j) * (Math.min(b, j + 1) - Math.max(a, j));
    small[i] = sum / step;
  }
  const sharedLevels = pyramid1D(small, { width: copy.width, height: copy.height });
  const fullLevels = pyramid1D(row, { width: W, height: H });
  const plan = planPyramid(W, H);
  const shared = [0];
  const full = [0];
  for (let k = 1; k < plan.length; k++) {
    const sigma = plan[k]!.sigmaPx;
    const r = Math.ceil(4 * sigma);
    let es = 0;
    let ef = 0;
    // Away from the image ends, where edge handling differs between resolutions anyway. Wide
    // levels change slowly, so they are checked at a coarser stride (cost ~ W x 80 per level).
    const stride = Math.max(3, Math.round(sigma / 10));
    for (let x = Math.ceil(3 * sigma); x < W - 3 * sigma; x += stride) {
      let g = 0;
      let ws = 0;
      for (let d = -r; d <= r; d++) {
        const w = Math.exp(-(d * d) / (2 * sigma * sigma));
        g += w * at(x + d);
        ws += w;
      }
      g /= ws;
      es = Math.max(es, Math.abs(readLevel(sharedLevels, k, x, W) - g));
      ef = Math.max(ef, Math.abs(readLevel(fullLevels, k, x, W) - g));
    }
    shared.push(es);
    full.push(ef);
  }
  return { shared, full };
}

describe('coversOnce (test helper)', () => {
  it('detects gaps and overlaps', () => {
    const plan = planTiles(6000, 4000, 4096, 700, 32)!;
    expect(coversOnce(plan, 6000, 4000)).toBe(true);
    const [a, b] = plan.tiles;
    const gap = { ...plan, tiles: [a!, { ...b!, core: { ...b!.core, x: b!.core.x + 1, width: b!.core.width - 1 } }] };
    const overlap = { ...plan, tiles: [a!, { ...b!, core: { ...b!.core, x: b!.core.x - 1, width: b!.core.width } }] };
    expect(coversOnce(gap, 6000, 4000)).toBe(false);
    expect(coversOnce(overlap, 6000, 4000)).toBe(false);
  });
});

describe('sharedLevelsFrom / pyramidAlign with a level count', () => {
  it('shares the levels a whole-image copy holds at full detail', () => {
    for (const [W, H, tileMax] of [
      [6000, 4000, 4096],
      [12000, 9000, 4096],
      [5000, 300, 2048],
      [8000, 2000, 4096],
    ] as const) {
      const plan = planPyramid(W, H);
      const s = fitToMaxSide(W, H, tileMax).width / W;
      const from = sharedLevelsFrom(plan, s);
      expect(from).toBeGreaterThanOrEqual(1);
      expect(from).toBeLessThan(plan.length);
      // First level stored at no more than the copy's resolution; the ones before need more.
      expect(plan[from]!.factor * s).toBeGreaterThanOrEqual(1);
      for (let k = 1; k < from; k++) expect(plan[k]!.factor * s).toBeLessThan(1);
    }
    const plan = planPyramid(6000, 4000); // factors 1, 2, 4, 8, 16, 32, 64, 128
    expect(plan.map((p) => p.factor)).toEqual([1, 2, 4, 8, 16, 32, 64, 128]);
    expect(sharedLevelsFrom(plan, 4096 / 6000)).toBe(1);
    expect(sharedLevelsFrom(plan, 1 / 16)).toBe(4);
    expect(sharedLevelsFrom(plan, 1 / 1000)).toBe(plan.length); // nothing can be shared
    expect(sharedLevelsFrom(planPyramid(5000, 300), 2048 / 5000)).toBe(6);
  });

  it('aligns tiles to the largest factor of the per-tile levels only', () => {
    expect(pyramidAlign(6000, 4000)).toBe(128);
    expect(pyramidAlign(6000, 4000, 8)).toBe(128);
    expect(pyramidAlign(6000, 4000, 6)).toBe(32);
    expect(pyramidAlign(6000, 4000, 1)).toBe(1);
    expect(pyramidAlign(5000, 300, 6)).toBe(2);
  });

  it('needs no blur margin for shared levels', () => {
    const W = 6000;
    const H = 4000;
    const plan = planPyramid(W, H);
    const p = params(maps({ a: [255] })); // maximum blur: the widest level
    const all = tileReach(p, W, H, plan);
    const shared = tileReach(p, W, H, plan, undefined, 1);
    expect(shared.topLevel).toBe(all.topLevel);
    expect(shared.blurPx).toBe(2); // level 0 only: two texels of bilinear slack
    expect(shared.marginPx).toBeLessThanOrEqual(4);
    expect(all.marginPx).toBeGreaterThan(1500); // 3 sigma of 100 reference px at 4000 px
    const six = tileReach(p, W, H, plan, undefined, 6);
    expect(six.blurPx).toBeCloseTo(3 * plan[5]!.sigmaPx + 2 * plan[5]!.factor, 6);
  });
});

describe('tiled pyramid matches the untiled one (no seams)', () => {
  const W = 6000;
  const H = 4000;
  const plan = planPyramid(W, H);
  const p = params(maps({ a: [255] })); // maximum blur: the widest level

  it('per-tile levels, with the computed margin, differ by well under one 8-bit step', () => {
    // Tiles building levels 0..5 themselves (the 40 px level is the widest).
    const margin = tileReach(p, W, H, plan, undefined, 6).marginPx;
    for (const k of [1, 3, 5]) expect(seamError(W, H, 4096, margin, k, 6)).toBeLessThan(0.5 / 255);
    // Taller images tile along both axes; a 12000 px row needs several tiles too.
    const big = planPyramid(12000, 9000);
    expect(seamError(12000, 9000, 4096, tileReach(p, 12000, 9000, big, undefined, 6).marginPx, 5, 6)).toBeLessThan(0.5 / 255);
  });

  it('every level, the 100 px one too, when all are built per tile', () => {
    // 8000 x 2000: 3 sigma of 100 reference px is ~800 px, so 4096 px tiles still have a core.
    const wide = planPyramid(8000, 2000);
    const margin = tileReach(p, 8000, 2000, wide).marginPx;
    for (const k of [5, wide.length - 1]) expect(seamError(8000, 2000, 4096, margin, k)).toBeLessThan(0.5 / 255);
  });

  it('shared levels from the whole-image copy are as accurate as full-size ones', () => {
    for (const [w, h, tileMax] of [
      [6000, 4000, 4096],
      [5000, 300, 2048],
      [8000, 2000, 4096],
    ] as const) {
      const from = sharedLevelsFrom(planPyramid(w, h), fitToMaxSide(w, h, tileMax).width / w);
      const e = levelErrors(w, h, tileMax);
      for (let k = from; k < e.full.length; k++) expect(e.shared[k]!).toBeLessThan(e.full[k]! + 0.5 / 255);
      if (w === 5000) {
        // A wide strip: its copy is much smaller than the levels below `from`, which would lose
        // detail there; that is why tiles build them.
        expect(from).toBe(6);
        expect(e.shared[1]!).toBeGreaterThan(e.full[1]! + 5 / 255);
      }
    }
  }, 20_000);

  it('is sensitive: a too-small margin or unaligned tiles show a seam', () => {
    expect(seamError(W, H, 4096, 64, plan.length - 1)).toBeGreaterThan(2 / 255);
  });
});

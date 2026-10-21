import { describe, expect, it } from 'vitest';
import { centredFrame, toPixel } from '../model/coords';
import { emptyEffects, newRegion } from '../model/defaults';
import type { ImageFrame, PathShape } from '../model/types';
import { buildEffectMaps } from './effectMaps';
import { clamp01, createCoverageSampler, smoothstep } from './shapeCoverage';

/** The original O(area x n) per-pixel sampler, kept as the reference definition. */
function legacyCoverage(
  shape: PathShape,
  feather: number,
  frame: ImageFrame,
  mw: number,
  mh: number,
): (i: number, j: number) => number {
  const n = shape.points.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  shape.points.forEach((pt, k) => {
    const p = toPixel(frame, { x: pt[0], y: pt[1] });
    xs[k] = p.x;
    ys[k] = p.y;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  });
  const sx = frame.width / mw;
  const sy = frame.height / mh;
  const featherWidth = clamp01(feather) * 0.5 * Math.min(maxX - minX, maxY - minY);
  const hard = featherWidth < 1e-6;
  const pixel = (sx + sy) / 2;
  return (i, j) => {
    const px = (i + 0.5) * sx;
    const py = (j + 0.5) * sy;
    let inside = false;
    for (let a = 0, q = n - 1; a < n; q = a++) {
      const xi = xs[a]!;
      const yi = ys[a]!;
      const xq = xs[q]!;
      const yq = ys[q]!;
      if (yi > py !== yq > py && px < ((xq - xi) * (py - yi)) / (yq - yi) + xi) inside = !inside;
    }
    if (!inside && !hard) return 0;
    let best = Infinity;
    for (let a = 0, q = n - 1; a < n; q = a++) {
      const xq = xs[q]!;
      const yq = ys[q]!;
      const ex = xs[a]! - xq;
      const ey = ys[a]! - yq;
      const len2 = ex * ex + ey * ey;
      let t = len2 > 0 ? ((px - xq) * ex + (py - yq) * ey) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = xq + t * ex - px;
      const qy = yq + t * ey - py;
      best = Math.min(best, qx * qx + qy * qy);
    }
    const dist = Math.sqrt(best);
    if (hard) return clamp01(0.5 + (inside ? dist : -dist) / pixel);
    return smoothstep(0, featherWidth, dist);
  };
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A freehand-like outline: a wobbly closed loop around a random centre. */
function freehand(rand: () => number, points: number, radius: number, wobble: number): PathShape {
  const cx = (rand() - 0.5) * 0.3;
  const cy = (rand() - 0.5) * 0.3;
  const pts: [number, number][] = [];
  for (let k = 0; k < points; k++) {
    const a = (k / points) * Math.PI * 2;
    const r = radius * (1 + wobble * (rand() - 0.5) * 2);
    pts.push([cx + Math.cos(a) * r * (1 + 0.4 * Math.sin(a * 2)), cy + Math.sin(a) * r]);
  }
  return { type: 'path', points: pts };
}

function diff255(shape: PathShape, feather: number, frame: ImageFrame, mw: number, mh: number) {
  const ref = legacyCoverage(shape, feather, frame, mw, mh);
  const s = createCoverageSampler(shape, feather, frame, mw, mh);
  if (!s) throw new Error('no sampler');
  let max = 0;
  for (let j = s.y0; j <= s.y1; j++) {
    for (let i = s.x0; i <= s.x1; i++) {
      const d = Math.abs(s.sample(i, j) - ref(i, j)) * 255;
      if (d > max) max = d;
    }
  }
  return max;
}

describe('path coverage: scanline + banded distance vs the original sampler', () => {
  it('matches the original on random freehand polygons (hard, narrow and wide feather)', () => {
    const rand = rng(12345);
    let worst = 0;
    for (let trial = 0; trial < 24; trial++) {
      const frame = centredFrame(800 + Math.floor(rand() * 1200), 600 + Math.floor(rand() * 900));
      const mw = 128 + Math.floor(rand() * 385);
      const mh = Math.max(64, Math.round((mw * frame.height) / frame.width));
      const n = 8 + Math.floor(rand() * 200);
      const shape = freehand(rand, n, 0.08 + rand() * 0.3, rand() * 0.25);
      for (const feather of [0, 0.02, 0.15, 0.5, 1]) {
        const max = diff255(shape, feather, frame, mw, mh);
        worst = Math.max(worst, max);
        // Tolerance 2/255: exact except medial-axis ties of the propagated distance (see pathCoverage.ts).
        expect(max).toBeLessThanOrEqual(2);
      }
    }
    console.log(`[accuracy] max difference vs original over random polygons: ${worst.toFixed(3)} / 255`);
  }, 60000);

  it('matches the original on self-intersecting (even-odd) outlines', () => {
    const rand = rng(777);
    const frame = centredFrame(1024, 768);
    for (let trial = 0; trial < 20; trial++) {
      const pts: [number, number][] = [];
      for (let k = 0; k < 12 + trial; k++) pts.push([(rand() - 0.5) * 0.8, (rand() - 0.5) * 0.8]);
      for (const feather of [0, 0.3]) {
        expect(diff255({ type: 'path', points: pts }, feather, frame, 512, 384)).toBeLessThanOrEqual(2);
      }
    }
  }, 60000);

  it('handles polygons clipped by the map, tiny ones, and duplicate points', () => {
    const frame = centredFrame(512, 384);
    const big: PathShape = {
      type: 'path',
      points: [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ],
    };
    const tiny: PathShape = {
      type: 'path',
      points: [
        [0, 0],
        [0.004, 0],
        [0.002, 0.004],
      ],
    };
    const dup: PathShape = {
      type: 'path',
      points: [
        [0, 0],
        [0, 0],
        [0.2, 0],
        [0.2, 0.2],
        [0.2, 0.2],
        [0, 0.2],
      ],
    };
    for (const shape of [big, tiny, dup]) {
      for (const feather of [0, 0.4]) expect(diff255(shape, feather, frame, 512, 384), JSON.stringify([shape.points.length, feather])).toBeLessThanOrEqual(2);
    }
  }, 60000);
});

describe('path coverage: timing', () => {
  it('builds a 200-point freehand outline on a 512x384 map (logs old vs new, non-failing)', () => {
    const rand = rng(99);
    const frame = centredFrame(2048, 1536);
    const shape = freehand(rand, 200, 0.35, 0.05);
    // Best-of-N: stable against scheduler noise when the whole suite runs in parallel.
    const time = (fn: () => void, runs: number) => {
      fn();
      let best = Infinity;
      for (let k = 0; k < runs; k++) {
        const t0 = performance.now();
        fn();
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    };
    const rows: string[] = [];
    for (const feather of [0, 0.3, 1]) {
      const region = { ...newRegion(shape), feather, effects: { ...emptyEffects(), blur: 20, darkSpot: 0.5 } };
      const after = time(() => void buildEffectMaps([region], frame, 512, 384), 20);
      const ell = { ...region, shape: { type: 'ellipse' as const, cx: 0, cy: 0, rx: 0.35, ry: 0.35, rotation: 0 } };
      const ellipseMs = time(() => void buildEffectMaps([ell], frame, 512, 384), 30);
      const ref = legacyCoverage(shape, feather, frame, 512, 384);
      const before = time(() => {
        let acc = 0;
        for (let j = 0; j < 384; j++) for (let i = 0; i < 512; i++) acc += ref(i, j);
        if (acc < 0) throw new Error('unreachable');
      }, 1);
      rows.push(`feather ${feather}: before ${before.toFixed(1)} ms, after ${after.toFixed(2)} ms (same-size ellipse: ${ellipseMs.toFixed(2)} ms)`);
      expect(Number.isFinite(after)).toBe(true);
    }
    console.log(`[timing] 200-point freehand, 512x384 map (before = legacy sampler over the full map):\n  ${rows.join('\n  ')}`);
  }, 60000);
});

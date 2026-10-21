import { describe, expect, it } from 'vitest';
import { centredFrame } from '../model/coords';
import { emptyEffects, newRegion } from '../model/defaults';
import {
  EFFECT_MAP_A,
  EFFECT_MAP_B,
  MAX_BLUR_PX,
  type Effects,
  type EllipseShape,
  type Region,
  type Shape,
} from '../model/types';
import { buildEffectMaps, dilateShade, mapSizeFor } from './effectMaps';
import type { EffectMaps } from './types';

// 400x300 image, fixation at the centre (200, 150), shorter side 300 px. A 400x300 map is 1:1 with the image.
const frame = centredFrame(400, 300);
const W = 400;
const H = 300;

function region(shape: Shape, effects: Partial<Effects>, feather = 0, extra: Partial<Region> = {}): Region {
  const r = newRegion(shape);
  return { ...r, feather, effects: { ...emptyEffects(), ...effects }, ...extra };
}

function ellipse(partial: Partial<EllipseShape> = {}): EllipseShape {
  return { type: 'ellipse', cx: 0, cy: 0, rx: 0.2, ry: 0.1, rotation: 0, ...partial }; // 60 x 30 px
}

/** Reads one channel (0..3 of map A, 4..7 of map B) at map pixel (i, j). */
function at(maps: EffectMaps, i: number, j: number, channel = 0): number {
  const src = channel < 4 ? maps.a : maps.b;
  return src[(j * maps.width + i) * 4 + (channel & 3)] ?? NaN;
}

function same(x: Uint8Array, y: Uint8Array): boolean {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

describe('mapSizeFor', () => {
  it('keeps aspect ratio and caps the longer side', () => {
    expect(mapSizeFor(2000, 1000)).toEqual({ width: 512, height: 256 });
    expect(mapSizeFor(1000, 2000)).toEqual({ width: 256, height: 512 });
    expect(mapSizeFor(4000, 3000, 256)).toEqual({ width: 256, height: 192 });
  });
  it('never exceeds the image', () => {
    expect(mapSizeFor(300, 200)).toEqual({ width: 300, height: 200 });
    expect(mapSizeFor(512, 512)).toEqual({ width: 512, height: 512 });
  });
  it('never returns less than 1 pixel', () => {
    expect(mapSizeFor(10000, 1)).toEqual({ width: 512, height: 1 });
  });
});

describe('buildEffectMaps: ellipse', () => {
  it('allocates two RGBA maps of the requested size', () => {
    const m = buildEffectMaps([], frame, 40, 30);
    expect(m.width).toBe(40);
    expect(m.height).toBe(30);
    expect(m.a.length).toBe(40 * 30 * 4);
    expect(m.b.length).toBe(40 * 30 * 4);
    expect(m.a.every((v) => v === 0)).toBe(true);
  });

  it('is full at the centre, hard at the edge and empty outside (feather 0)', () => {
    const m = buildEffectMaps([region(ellipse(), { dimming: 1 })], frame, W, H);
    expect(at(m, 200, 150, 3)).toBe(255); // centre
    expect(at(m, 255, 150, 3)).toBe(255); // inside, 5 px before the edge at x = 260
    expect(at(m, 262, 150, 3)).toBe(0); // just outside
    expect(at(m, 300, 150, 3)).toBe(0);
    expect(at(m, 200, 150 + 28, 3)).toBe(255); // ry = 30
    expect(at(m, 200, 150 + 33, 3)).toBe(0);
    expect(at(m, 5, 5, 3)).toBe(0);
  });

  it('anti-aliases a hard edge over about one map pixel', () => {
    const m = buildEffectMaps([region(ellipse(), { dimming: 1 })], frame, W, H);
    // Edge on the x axis is at x = 260, so pixel 259 (centre 259.5) is inside and 260 (260.5) outside.
    expect(at(m, 259, 150, 3)).toBeGreaterThanOrEqual(250);
    expect(at(m, 260, 150, 3)).toBeLessThanOrEqual(5);
  });

  it('feather: full inside 1 - f, fading monotonically to 0 at the outline', () => {
    const m = buildEffectMaps([region(ellipse(), { dimming: 1 }, 0.5)], frame, W, H);
    const row: number[] = [];
    for (let i = 200; i < 280; i++) row.push(at(m, i, 150, 3));
    expect(row[0]).toBe(255);
    expect(at(m, 200 + 29, 150, 3)).toBe(255); // d = 0.49 < 0.5
    for (let k = 1; k < row.length; k++) expect(row[k]).toBeLessThanOrEqual(row[k - 1]!);
    expect(at(m, 200 + 45, 150, 3)).toBeGreaterThan(100); // d = 0.75: about half
    expect(at(m, 200 + 45, 150, 3)).toBeLessThan(160);
    expect(at(m, 200 + 59, 150, 3)).toBeLessThan(10); // d close to 1
    expect(at(m, 200 + 61, 150, 3)).toBe(0); // the outline is the outer limit
    // Strictly decreasing somewhere inside the feather band.
    expect(row[35]).toBeGreaterThan(row[50]!);
  });

  it('feather 1 fades from the centre', () => {
    const m = buildEffectMaps([region(ellipse(), { dimming: 1 }, 1)], frame, W, H);
    expect(at(m, 200, 150, 3)).toBe(255);
    expect(at(m, 215, 150, 3)).toBeLessThan(at(m, 205, 150, 3));
    expect(at(m, 261, 150, 3)).toBe(0);
  });

  it('rotation of 90 degrees swaps the axes (clockwise on screen, +y down)', () => {
    const base = buildEffectMaps([region(ellipse(), { dimming: 1 })], frame, W, H);
    const rot = buildEffectMaps([region(ellipse({ rotation: 90 }), { dimming: 1 })], frame, W, H);
    expect(at(base, 250, 150, 3)).toBe(255);
    expect(at(base, 200, 200, 3)).toBe(0);
    expect(at(rot, 250, 150, 3)).toBe(0);
    expect(at(rot, 200, 200, 3)).toBe(255);
    expect(at(rot, 200, 150 + 55, 3)).toBe(255);
    expect(at(rot, 200 + 33, 150, 3)).toBe(0);
  });

  it('rotation of 45 degrees is clockwise on screen', () => {
    const m = buildEffectMaps([region(ellipse({ rotation: 45 }), { dimming: 1 })], frame, W, H);
    // The long axis now points toward bottom-right (+x, +y).
    expect(at(m, 200 + 35, 150 + 35, 3)).toBe(255);
    expect(at(m, 200 + 35, 150 - 35, 3)).toBe(0);
  });

  it('places the ellipse relative to the fixation point and scales to the map size', () => {
    const f = { width: 800, height: 600, fixation: { x: 300, y: 200 } }; // shorter side 600
    // Centre at (300 + 0.1 * 600, 200) = (360, 200) image px = (180, 100) in a 400x300 map; radius 0.1 * 600 = 60 px = 30 map px.
    const m = buildEffectMaps([region(ellipse({ cx: 0.1, cy: 0, rx: 0.1, ry: 0.1 }), { dimming: 1 })], f, 400, 300);
    expect(at(m, 180, 100, 3)).toBe(255);
    expect(at(m, 205, 100, 3)).toBe(255);
    expect(at(m, 215, 100, 3)).toBe(0);
    expect(at(m, 148, 100, 3)).toBe(0); // the left outline is at map x = 150
    expect(at(m, 140, 100, 3)).toBe(0);
    expect(at(m, 0, 0, 3)).toBe(0);
  });

  it('clips ellipses that extend beyond the image', () => {
    const m = buildEffectMaps([region(ellipse({ cx: -0.6, cy: 0, rx: 0.3, ry: 0.3 }), { dimming: 1 })], frame, W, H);
    expect(at(m, 0, 150, 3)).toBe(255);
    const none = buildEffectMaps([region(ellipse({ cx: 5 }), { dimming: 1 })], frame, W, H);
    expect(none.a.every((v) => v === 0)).toBe(true);
  });

  it('ignores degenerate ellipses', () => {
    const m = buildEffectMaps([region(ellipse({ rx: 0 }), { dimming: 1 })], frame, W, H);
    expect(m.a.every((v) => v === 0)).toBe(true);
  });
});

describe('buildEffectMaps: path', () => {
  const square: Shape = {
    type: 'path',
    points: [
      [-0.2, -0.2],
      [0.2, -0.2],
      [0.2, 0.2],
      [-0.2, 0.2],
    ], // 140..260 x 90..210 px... shorter side 300: +-60 px => x 140..260, y 90..210
  };

  it('is full inside and empty outside with a hard edge', () => {
    const m = buildEffectMaps([region(square, { darkSpot: 1 })], frame, W, H);
    expect(at(m, 200, 150, 4)).toBe(255);
    expect(at(m, 145, 95, 4)).toBe(255);
    expect(at(m, 100, 150, 4)).toBe(0);
    expect(at(m, 200, 250, 4)).toBe(0);
    expect(at(m, 270, 150, 4)).toBe(0);
  });

  it('feather width is f x half the smaller bounding-box side', () => {
    // Box is 120 x 120 px, so f = 0.5 gives a 30 px feather band.
    const m = buildEffectMaps([region(square, { darkSpot: 1 }, 0.5)], frame, W, H);
    expect(at(m, 200, 150, 4)).toBe(255); // 60 px from every edge
    expect(at(m, 200 + 29, 150, 4)).toBe(255); // 31 px from the right edge, deeper than 30
    expect(at(m, 259, 150, 4)).toBeLessThan(10); // 1 px inside the edge
    const row: number[] = [];
    for (let i = 200; i < 262; i++) row.push(at(m, i, 150, 4));
    for (let k = 1; k < row.length; k++) expect(row[k]).toBeLessThanOrEqual(row[k - 1]!);
    expect(at(m, 245, 150, 4)).toBeGreaterThan(40); // 15 px from the edge: smoothstep(0.5) = 0.5
    expect(at(m, 245, 150, 4)).toBeLessThan(220);
    expect(at(m, 262, 150, 4)).toBe(0);
  });

  it('handles concave polygons (even-odd)', () => {
    // An L shape: the notch at the top right must be empty.
    const L: Shape = {
      type: 'path',
      points: [
        [-0.2, -0.2],
        [0, -0.2],
        [0, 0],
        [0.2, 0],
        [0.2, 0.2],
        [-0.2, 0.2],
      ],
    };
    const m = buildEffectMaps([region(L, { darkSpot: 1 })], frame, W, H);
    expect(at(m, 170, 120, 4)).toBe(255);
    expect(at(m, 230, 180, 4)).toBe(255);
    expect(at(m, 230, 120, 4)).toBe(0);
  });

  it('ignores paths with fewer than 3 points', () => {
    const m = buildEffectMaps([region({ type: 'path', points: [[0, 0], [0.1, 0.1]] }, { darkSpot: 1 })], frame, W, H);
    expect(m.b.every((v) => v === 0)).toBe(true);
  });
});

describe('buildEffectMaps: full and mask', () => {
  it('full covers every pixel', () => {
    const m = buildEffectMaps([region({ type: 'full' }, { dimming: 1, doubleImage: 0.5 }, 0.7)], frame, 64, 48);
    for (let j = 0; j < 48; j++) {
      for (let i = 0; i < 64; i++) {
        expect(at(m, i, j, 3)).toBe(255);
        expect(at(m, i, j, 7)).toBe(128);
      }
    }
  });

  // Mask 2x1 (black left, white right) over x -0.2..0.2, y -0.1..0.1 => px x 140..260, y 120..180.
  const maskShape: Shape = { type: 'mask', dataUrl: '', x: -0.2, y: -0.1, width: 0.4, height: 0.2 };
  const masks = new Map([['m1', { width: 2, height: 1, data: new Uint8Array([0, 255]) }]]);

  it('samples the greyscale mask bilinearly over its rectangle', () => {
    const r = region(maskShape, { blur: MAX_BLUR_PX }, 0.9, { id: 'm1' });
    const m = buildEffectMaps([r], frame, W, H, masks);
    expect(at(m, 145, 150, 0)).toBe(0); // left texel
    expect(at(m, 255, 150, 0)).toBe(255); // right texel
    const mid = at(m, 200, 150, 0);
    expect(mid).toBeGreaterThan(110);
    expect(mid).toBeLessThan(150);
    expect(at(m, 180, 150, 0)).toBeLessThan(mid);
    expect(at(m, 220, 150, 0)).toBeGreaterThan(mid);
    expect(at(m, 270, 150, 0)).toBe(0); // outside the rectangle
    expect(at(m, 255, 100, 0)).toBe(0);
  });

  it('scales mask samples by strength and ignores feather', () => {
    const a = buildEffectMaps([region(maskShape, { dimming: 0.5 }, 0, { id: 'm1' })], frame, W, H, masks);
    const b = buildEffectMaps([region(maskShape, { dimming: 0.5 }, 1, { id: 'm1' })], frame, W, H, masks);
    expect(at(a, 255, 150, 3)).toBe(128);
    expect(same(a.a, b.a)).toBe(true);
  });

  it('contributes nothing when no mask is supplied for the region', () => {
    const r = region(maskShape, { blur: MAX_BLUR_PX }, 0, { id: 'm1' });
    expect(buildEffectMaps([r], frame, W, H).a.every((v) => v === 0)).toBe(true);
    expect(buildEffectMaps([r], frame, W, H, new Map()).a.every((v) => v === 0)).toBe(true);
    const other = new Map([['other', masks.get('m1')!]]);
    expect(buildEffectMaps([r], frame, W, H, other).a.every((v) => v === 0)).toBe(true);
  });
});

describe('buildEffectMaps: combining and channels', () => {
  it('overlapping regions take the per-channel maximum', () => {
    const r1 = region({ type: 'full' }, { dimming: 0.3, darkSpot: 0.9 });
    const r2 = region(ellipse(), { dimming: 0.6, darkSpot: 0.2 });
    const m = buildEffectMaps([r1, r2], frame, W, H);
    expect(at(m, 200, 150, 3)).toBe(Math.round(0.6 * 255)); // r2 wins
    expect(at(m, 200, 150, 4)).toBe(Math.round(0.9 * 255)); // r1 wins
    expect(at(m, 5, 5, 3)).toBe(Math.round(0.3 * 255)); // only r1 there
    // Order does not matter.
    const m2 = buildEffectMaps([r2, r1], frame, W, H);
    expect(same(m2.a, m.a)).toBe(true);
    expect(same(m2.b, m.b)).toBe(true);
  });

  it('ignores hidden regions', () => {
    const m = buildEffectMaps([region({ type: 'full' }, { dimming: 1 }, 0, { visible: false })], frame, 20, 20);
    expect(m.a.every((v) => v === 0)).toBe(true);
  });

  it('skips regions whose map effects are all zero (sizeChange is not in the maps)', () => {
    const m = buildEffectMaps(
      [region({ type: 'full' }, {}), region(ellipse(), { sizeChange: 0.3 })],
      frame,
      20,
      20,
    );
    expect(m.a.every((v) => v === 0)).toBe(true);
    expect(m.b.every((v) => v === 0)).toBe(true);
  });

  it('writes each effect to its channel following EFFECT_MAP_A / EFFECT_MAP_B', () => {
    const keys = [...EFFECT_MAP_A, ...EFFECT_MAP_B];
    keys.forEach((key, channel) => {
      const value = key === 'blur' ? MAX_BLUR_PX / 2 : 0.5;
      const m = buildEffectMaps([region({ type: 'full' }, { [key]: value })], frame, 4, 4);
      for (let c = 0; c < 8; c++) expect(at(m, 2, 2, c)).toBe(c === channel ? 128 : 0);
    });
    expect(EFFECT_MAP_A).toEqual(['blur', 'distortion', 'contrastLoss', 'dimming']);
    expect(EFFECT_MAP_B).toEqual(['darkSpot', 'fillIn', 'colourFade', 'doubleImage']);
  });

  it('normalises blur by MAX_BLUR_PX and clamps strengths', () => {
    const val = (effects: Partial<Effects>, c = 0) =>
      at(buildEffectMaps([region({ type: 'full' }, effects)], frame, 2, 2), 1, 1, c);
    expect(val({ blur: MAX_BLUR_PX })).toBe(255);
    expect(val({ blur: MAX_BLUR_PX / 4 })).toBe(Math.round(0.25 * 255));
    expect(val({ blur: MAX_BLUR_PX * 3 })).toBe(255);
    expect(val({ blur: -5 })).toBe(0);
    expect(val({ dimming: 7 }, 3)).toBe(255);
    expect(val({ dimming: -1 }, 3)).toBe(0);
    expect(val({ dimming: NaN }, 3)).toBe(0);
  });
});

describe('buildEffectMaps: performance', () => {
  it('rasterises 8 feathered ellipses on a 512x384 map quickly (non-failing timing)', () => {
    const f = centredFrame(2048, 1536);
    const regions = Array.from({ length: 8 }, (_, k) =>
      region(
        ellipse({ cx: -0.3 + k * 0.09, cy: (k % 3) * 0.1 - 0.1, rx: 0.2, ry: 0.12, rotation: k * 20 }),
        { blur: 20, distortion: 0.5, dimming: 0.4, darkSpot: 0.3 },
        0.4,
      ),
    );
    for (let n = 0; n < 5; n++) buildEffectMaps(regions, f, 512, 384); // warm-up (JIT)
    const runs = 20;
    const start = performance.now();
    for (let n = 0; n < runs; n++) buildEffectMaps(regions, f, 512, 384);
    const ms = (performance.now() - start) / runs;
    console.log(`[timing] buildEffectMaps, 8 ellipses on 512x384: ${ms.toFixed(2)} ms (target < 15 ms)`);
    expect(Number.isFinite(ms)).toBe(true);
  });
});

describe('buildEffectMaps: map C (per-region dark-spot shade, D05)', () => {
  const shadeAt = (m: EffectMaps, i: number, j: number) => m.c[(j * m.width + i) * 4] ?? NaN;
  const reserved = (m: EffectMaps) => m.c.every((v, k) => k % 4 === 0 || v === 0);
  // Two overlapping ellipses (radii 60 x 30 px): left one centred at x = 185, right one at x = 215.
  const left = (darkSpot: number, shade: number) =>
    region(ellipse({ cx: -0.05 }), { darkSpot }, 0, { darkSpotShade: shade });
  const right = (darkSpot: number, shade: number) =>
    region(ellipse({ cx: 0.05 }), { darkSpot }, 0, { darkSpotShade: shade });

  it('stores the shade of a single spot where it has a dark spot, zero elsewhere', () => {
    const m = buildEffectMaps([region(ellipse(), { darkSpot: 0.8 }, 0, { darkSpotShade: 0.6 })], frame, W, H);
    expect(m.c.length).toBe(W * H * 4);
    expect(shadeAt(m, 200, 150)).toBe(Math.round(0.6 * 255));
    expect(shadeAt(m, 10, 10)).toBe(0);
    expect(reserved(m)).toBe(true);
  });

  it('takes the shade of the strongest dark spot where spots overlap, whatever the order', () => {
    for (const regions of [
      [left(0.9, 1), right(0.4, 0)],
      [right(0.4, 0), left(0.9, 1)],
    ]) {
      const m = buildEffectMaps(regions, frame, W, H);
      expect(at(m, 200, 150, 4)).toBe(Math.round(0.9 * 255)); // B.r is still the max
      expect(shadeAt(m, 200, 150)).toBe(255); // overlap: the stronger (grey) one wins
      expect(shadeAt(m, 265, 150)).toBe(0); // only the right (black) spot
      expect(shadeAt(m, 135, 150)).toBe(255); // only the left (grey) spot
    }
  });

  it('a weaker spot does not change the shade even when it comes later', () => {
    const m = buildEffectMaps([left(0.3, 0.2), right(0.8, 0.8)], frame, W, H);
    expect(shadeAt(m, 200, 150)).toBe(Math.round(0.8 * 255));
  });

  it('on a tie the darker shade wins, whatever the order', () => {
    for (const regions of [
      [left(0.5, 0.9), right(0.5, 0.3)],
      [right(0.5, 0.3), left(0.5, 0.9)],
    ]) {
      const m = buildEffectMaps(regions, frame, W, H);
      expect(shadeAt(m, 200, 150)).toBe(Math.round(0.3 * 255));
    }
  });

  it('ignores the shade of regions without a dark spot, and hidden regions', () => {
    const blurOnly = region(ellipse(), { blur: 10 }, 0, { darkSpotShade: 1 });
    const hidden = region(ellipse(), { darkSpot: 1 }, 0, { darkSpotShade: 1, visible: false });
    const m = buildEffectMaps([blurOnly, hidden], frame, W, H);
    expect(m.c.every((v) => v === 0)).toBe(true);
  });

  it('dilates the shade one texel past the spot so filtering does not darken a grey edge', () => {
    // Ellipse of radius 60 px at the centre: hard edge near x = 140 on the centre row.
    const m = buildEffectMaps([region(ellipse(), { darkSpot: 1 }, 0, { darkSpotShade: 1 })], frame, W, H);
    let first = -1;
    for (let i = 0; i < W; i++) {
      if (at(m, i, 150, 4) > 0) {
        first = i;
        break;
      }
    }
    expect(first).toBeGreaterThan(100);
    expect(at(m, first - 1, 150, 4)).toBe(0);
    expect(shadeAt(m, first - 1, 150)).toBe(255); // dilated
    expect(shadeAt(m, first - 2, 150)).toBe(0); // only one texel
    expect(reserved(m)).toBe(true);
  });

  it('dilateShade picks the strongest neighbour, darker on ties', () => {
    // 3x1 map: [spot 100 shade 200] [empty] [spot 100 shade 50]
    const b = new Uint8Array([100, 0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0]);
    const c = new Uint8Array([200, 0, 0, 0, 0, 0, 0, 0, 50, 0, 0, 0]);
    dilateShade(b, c, 3, 1);
    expect(c[4]).toBe(50);
    b[0] = 150;
    c[4] = 0;
    dilateShade(b, c, 3, 1);
    expect(c[4]).toBe(200);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { defaultEllipse, newProfile, newRegion } from '../../model/defaults';
import type { ImageFrame, Profile, Region } from '../../model/types';
import type { EffectMaps } from '../../render/types';
import {
  PREVIEW_MAX_SIDE,
  buildMapsForFrame,
  buildRenderParams,
  createMapMemo,
  formatMs,
  previewSizeFor,
  scaleFrame,
  scalePoint,
} from './math';

function spotProfile(sizeChange = 0, blur = 10): Profile {
  const base = defaultEllipse();
  const shape = base.type === 'ellipse' ? { ...base, cx: 0.1, cy: -0.05, rx: 0.1, ry: 0.08 } : base;
  const r = newRegion(shape, 'Spot');
  const region: Region = { ...r, effects: { ...r.effects, blur, sizeChange } };
  return { ...newProfile('Test'), regions: [region] };
}

describe('previewSizeFor', () => {
  it('keeps small images unchanged', () => {
    expect(previewSizeFor(800, 600)).toEqual({ width: 800, height: 600 });
    expect(previewSizeFor(1024, 1024)).toEqual({ width: 1024, height: 1024 });
  });

  it('caps the long side at 1024 and keeps the aspect ratio', () => {
    expect(previewSizeFor(2048, 1536)).toEqual({ width: 1024, height: 768 });
    expect(previewSizeFor(1200, 1600)).toEqual({ width: 768, height: 1024 });
    const s = previewSizeFor(4000, 1000);
    expect(Math.max(s.width, s.height)).toBe(PREVIEW_MAX_SIDE);
    expect(s.height).toBe(256);
  });

  it('never returns less than 1 px and honours a custom cap', () => {
    expect(previewSizeFor(5000, 1, 100)).toEqual({ width: 100, height: 1 });
    expect(previewSizeFor(0, 0)).toEqual({ width: 1, height: 1 });
    expect(previewSizeFor(3000, 2000, Number.POSITIVE_INFINITY)).toEqual({ width: 3000, height: 2000 });
  });
});

describe('scalePoint / scaleFrame', () => {
  it('scales the fixation from working pixels to preview pixels', () => {
    expect(scalePoint({ x: 1000, y: 500 }, { width: 2000, height: 1000 }, { width: 1024, height: 512 })).toEqual({
      x: 512,
      y: 256,
    });
    const f = scaleFrame({ x: 300, y: 600 }, { width: 1200, height: 1600 }, { width: 768, height: 1024 });
    expect(f).toEqual({ width: 768, height: 1024, fixation: { x: 192, y: 384 } });
  });

  it('is the identity when sizes match and safe for a zero size', () => {
    expect(scalePoint({ x: 3, y: 4 }, { width: 10, height: 10 }, { width: 10, height: 10 })).toEqual({ x: 3, y: 4 });
    expect(scalePoint({ x: 3, y: 4 }, { width: 0, height: 0 }, { width: 10, height: 10 })).toEqual({ x: 3, y: 4 });
  });
});

describe('buildRenderParams', () => {
  it('passes globals and fixation and collects lenses in frame pixels', () => {
    const p = spotProfile(0.2);
    const frame: ImageFrame = { width: 1000, height: 500, fixation: { x: 500, y: 250 } };
    const maps = buildMapsForFrame(p.regions, frame, undefined, 256);
    const params = buildRenderParams(p, frame, maps);
    expect(params.maps).toBe(maps);
    expect(params.globals).toBe(p.globals);
    expect(params.fixation).toEqual({ x: 500, y: 250 });
    expect(params.lenses).toHaveLength(1);
    // Shorter side 500: cx = 500 + 0.1 * 500, rx = 0.1 * 500.
    expect(params.lenses[0]!.cx).toBeCloseTo(550);
    expect(params.lenses[0]!.cy).toBeCloseTo(225);
    expect(params.lenses[0]!.rx).toBeCloseTo(50);
    expect(params.lenses[0]!.amount).toBeCloseTo(0.2);
  });

  it('has no lenses without size change, and maps are sized by the cap', () => {
    const p = spotProfile(0);
    const frame: ImageFrame = { width: 1000, height: 500, fixation: { x: 500, y: 250 } };
    const maps = buildMapsForFrame(p.regions, frame, undefined, 256);
    expect(maps.width).toBe(256);
    expect(maps.height).toBe(128);
    expect(buildRenderParams(p, frame, maps).lenses).toEqual([]);
    // The blurred spot lands in channel 0 of map A somewhere.
    expect(maps.a.some((v, i) => i % 4 === 0 && v > 0)).toBe(true);
  });

  it('builds the same maps for a preview frame and a scaled-up frame (resolution independent)', () => {
    const p = spotProfile();
    const work: ImageFrame = { width: 2000, height: 1000, fixation: { x: 900, y: 400 } };
    const prev = scaleFrame(work.fixation, work, previewSizeFor(work.width, work.height));
    const a = buildMapsForFrame(p.regions, work, undefined, 128);
    const b = buildMapsForFrame(p.regions, prev, undefined, 128);
    expect(b.width).toBe(a.width);
    expect(Array.from(b.a)).toEqual(Array.from(a.a));
  });
});

describe('createMapMemo', () => {
  const frame: ImageFrame = { width: 100, height: 100, fixation: { x: 50, y: 50 } };
  const fakeMaps = (): EffectMaps => ({ width: 1, height: 1, a: new Uint8Array(4), b: new Uint8Array(4) });

  it('rebuilds only when regions, masks, fixation or frame size change', () => {
    const build = vi.fn(fakeMaps);
    const memo = createMapMemo(64, build);
    const regions = spotProfile().regions;
    const masks = new Map();
    const first = memo.get({ regions, fixation: { x: 50, y: 50 }, masks, frame });
    expect(first.built).toBe(true);
    // Same references and equal fixation by value: cached.
    const again = memo.get({ regions, fixation: { x: 50, y: 50 }, masks, frame: { ...frame } });
    expect(again.built).toBe(false);
    expect(again.maps).toBe(first.maps);
    expect(build).toHaveBeenCalledTimes(1);

    expect(memo.get({ regions: [...regions], fixation: { x: 50, y: 50 }, masks, frame }).built).toBe(true);
    const r2 = [...regions];
    memo.get({ regions: r2, fixation: { x: 50, y: 50 }, masks, frame });
    expect(memo.get({ regions: r2, fixation: { x: 51, y: 50 }, masks, frame }).built).toBe(true);
    expect(memo.get({ regions: r2, fixation: { x: 51, y: 50 }, masks: new Map(), frame }).built).toBe(true);
    const m = new Map();
    memo.get({ regions: r2, fixation: { x: 51, y: 50 }, masks: m, frame });
    expect(
      memo.get({ regions: r2, fixation: { x: 51, y: 50 }, masks: m, frame: { ...frame, width: 50 } }).built,
    ).toBe(true);
  });

  it('builds new arrays on each rebuild and clear() forces a rebuild', () => {
    const memo = createMapMemo(32);
    const regions = spotProfile().regions;
    const a = memo.get({ regions, fixation: { x: 50, y: 50 }, masks: undefined, frame });
    memo.clear();
    const b = memo.get({ regions, fixation: { x: 50, y: 50 }, masks: undefined, frame });
    expect(b.built).toBe(true);
    expect(b.maps.a).not.toBe(a.maps.a);
    expect(b.maps.b).not.toBe(a.maps.b);
  });
});

describe('formatMs', () => {
  it('formats timings', () => {
    expect(formatMs(null)).toBe('–');
    expect(formatMs(3.14159)).toBe('3.1');
    expect(formatMs(12.6)).toBe('13');
    expect(formatMs(Number.NaN)).toBe('–');
  });
});

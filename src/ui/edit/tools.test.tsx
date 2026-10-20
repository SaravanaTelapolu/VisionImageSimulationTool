// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newProfile } from '../../model/defaults';
import { cancelPlacing, placingShape, redrawingPathId, startRedrawing } from '../../state/edit';
import { maskCacheSize, maskData, resetMaskCache, setMaskCodec } from '../../state/masks';
import { canUndo, profile, resetProfile, selectedRegionId, setWorkingImage, undo, image } from '../../state/store';
import { RegionsPanel } from '../panels/regions/Panel';
import { addBrushRegion } from './brush';
import { commitOutline } from './freehand';

let root: HTMLElement;

function button(text: string): HTMLButtonElement {
  const b = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((x) => x.textContent?.includes(text));
  if (!b) throw new Error(`no button ${text}`);
  return b;
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  setMaskCodec({ decode: () => Promise.resolve(null), encode: (d) => `data:image/png;base64,FAKE${d.width}x${d.height}` });
  resetMaskCache();
  resetProfile(newProfile());
  cancelPlacing();
  image.value = null;
  setWorkingImage({} as CanvasImageSource, 800, 600, 'test');
});

afterEach(() => {
  act(() => {
    render(null, root);
  });
  root.remove();
  setMaskCodec();
  cancelPlacing();
});

describe('freehand outline', () => {
  // A 0.4 x 0.3 box traced with many points, in image pixels of an 800 x 600 image (fixation at the centre).
  const trace = () => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 40; i++) pts.push({ x: 200 + i * 10, y: 150 });
    for (let i = 1; i <= 30; i++) pts.push({ x: 600, y: 150 + i * 10 });
    for (let i = 1; i <= 40; i++) pts.push({ x: 600 - i * 10, y: 450 });
    for (let i = 1; i <= 29; i++) pts.push({ x: 200, y: 450 - i * 10 });
    return pts;
  };

  it('adds a simplified path region (feather 0.3), selects it and leaves drawing mode', () => {
    placingShape.value = 'path';
    const id = commitOutline(trace());
    expect(id).not.toBeNull();
    const r = profile.value.regions[0];
    expect(r?.id).toBe(id);
    expect(r?.feather).toBe(0.3);
    expect(r?.shape.type).toBe('path');
    if (r?.shape.type === 'path') {
      expect(r.shape.points.length).toBeLessThanOrEqual(6);
      expect(r.shape.points.length).toBeGreaterThanOrEqual(4);
      const xs = r.shape.points.map((p) => p[0]);
      expect(Math.min(...xs)).toBeCloseTo(-200 / 600, 2); // relative to fixation, shorter side = 600
    }
    expect(selectedRegionId.value).toBe(id);
    expect(placingShape.value).toBeNull();
    undo();
    expect(profile.value.regions).toHaveLength(0);
  });

  it('ignores a tap or a scribble with no area and stays in drawing mode', () => {
    placingShape.value = 'path';
    expect(commitOutline([{ x: 100, y: 100 }])).toBeNull();
    expect(commitOutline([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 500, y: 100 }])).toBeNull();
    expect(profile.value.regions).toHaveLength(0);
    expect(placingShape.value).toBe('path');
  });

  it('redraw replaces the outline of the existing region in one undo step', () => {
    const id = commitOutline(trace()) as string;
    const before = profile.value.regions[0]?.shape;
    startRedrawing(id);
    expect(redrawingPathId.value).toBe(id);
    const small = [{ x: 300, y: 250 }, { x: 400, y: 250 }, { x: 400, y: 350 }, { x: 300, y: 350 }];
    expect(commitOutline(small)).toBe(id);
    expect(profile.value.regions).toHaveLength(1);
    expect(profile.value.regions[0]?.shape).not.toEqual(before);
    expect(redrawingPathId.value).toBeNull();
    undo();
    expect(profile.value.regions[0]?.shape).toEqual(before);
  });
});

describe('brush mask region', () => {
  it('creates a whole-image mask region at most 512 px on the long side and starts the brush', () => {
    const id = addBrushRegion();
    expect(id).not.toBeNull();
    const r = profile.value.regions[0];
    expect(r?.shape.type).toBe('mask');
    if (r?.shape.type === 'mask') {
      expect(r.shape.dataUrl).toBe('data:image/png;base64,FAKE512x384');
      expect(r.shape.width).toBeCloseTo(800 / 600);
      expect(r.shape.height).toBeCloseTo(1);
      expect(r.shape.x).toBeCloseTo(-400 / 600);
      expect(r.shape.y).toBeCloseTo(-300 / 600);
    }
    expect(selectedRegionId.value).toBe(id);
    expect(placingShape.value).toBe('brush');
    // The blank mask is published straight away, without decoding.
    const m = maskData.value.get(id as string);
    expect(m?.width).toBe(512);
    expect(m?.height).toBe(384);
    expect(maskCacheSize()).toBe(1);
    expect(canUndo.value).toBe(true);
  });

  it('does nothing without a photo or when PNG encoding is unavailable', () => {
    image.value = null;
    expect(addBrushRegion()).toBeNull();
    setWorkingImage({} as CanvasImageSource, 800, 600, 'test');
    setMaskCodec({ decode: () => Promise.resolve(null), encode: () => null });
    expect(addBrushRegion()).toBeNull();
    expect(profile.value.regions).toHaveLength(0);
  });
});

describe('regions panel tools', () => {
  it('Freehand starts drawing mode; Brush adds a mask region and shows the brush toolbar', () => {
    act(() => {
      render(<RegionsPanel />, root);
    });
    expect(button('Freehand').disabled).toBe(false);
    act(() => button('Freehand').click());
    expect(placingShape.value).toBe('path');
    act(() => cancelPlacing());

    act(() => button('Brush').click());
    expect(profile.value.regions[0]?.shape.type).toBe('mask');
    expect(root.querySelector('[aria-label="Brush tools"]')).not.toBeNull();
    expect(button('Done')).toBeTruthy();
    expect(root.textContent).toContain('Brush size');
    expect(root.textContent).toContain('Softness');
    act(() => button('Done').click());
    expect(placingShape.value).toBeNull();
    expect(button('Paint or erase')).toBeTruthy();
  });

  it('shows Redraw outline for a selected freehand region', () => {
    const id = commitOutline([{ x: 300, y: 250 }, { x: 400, y: 250 }, { x: 400, y: 350 }, { x: 300, y: 350 }]) as string;
    act(() => {
      render(<RegionsPanel />, root);
    });
    expect(selectedRegionId.value).toBe(id);
    act(() => button('Redraw outline').click());
    expect(placingShape.value).toBe('path');
    expect(redrawingPathId.value).toBe(id);
  });
});

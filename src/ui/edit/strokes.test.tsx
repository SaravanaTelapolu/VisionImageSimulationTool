// @vitest-environment jsdom
// Drives the overlay with synthetic pointer events: a one-finger freehand trace and a brush stroke.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newProfile } from '../../model/defaults';
import { brushMode, brushSize, brushSoftness, cancelPlacing, placingShape } from '../../state/edit';
import { maskData, resetMaskCache, setMaskCodec } from '../../state/masks';
import { canUndo, image, profile, resetProfile, selectedRegionId, setWorkingImage, undo } from '../../state/store';
import type { ViewportInfo } from '../viewport/context';
import { addBrushRegion } from './brush';
import { RegionOverlay } from './RegionOverlay';

const info: ViewportInfo = {
  image: { width: 800, height: 600 },
  box: { width: 800, height: 600 },
  view: { zoom: 1, tx: 0, ty: 0 },
  scale: 1,
  px: (n) => n,
  clientToImage: (x, y) => ({ x, y }),
};

let host: HTMLElement;
let viewport: HTMLElement;
let urlCounter = 0;

function fire(target: EventTarget, type: string, id: number, x: number, y: number, pointerType = 'touch'): void {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { pointerId: id, pointerType, clientX: x, clientY: y, button: 0 });
  act(() => {
    target.dispatchEvent(e);
  });
}

function startBrush(): string {
  let id: string | null = null;
  act(() => {
    id = addBrushRegion();
  });
  return id as unknown as string;
}

const down = (x: number, y: number, id = 1) => fire(viewport, 'pointerdown', id, x, y);
const move = (x: number, y: number, id = 1) => fire(window, 'pointermove', id, x, y);
const up = (x: number, y: number, id = 1) => {
  fire(window, 'pointerup', id, x, y);
};

beforeEach(() => {
  // jsdom has no canvas; the tint overlay just needs getContext to answer quietly.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  urlCounter = 0;
  setMaskCodec({
    decode: () => Promise.resolve(null),
    encode: (d) => `data:image/png;base64,M${++urlCounter}-${d.width}x${d.height}`,
  });
  resetMaskCache();
  resetProfile(newProfile());
  cancelPlacing();
  image.value = null;
  setWorkingImage({} as CanvasImageSource, 800, 600, 'test');
  brushMode.value = 'paint';
  brushSize.value = 0.1; // 60 image px across
  brushSoftness.value = 0.3;
  host = document.createElement('div');
  host.className = 'viewport';
  viewport = host;
  document.body.appendChild(host);
  act(() => {
    render(
      <svg>
        <RegionOverlay info={info} />
      </svg>,
      host,
    );
  });
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
  setMaskCodec();
  cancelPlacing();
  // Release any pointer the tests left down.
  up(0, 0, 1);
  up(0, 0, 2);
});

describe('freehand drawing with one finger', () => {
  it('traces an outline and adds a path region on release', () => {
    act(() => {
      placingShape.value = 'path';
    });
    down(200, 150);
    for (let x = 200; x <= 600; x += 20) move(x, 150);
    for (let y = 150; y <= 450; y += 20) move(600, y);
    for (let x = 600; x >= 200; x -= 20) move(x, 450);
    for (let y = 450; y >= 150; y -= 20) move(200, y);
    up(200, 150);
    const r = profile.value.regions[0];
    expect(r?.shape.type).toBe('path');
    expect(selectedRegionId.value).toBe(r?.id);
    expect(placingShape.value).toBeNull();
  });

  it('a second finger abandons the trace (pinch)', () => {
    act(() => {
      placingShape.value = 'path';
    });
    down(200, 150, 1);
    move(300, 200, 1);
    move(400, 250, 1);
    down(500, 500, 2);
    move(450, 300, 1);
    up(450, 300, 1);
    up(500, 500, 2);
    expect(profile.value.regions).toHaveLength(0);
  });

  it('a tap does nothing but keeps drawing mode on', () => {
    act(() => {
      placingShape.value = 'path';
    });
    down(300, 300);
    up(300, 300);
    expect(profile.value.regions).toHaveLength(0);
    expect(placingShape.value).toBe('path');
  });
});

describe('brush painting with one finger', () => {
  it('paints live, then commits one undo step per stroke', () => {
    const id = startBrush();
    const blankUrl = (profile.value.regions[0]?.shape as { dataUrl: string }).dataUrl;
    const before = maskData.value.get(id);
    expect(before).toBeDefined();

    down(200, 300);
    move(300, 300);
    move(400, 300);
    up(400, 300);

    const after = maskData.value.get(id);
    expect(after).not.toBe(before);
    // 512 mask px across 800 image px: the stroke at y=300 runs through mask row 192, x from 128 to 256.
    const row = 192 * 512;
    expect(after?.data[row + 150]).toBe(255);
    expect(after?.data[row + 250]).toBe(255);
    expect(after?.data[row + 400]).toBe(0);
    expect(before?.data[row + 150]).toBe(0); // the earlier buffer is untouched

    const url = (profile.value.regions[0]?.shape as { dataUrl: string }).dataUrl;
    expect(url).not.toBe(blankUrl);
    expect(placingShape.value).toBe('brush');

    undo(); // one stroke = one undo step
    expect((profile.value.regions[0]?.shape as { dataUrl: string }).dataUrl).toBe(blankUrl);
    expect(maskData.value.get(id)?.data[row + 150]).toBe(0);
  });

  it('erase removes paint', () => {
    const id = startBrush();
    down(200, 300);
    move(400, 300);
    up(400, 300);
    brushMode.value = 'erase';
    down(300, 300);
    up(300, 300);
    const row = 192 * 512;
    expect(maskData.value.get(id)?.data[row + 192]).toBe(0);
    expect(maskData.value.get(id)?.data[row + 140]).toBe(255);
  });

  it('a second finger reverts the stroke and commits nothing', () => {
    startBrush();
    const undoable = canUndo.value;
    down(200, 300, 1);
    move(300, 300, 1);
    down(600, 100, 2);
    up(300, 300, 1);
    up(600, 100, 2);
    const id = profile.value.regions[0]?.id as string;
    expect(maskData.value.get(id)?.data.every((v) => v === 0)).toBe(true);
    expect(profile.value.regions).toHaveLength(1);
    expect(undoable).toBe(true);
    expect((profile.value.regions[0]?.shape as { dataUrl: string }).dataUrl).toContain('M1-');
  });

  it('does not start a stroke on overlay content such as the banner', () => {
    const id = startBrush();
    const banner = host.querySelector('[role="status"]');
    expect(banner).not.toBeNull();
    fire(banner as Element, 'pointerdown', 1, 100, 20);
    move(200, 20);
    up(200, 20);
    expect(maskData.value.get(id)?.data.every((v) => v === 0)).toBe(true);
  });
});

describe('fixation crosshair while a tool is on', () => {
  // Stand-in for the real crosshair: it swallows presses, as FixationCrosshair does.
  function addCrosshair(): Element {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'fixation');
    g.addEventListener('pointerdown', (e) => e.stopPropagation());
    host.querySelector('svg')?.appendChild(g);
    return g;
  }

  it('a tap on the crosshair places the spot', () => {
    const cross = addCrosshair();
    act(() => {
      placingShape.value = 'ellipse';
    });
    fire(cross, 'pointerdown', 1, 400, 300);
    up(400, 300);
    expect(profile.value.regions[0]?.shape.type).toBe('ellipse');
    expect(placingShape.value).toBeNull();
  });

  it('a drag starting on the crosshair draws the freehand outline', () => {
    const cross = addCrosshair();
    act(() => {
      placingShape.value = 'path';
    });
    fire(cross, 'pointerdown', 1, 400, 300);
    for (let x = 400; x <= 500; x += 10) move(x, 300);
    for (let y = 300; y <= 400; y += 10) move(500, y);
    move(400, 400);
    up(400, 400);
    expect(profile.value.regions[0]?.shape.type).toBe('path');
  });

  it('a press on the crosshair paints with the brush', () => {
    const cross = addCrosshair();
    const id = startBrush();
    fire(cross, 'pointerdown', 1, 400, 300);
    move(450, 300);
    up(450, 300);
    expect(maskData.value.get(id)?.data[192 * 512 + 256]).toBe(255);
  });
});

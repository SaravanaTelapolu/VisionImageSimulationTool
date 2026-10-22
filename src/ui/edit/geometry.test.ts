import { describe, expect, it } from 'vitest';
import { centredFrame, lengthToPixels } from '../../model/coords';
import { newRegion } from '../../model/defaults';
import type { EllipseShape, RectShape, Region } from '../../model/types';
import {
  MIN_RADIUS,
  dragRadius,
  ellipseHandles,
  hitTest,
  hitTestAll,
  moveEllipse,
  normaliseAngle,
  pickTapTarget,
  pointInEllipse,
  pointInPath,
  pointInRect,
  radiusGrabOffset,
  rotationFromPointer,
  snapAngle,
  translateEllipse,
} from './geometry';

// 1000 x 800: shorter side 800, fixation at (500, 400).
const frame = centredFrame(1000, 800);

function ell(over: Partial<EllipseShape> = {}): EllipseShape {
  return { type: 'ellipse', cx: 0, cy: 0, rx: 0.25, ry: 0.125, rotation: 0, ...over };
}

function rect(over: Partial<RectShape> = {}): RectShape {
  return { type: 'rect', cx: 0, cy: 0, rx: 0.25, ry: 0.125, rotation: 0, ...over };
}

function region(shape: Region['shape'], over: Partial<Region> = {}): Region {
  return { ...newRegion(shape), ...over };
}

describe('ellipseHandles', () => {
  it('places handles on the axes of an unrotated ellipse', () => {
    const h = ellipseHandles(ell(), frame, 30);
    expect(h.center).toEqual({ x: 500, y: 400 });
    expect(h.rx.x).toBeCloseTo(700);
    expect(h.rx.y).toBeCloseTo(400);
    expect(h.ry.x).toBeCloseTo(500);
    expect(h.ry.y).toBeCloseTo(500);
    expect(h.rotate.x).toBeCloseTo(500);
    expect(h.rotate.y).toBeCloseTo(400 - 100 - 30);
  });

  it('rotates the handles clockwise on screen', () => {
    const h = ellipseHandles(ell({ rotation: 90 }), frame, 30);
    expect(h.rx.x).toBeCloseTo(500);
    expect(h.rx.y).toBeCloseTo(600); // x axis now points down
    expect(h.ry.x).toBeCloseTo(400); // y axis now points left
    expect(h.ry.y).toBeCloseTo(400);
    expect(h.rotate.x).toBeCloseTo(500 + 130); // "up" of the ellipse now points right
    expect(h.rotate.y).toBeCloseTo(400);
  });

  it('honours the fixation offset', () => {
    const f = { width: 1000, height: 800, fixation: { x: 300, y: 200 } };
    const h = ellipseHandles(ell({ cx: 0.1, cy: -0.1 }), f, 10);
    expect(h.center).toEqual({ x: 380, y: 120 });
  });
});

describe('moveEllipse', () => {
  it('moves the centre', () => {
    const m = moveEllipse(ell(), { x: 900, y: 200 }, frame);
    expect(m.cx).toBeCloseTo(0.5);
    expect(m.cy).toBeCloseTo(-0.25);
    expect(m.rx).toBe(0.25);
  });

  it('keeps the centre inside the image', () => {
    const m = moveEllipse(ell(), { x: -50, y: 5000 }, frame);
    expect(m.cx).toBeCloseTo(-0.625); // x = 0
    expect(m.cy).toBeCloseTo(0.5); // y = 800
  });
});

describe('dragRadius', () => {
  it('sets rx from the pointer distance along the x axis', () => {
    const s = dragRadius(ell(), 'x', { x: 900, y: 123 }, frame);
    expect(s.rx).toBeCloseTo(0.5);
    expect(s.ry).toBe(0.125);
  });

  it('sets ry along the rotated y axis', () => {
    // rotation 90: y axis points left, so a pointer 160 px left of centre gives ry = 0.2.
    const s = dragRadius(ell({ rotation: 90 }), 'y', { x: 340, y: 400 }, frame);
    expect(s.ry).toBeCloseTo(0.2);
  });

  it('applies the grab offset so the handle does not jump', () => {
    const shape = ell();
    const grab = { x: 690, y: 400 }; // 10 px inside the rx handle at 700
    const off = radiusGrabOffset(shape, 'x', grab, frame);
    expect(off).toBeCloseTo(10);
    expect(dragRadius(shape, 'x', grab, frame, off).rx).toBeCloseTo(0.25);
    expect(dragRadius(shape, 'x', { x: 790, y: 400 }, frame, off).rx).toBeCloseTo(0.375);
  });

  it('never goes below the minimum (also when dragged across the centre)', () => {
    expect(dragRadius(ell(), 'x', { x: 500, y: 400 }, frame).rx).toBe(MIN_RADIUS);
    expect(dragRadius(ell(), 'x', { x: 100, y: 400 }, frame).rx).toBe(MIN_RADIUS);
  });
});

describe('rotation', () => {
  it('points the rotation handle at the pointer', () => {
    // Pointer straight up from the centre: rotation 0 (handle's resting position).
    expect(rotationFromPointer(ell(), { x: 500, y: 100 }, frame)).toBeCloseTo(0);
    // Pointer to the right: the top of the ellipse points right, i.e. rotated 90 clockwise.
    expect(rotationFromPointer(ell(), { x: 900, y: 400 }, frame)).toBeCloseTo(90);
    // Pointer down: 180.
    expect(rotationFromPointer(ell(), { x: 500, y: 700 }, frame)).toBeCloseTo(180);
    // Pointer to the left: -90.
    expect(rotationFromPointer(ell(), { x: 100, y: 400 }, frame)).toBeCloseTo(-90);
  });

  it('agrees with the handle position', () => {
    const shape = ell({ rotation: 37 });
    const h = ellipseHandles(shape, frame, 40);
    expect(rotationFromPointer(shape, h.rotate, frame)).toBeCloseTo(37);
  });

  it('snaps to 15 degrees within 3 degrees and not beyond', () => {
    expect(snapAngle(43)).toBe(45);
    expect(snapAngle(47.9)).toBe(45);
    expect(snapAngle(41.9)).toBe(41.9);
    expect(snapAngle(-88)).toBe(-90);
    expect(snapAngle(0.5)).toBe(0);
    const near = { x: 500 + 300 * Math.sin((43 * Math.PI) / 180), y: 400 - 300 * Math.cos((43 * Math.PI) / 180) };
    expect(rotationFromPointer(ell(), near, frame)).toBe(45);
    const far = { x: 500 + 300 * Math.sin((40 * Math.PI) / 180), y: 400 - 300 * Math.cos((40 * Math.PI) / 180) };
    expect(rotationFromPointer(ell(), far, frame)).toBeCloseTo(40);
  });

  it('keeps the angle in (-180, 180]', () => {
    expect(normaliseAngle(190)).toBe(-170);
    expect(normaliseAngle(-190)).toBe(170);
    expect(normaliseAngle(180)).toBe(180);
    expect(normaliseAngle(-180)).toBe(180);
    expect(normaliseAngle(720)).toBe(0);
  });

  it('leaves the rotation alone when the pointer is on the centre', () => {
    expect(rotationFromPointer(ell({ rotation: 20 }), { x: 500, y: 400 }, frame)).toBe(20);
  });
});

describe('translateEllipse', () => {
  it('moves ellipses and ignores other shapes', () => {
    const t = translateEllipse(ell(), 0.1, -0.2);
    expect(t).toMatchObject({ cx: 0.1, cy: -0.2 });
    const full = { type: 'full' as const };
    expect(translateEllipse(full, 1, 1)).toBe(full);
  });
});

describe('pointInEllipse', () => {
  it('tests an unrotated ellipse', () => {
    const e = ell();
    expect(pointInEllipse(e, { x: 500, y: 400 }, frame)).toBe(true);
    expect(pointInEllipse(e, { x: 690, y: 400 }, frame)).toBe(true);
    expect(pointInEllipse(e, { x: 710, y: 400 }, frame)).toBe(false);
    expect(pointInEllipse(e, { x: 500, y: 495 }, frame)).toBe(true);
    expect(pointInEllipse(e, { x: 500, y: 505 }, frame)).toBe(false);
  });

  it('respects rotation', () => {
    const e = ell({ rotation: 90 }); // long axis now vertical
    expect(pointInEllipse(e, { x: 500, y: 590 }, frame)).toBe(true);
    expect(pointInEllipse(e, { x: 590, y: 400 }, frame)).toBe(true); // short radius is 100 px
    expect(pointInEllipse(e, { x: 610, y: 400 }, frame)).toBe(false);
    expect(pointInEllipse(e, { x: 500, y: 610 }, frame)).toBe(false);
  });

  it('enlarges tiny ellipses to the minimum radius', () => {
    const tiny = ell({ rx: 0.005, ry: 0.005 }); // 4 px radius
    expect(lengthToPixels(frame, tiny.rx)).toBe(4);
    expect(pointInEllipse(tiny, { x: 515, y: 400 }, frame)).toBe(false);
    expect(pointInEllipse(tiny, { x: 515, y: 400 }, frame, 22)).toBe(true);
  });
});

describe('pointInPath', () => {
  const square: [number, number][] = [
    [-0.1, -0.1],
    [0.1, -0.1],
    [0.1, 0.1],
    [-0.1, 0.1],
  ];
  it('tests a polygon', () => {
    expect(pointInPath(square, { x: 500, y: 400 }, frame)).toBe(true);
    expect(pointInPath(square, { x: 560, y: 460 }, frame)).toBe(true);
    expect(pointInPath(square, { x: 600, y: 400 }, frame)).toBe(false);
  });
  it('handles concave shapes', () => {
    const c: [number, number][] = [
      [-0.2, -0.2],
      [0.2, -0.2],
      [0.2, 0.2],
      [0, 0],
      [-0.2, 0.2],
    ];
    expect(pointInPath(c, { x: 500, y: 520 }, frame)).toBe(false); // in the notch
    expect(pointInPath(c, { x: 500, y: 300 }, frame)).toBe(true);
  });
  it('needs at least three points', () => {
    expect(pointInPath([[0, 0], [1, 1]], { x: 500, y: 400 }, frame)).toBe(false);
  });
});

describe('hitTest', () => {
  const big = region(ell({ rx: 0.4, ry: 0.4 }), { id: 'big' });
  const small = region(ell({ rx: 0.1, ry: 0.1 }), { id: 'small' });
  const poly = region(
    {
      type: 'path',
      points: [
        [0.3, -0.1],
        [0.5, -0.1],
        [0.5, 0.1],
        [0.3, 0.1],
      ],
    },
    { id: 'poly' },
  );
  const full = region({ type: 'full' }, { id: 'full' });
  const centre = { x: 500, y: 400 };

  it('returns null when nothing is hit', () => {
    expect(hitTest([], centre, frame)).toBeNull();
    expect(hitTest([small], { x: 900, y: 100 }, frame)).toBeNull();
  });

  it('returns the topmost (last) region', () => {
    expect(hitTest([big, small], centre, frame)).toBe('small');
    expect(hitTest([small, big], centre, frame)).toBe('big');
    expect(hitTest([big, small], { x: 500 + 0.3 * 800, y: 400 }, frame)).toBe('big');
  });

  it('skips hidden regions', () => {
    const hidden = { ...small, visible: false };
    expect(hitTest([big, hidden], centre, frame)).toBe('big');
  });

  it('hits paths', () => {
    expect(hitTest([poly], { x: 500 + 0.4 * 800, y: 400 }, frame)).toBe('poly');
    expect(hitTest([poly], centre, frame)).toBeNull();
  });

  it('uses full only as a last resort, whatever its position', () => {
    expect(hitTest([full, small], centre, frame)).toBe('small');
    expect(hitTest([small, full], centre, frame)).toBe('small');
    expect(hitTest([small, full], { x: 50, y: 50 }, frame)).toBe('full');
    expect(hitTest([{ ...full, visible: false }], centre, frame)).toBeNull();
  });

  it('treats a mask like full: a shape drawn on it wins, bare image reaches the mask', () => {
    const mask = region({ type: 'mask', dataUrl: '', x: -0.625, y: -0.5, width: 1.25, height: 1 }, { id: 'mask' });
    expect(hitTest([small, mask], centre, frame)).toBe('small');
    expect(hitTest([mask, small], centre, frame)).toBe('small');
    expect(hitTest([mask], { x: 100, y: 100 }, frame)).toBe('mask');
    expect(hitTest([mask], { x: 5000, y: 5000 }, frame)).toBeNull();
    expect(hitTestAll([mask, full, small], centre, frame).map((h) => h.id)).toEqual(['small', 'full', 'mask']);
  });

  it('lists every hit topmost first, full last', () => {
    const hits = hitTestAll([big, full, small], centre, frame);
    expect(hits.map((h) => h.id)).toEqual(['small', 'big', 'full']);
    expect(hits[2]?.type).toBe('full');
  });

  it('makes tiny ellipses tappable with minRadiusPx', () => {
    const tiny = region(ell({ rx: 0.005, ry: 0.005 }), { id: 'tiny' });
    expect(hitTest([tiny], { x: 515, y: 400 }, frame)).toBeNull();
    expect(hitTest([tiny], { x: 515, y: 400 }, frame, 22)).toBe('tiny');
  });
});

describe('rectangle spots', () => {
  it('puts the width / height handles at the edge midpoints', () => {
    const h = ellipseHandles(rect(), frame, 30);
    expect(h.center).toEqual({ x: 500, y: 400 });
    expect(h.rx.x).toBeCloseTo(700); // half-width 200 px
    expect(h.rx.y).toBeCloseTo(400);
    expect(h.ry.x).toBeCloseTo(500);
    expect(h.ry.y).toBeCloseTo(500); // half-height 100 px
    expect(h.rotate.y).toBeCloseTo(400 - 100 - 30);
    const r = ellipseHandles(rect({ rotation: 90 }), frame, 30);
    expect(r.rx.x).toBeCloseTo(500);
    expect(r.rx.y).toBeCloseTo(600);
  });

  it('resizes about the centre like the oval and keeps the type', () => {
    const w = dragRadius(rect(), 'x', { x: 800, y: 420 }, frame);
    expect(w.type).toBe('rect');
    expect(w).toMatchObject({ cx: 0, cy: 0, rx: 300 / 800, ry: 0.125 });
    const hgt = dragRadius(rect({ rotation: 90 }), 'y', { x: 300, y: 400 }, frame); // y axis points left
    expect(hgt).toMatchObject({ cx: 0, cy: 0, rx: 0.25, ry: 200 / 800 });
    // Same numbers as an ellipse with the same fields.
    expect(dragRadius(ell(), 'x', { x: 800, y: 420 }, frame).rx).toBe(w.rx);
    const start = rect();
    const off = radiusGrabOffset(start, 'x', { x: 690, y: 400 }, frame);
    expect(dragRadius(start, 'x', { x: 690, y: 400 }, frame, off).rx).toBeCloseTo(0.25);
  });

  it('moves, rotates and nudges a rectangle', () => {
    const m = moveEllipse(rect(), { x: 580, y: 320 }, frame);
    expect(m).toMatchObject({ type: 'rect', cx: 0.1, cy: -0.1 });
    expect(rotationFromPointer(rect(), { x: 700, y: 400 }, frame)).toBe(90);
    expect(translateEllipse(rect(), 0.1, -0.2)).toMatchObject({ type: 'rect', cx: 0.1, cy: -0.2 });
  });

  it('tests points in an unrotated rectangle, corners included', () => {
    const r = rect();
    expect(pointInRect(r, { x: 500, y: 400 }, frame)).toBe(true);
    expect(pointInRect(r, { x: 695, y: 495 }, frame)).toBe(true); // near a corner: outside the oval
    expect(pointInEllipse(ell(), { x: 695, y: 495 }, frame)).toBe(false);
    expect(pointInRect(r, { x: 705, y: 400 }, frame)).toBe(false);
    expect(pointInRect(r, { x: 500, y: 505 }, frame)).toBe(false);
  });

  it('respects rotation', () => {
    const r = rect({ rotation: 90 }); // long side now vertical: 200 px wide, 400 px tall
    expect(pointInRect(r, { x: 590, y: 590 }, frame)).toBe(true);
    expect(pointInRect(r, { x: 610, y: 400 }, frame)).toBe(false);
    expect(pointInRect(r, { x: 500, y: 610 }, frame)).toBe(false);
    const d = rect({ rotation: 45, rx: 0.125, ry: 0.125 }); // a 200 px diamond
    expect(pointInRect(d, { x: 500 + 130, y: 400 }, frame)).toBe(true); // half-diagonal is ~141 px
    expect(pointInRect(d, { x: 590, y: 310 }, frame)).toBe(false); // the unrotated square's corner
  });

  it('enlarges tiny rectangles to the minimum half-side', () => {
    const tiny = rect({ rx: 0.005, ry: 0.005 }); // 4 px half-side
    expect(pointInRect(tiny, { x: 515, y: 415 }, frame)).toBe(false);
    expect(pointInRect(tiny, { x: 515, y: 415 }, frame, 22)).toBe(true);
  });

  it('is hit-tested like the other shapes', () => {
    const box = region(rect(), { id: 'box' });
    const full = region({ type: 'full' }, { id: 'full' });
    expect(hitTest([box], { x: 695, y: 495 }, frame)).toBe('box');
    expect(hitTest([box], { x: 900, y: 100 }, frame)).toBeNull();
    expect(hitTestAll([full, box], { x: 600, y: 450 }, frame)).toEqual([
      { id: 'box', type: 'rect' },
      { id: 'full', type: 'full' },
    ]);
    const tiny = region(rect({ rx: 0.005, ry: 0.005 }), { id: 'tiny' });
    expect(hitTest([tiny], { x: 515, y: 400 }, frame, 22)).toBe('tiny');
  });
});

describe('pickTapTarget', () => {
  const a = { id: 'a', type: 'ellipse' as const };
  const b = { id: 'b', type: 'ellipse' as const };
  const full = { id: 'f', type: 'full' as const };

  it('deselects on empty space', () => {
    expect(pickTapTarget([], 'a')).toBeNull();
  });
  it('selects the topmost, then cycles through overlaps', () => {
    expect(pickTapTarget([a, b], null)).toBe('a');
    expect(pickTapTarget([a, b], 'a')).toBe('b');
    expect(pickTapTarget([a, b], 'b')).toBe('a');
    expect(pickTapTarget([a, b], 'zzz')).toBe('a');
  });
  it('keeps a lone selected shape selected', () => {
    expect(pickTapTarget([a], 'a')).toBe('a');
  });
  it('ignores full while a real shape is under the tap', () => {
    expect(pickTapTarget([a, full], 'a')).toBe('a');
    expect(pickTapTarget([a, full], 'f')).toBe('a');
  });
  it('treats a mask like full when picking', () => {
    const mask = { id: 'm', type: 'mask' as const };
    expect(pickTapTarget([a, mask], 'm')).toBe('a');
    expect(pickTapTarget([mask], null)).toBe('m');
    expect(pickTapTarget([mask], 'm')).toBeNull();
  });
  it('selects full on bare image and toggles it off', () => {
    expect(pickTapTarget([full], null)).toBe('f');
    expect(pickTapTarget([full], 'f')).toBeNull();
    expect(pickTapTarget([full], 'a')).toBe('f');
  });
});

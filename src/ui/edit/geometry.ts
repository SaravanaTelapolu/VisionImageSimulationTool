// Pure geometry for on-canvas region editing. Everything here works in image pixels unless a name
// says "units" (fixation-relative, shorter side = 1). No DOM, no signals.

import { fromPixel, lengthToPixels, toPixel } from '../../model/coords';
import type { EllipseShape, ImageFrame, Region, Shape, Vec2 } from '../../model/types';

/** Smallest ellipse radius a drag can produce, in shorter-side units. */
export const MIN_RADIUS = 0.01;
/** Largest ellipse radius a drag can produce, in shorter-side units (keeps handles reachable). */
export const MAX_RADIUS = 2;
/** Rotation snaps to multiples of this many degrees... */
export const ROTATION_SNAP_STEP = 15;
/** ...when the pointer is within this many degrees of one. */
export const ROTATION_SNAP_TOLERANCE = 3;

export type EllipseAxis = 'x' | 'y';

export interface EllipseHandles {
  center: Vec2;
  /** On the ellipse's rotated x axis, at +rx. */
  rx: Vec2;
  /** On the ellipse's rotated y axis, at +ry (screen-down when rotation is 0). */
  ry: Vec2;
  /** Beyond the top (-y) of the ellipse, `rotateOffset` px past the edge. */
  rotate: Vec2;
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Unit vectors of the ellipse's rotated x and y axes (rotation is clockwise on screen, +y down). */
export function ellipseAxes(rotationDeg: number): { u: Vec2; v: Vec2 } {
  const c = Math.cos(rad(rotationDeg));
  const s = Math.sin(rad(rotationDeg));
  return { u: { x: c, y: s }, v: { x: -s, y: c } };
}

/** Handle positions in image pixels. `rotateOffset` is the gap (image px) between the top edge and the rotation handle. */
export function ellipseHandles(shape: EllipseShape, frame: ImageFrame, rotateOffset: number): EllipseHandles {
  const c = toPixel(frame, { x: shape.cx, y: shape.cy });
  const rx = lengthToPixels(frame, shape.rx);
  const ry = lengthToPixels(frame, shape.ry);
  const { u, v } = ellipseAxes(shape.rotation);
  return {
    center: c,
    rx: { x: c.x + u.x * rx, y: c.y + u.y * rx },
    ry: { x: c.x + v.x * ry, y: c.y + v.y * ry },
    rotate: { x: c.x - v.x * (ry + rotateOffset), y: c.y - v.y * (ry + rotateOffset) },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Moves the centre to `centrePx` (image pixels), kept inside the image so the shape cannot be lost. */
export function moveEllipse(shape: EllipseShape, centrePx: Vec2, frame: ImageFrame): EllipseShape {
  const c = { x: clamp(centrePx.x, 0, frame.width), y: clamp(centrePx.y, 0, frame.height) };
  const u = fromPixel(frame, c);
  return { ...shape, cx: u.x, cy: u.y };
}

/**
 * Sets rx or ry from the pointer (image px). The radius is the pointer's distance from the centre
 * along that axis, plus `grabOffset` (image px: handle distance minus pointer distance at grab time)
 * so the handle does not jump under the finger. Clamped to MIN_RADIUS..MAX_RADIUS.
 */
export function dragRadius(
  shape: EllipseShape,
  axis: EllipseAxis,
  pointerPx: Vec2,
  frame: ImageFrame,
  grabOffset = 0,
): EllipseShape {
  const c = toPixel(frame, { x: shape.cx, y: shape.cy });
  const { u, v } = ellipseAxes(shape.rotation);
  const a = axis === 'x' ? u : v;
  const along = (pointerPx.x - c.x) * a.x + (pointerPx.y - c.y) * a.y + grabOffset;
  const s = Math.min(frame.width, frame.height);
  const r = clamp(along / s, MIN_RADIUS, MAX_RADIUS);
  return axis === 'x' ? { ...shape, rx: r } : { ...shape, ry: r };
}

/**
 * Pass as `grabOffset` to dragRadius, computed once when the drag starts: the radius (image px)
 * minus how far along the axis the pointer is.
 */
export function radiusGrabOffset(shape: EllipseShape, axis: EllipseAxis, pointerPx: Vec2, frame: ImageFrame): number {
  const c = toPixel(frame, { x: shape.cx, y: shape.cy });
  const { u, v } = ellipseAxes(shape.rotation);
  const a = axis === 'x' ? u : v;
  const along = (pointerPx.x - c.x) * a.x + (pointerPx.y - c.y) * a.y;
  return lengthToPixels(frame, axis === 'x' ? shape.rx : shape.ry) - along;
}

/** Normalises degrees into (-180, 180]. */
export function normaliseAngle(deg: number): number {
  let a = deg % 360;
  if (a <= -180) a += 360;
  else if (a > 180) a -= 360;
  return a + 0; // + 0 turns -0 into 0
}

/** Snaps to the nearest `step` degrees when within `tolerance` of it. */
export function snapAngle(deg: number, step = ROTATION_SNAP_STEP, tolerance = ROTATION_SNAP_TOLERANCE): number {
  const nearest = Math.round(deg / step) * step;
  return Math.abs(deg - nearest) <= tolerance ? nearest : deg;
}

/** Rotation (degrees, -180..180) that puts the rotation handle under the pointer; snaps to 15 degrees when within 3. */
export function rotationFromPointer(shape: EllipseShape, pointerPx: Vec2, frame: ImageFrame): number {
  const c = toPixel(frame, { x: shape.cx, y: shape.cy });
  const dx = pointerPx.x - c.x;
  const dy = pointerPx.y - c.y;
  if (dx === 0 && dy === 0) return shape.rotation;
  // The handle sits at angle (rotation - 90) from the centre, because "up" is -y.
  const raw = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  return normaliseAngle(snapAngle(normaliseAngle(raw)));
}

/** Translates an ellipse by a delta in shorter-side units. Other shapes are returned unchanged. */
export function translateEllipse(shape: Shape, dx: number, dy: number): Shape {
  if (shape.type !== 'ellipse') return shape;
  return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
}

// --- Hit-testing --------------------------------------------------------------------------

export interface RegionHit {
  id: string;
  type: Shape['type'];
}

/** True when `p` (image px) is inside the ellipse. Radii smaller than `minRadiusPx` count as that big. */
export function pointInEllipse(shape: EllipseShape, p: Vec2, frame: ImageFrame, minRadiusPx = 0): boolean {
  const c = toPixel(frame, { x: shape.cx, y: shape.cy });
  const rx = Math.max(lengthToPixels(frame, shape.rx), minRadiusPx);
  const ry = Math.max(lengthToPixels(frame, shape.ry), minRadiusPx);
  if (rx <= 0 || ry <= 0) return false;
  const { u, v } = ellipseAxes(shape.rotation);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const a = (dx * u.x + dy * u.y) / rx;
  const b = (dx * v.x + dy * v.y) / ry;
  return a * a + b * b <= 1;
}

/** Even-odd ray-casting test; `points` are in shorter-side units. */
export function pointInPath(points: [number, number][], p: Vec2, frame: ImageFrame): boolean {
  if (points.length < 3) return false;
  const px = points.map(([x, y]) => toPixel(frame, { x, y }));
  let inside = false;
  for (let i = 0, j = px.length - 1; i < px.length; j = i++) {
    const a = px[i] as Vec2;
    const b = px[j] as Vec2;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Every visible region under `p` (image px), topmost (last in the list) first. `full` and `mask`
 * regions cover (or can cover) most of the image, so they are listed last, after every shape that
 * really contains the point; a tap on bare image still reaches them.
 * `minRadiusPx` makes tiny ellipses easier to tap.
 */
export function hitTestAll(regions: readonly Region[], p: Vec2, frame: ImageFrame, minRadiusPx = 0): RegionHit[] {
  const hits: RegionHit[] = [];
  const fulls: RegionHit[] = [];
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i] as Region;
    if (!r.visible) continue;
    const s = r.shape;
    let hit = false;
    switch (s.type) {
      case 'ellipse':
        hit = pointInEllipse(s, p, frame, minRadiusPx);
        break;
      case 'path':
        hit = pointInPath(s.points, p, frame);
        break;
      case 'mask': {
        const a = toPixel(frame, { x: s.x, y: s.y });
        const w = lengthToPixels(frame, s.width);
        const h = lengthToPixels(frame, s.height);
        // A mask is a rectangle of paint, often the whole image by default, so it must not win over
        // the shapes drawn on it: treat it like a full region (last resort).
        if (p.x >= a.x && p.x <= a.x + w && p.y >= a.y && p.y <= a.y + h) fulls.push({ id: r.id, type: 'mask' });
        break;
      }
      case 'full':
        fulls.push({ id: r.id, type: 'full' });
        break;
    }
    if (hit) hits.push({ id: r.id, type: s.type });
  }
  return [...hits, ...fulls];
}

/** The topmost visible region at `p`, or null. A full region wins only when nothing else contains the point. */
export function hitTest(regions: readonly Region[], p: Vec2, frame: ImageFrame, minRadiusPx = 0): string | null {
  return hitTestAll(regions, p, frame, minRadiusPx)[0]?.id ?? null;
}

/** Region kinds that sit behind everything else: chosen only when no real shape is under the tap. */
const isBackdrop = (type: RegionHit['type']): boolean => type === 'full' || type === 'mask';

/**
 * What a tap should select. Taps cycle through overlapping shapes (so a region under another can be
 * reached); a full or mask region is chosen only when nothing else is hit, and tapping it again
 * deselects. Returns null to deselect.
 */
export function pickTapTarget(hits: readonly RegionHit[], selectedId: string | null): string | null {
  const shapes = hits.filter((h) => !isBackdrop(h.type));
  if (shapes.length > 0) {
    const i = shapes.findIndex((h) => h.id === selectedId);
    return (shapes[(i + 1) % shapes.length] as RegionHit).id;
  }
  const full = hits[0];
  if (!full) return null;
  return full.id === selectedId ? null : full.id;
}

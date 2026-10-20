// Pure helpers for painted masks and freehand outlines: no DOM, no canvas. The brush tool and the
// mask cache use these; the effect-map builder only needs the decoded greyscale data.
import { lengthToPixels, toPixel } from '../model/coords';
import type { ImageFrame, MaskShape, Vec2 } from '../model/types';

/** Longest side of a freshly created mask, in mask pixels. */
export const MASK_MAX_SIDE = 512;

export type BrushMode = 'paint' | 'erase';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// --- Mask geometry ------------------------------------------------------------------------

/** Mask pixel size for an image of the given aspect: the long side is at most `maxSide`. */
export function maskSizeFor(imageWidth: number, imageHeight: number, maxSide = MASK_MAX_SIDE): { width: number; height: number } {
  const w = Math.max(1, imageWidth);
  const h = Math.max(1, imageHeight);
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** The rectangle (fixation units) that makes a mask cover the whole image. */
export function wholeImageMaskRect(frame: ImageFrame): Pick<MaskShape, 'x' | 'y' | 'width' | 'height'> {
  const s = Math.min(frame.width, frame.height);
  return {
    x: -frame.fixation.x / s,
    y: -frame.fixation.y / s,
    width: frame.width / s,
    height: frame.height / s,
  };
}

/** A mask shape's rectangle in image pixels. */
export function maskRectPx(shape: Pick<MaskShape, 'x' | 'y' | 'width' | 'height'>, frame: ImageFrame): Rect {
  const tl = toPixel(frame, { x: shape.x, y: shape.y });
  return { x: tl.x, y: tl.y, width: lengthToPixels(frame, shape.width), height: lengthToPixels(frame, shape.height) };
}

/** Image pixels -> continuous mask pixels (0..maskWidth, 0..maskHeight; pixel centres at +0.5). */
export function imageToMaskPx(p: Vec2, rect: Rect, maskWidth: number, maskHeight: number): Vec2 {
  return { x: ((p.x - rect.x) / rect.width) * maskWidth, y: ((p.y - rect.y) / rect.height) * maskHeight };
}

/** Mask pixels -> image pixels (inverse of imageToMaskPx). */
export function maskToImagePx(p: Vec2, rect: Rect, maskWidth: number, maskHeight: number): Vec2 {
  return { x: rect.x + (p.x / maskWidth) * rect.width, y: rect.y + (p.y / maskHeight) * rect.height };
}

/** A length in image pixels -> mask pixels (average of the two axes; they match for an undistorted mask). */
export function imageLengthToMaskPx(length: number, rect: Rect, maskWidth: number, maskHeight: number): number {
  return (length * (maskWidth / rect.width + maskHeight / rect.height)) / 2;
}

// --- Brush --------------------------------------------------------------------------------

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * Brush alpha (0..1) at distance `d` from the stamp centre. Full strength inside the core, then a
 * smooth fall-off to zero at `radius`. The fall-off is at least one pixel wide (anti-aliasing),
 * and `softness` (0..1) is the fraction of the radius it occupies.
 */
export function brushAlpha(d: number, radius: number, softness: number): number {
  if (d >= radius) return 0;
  const s = softness < 0 ? 0 : softness > 1 ? 1 : softness;
  const inner = Math.max(0, radius - Math.max(radius * s, 1));
  if (d <= inner) return 1;
  return smoothstep01((radius - d) / (radius - inner));
}

/**
 * Stamps a soft round dab into a greyscale buffer (row-major, `w` x `h`), centred at continuous
 * mask-pixel position (cx, cy). Paint raises pixels towards 255 (never lowers them); erase lowers
 * them towards 0 (never raises them), so overlapping dabs along a stroke do not accumulate.
 */
export function stampSoftCircle(
  buf: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  softness: number,
  mode: BrushMode,
): void {
  if (!(radius > 0) || !Number.isFinite(cx) || !Number.isFinite(cy)) return;
  const x0 = Math.max(0, Math.floor(cx - radius - 0.5));
  const x1 = Math.min(w - 1, Math.ceil(cx + radius - 0.5));
  const y0 = Math.max(0, Math.floor(cy - radius - 0.5));
  const y1 = Math.min(h - 1, Math.ceil(cy + radius - 0.5));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    const row = y * w;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const a = brushAlpha(Math.sqrt(dx * dx + dy * dy), radius, softness);
      if (a <= 0) continue;
      const v = Math.round(a * 255);
      const i = row + x;
      if (mode === 'paint') {
        if (v > (buf[i] as number)) buf[i] = v;
      } else {
        const keep = 255 - v;
        if (keep < (buf[i] as number)) buf[i] = keep;
      }
    }
  }
}

/** Distance between stamps along a stroke: a quarter of the radius (never below half a pixel). */
export function strokeSpacing(radius: number): number {
  return Math.max(0.5, radius / 4);
}

export interface StrokeStamps {
  stamps: Vec2[];
  /** Distance travelled since the last stamp; pass it back in for the next segment. */
  carry: number;
}

/**
 * Stamp positions along the segment from -> to, one every `spacing`, continuing the spacing from
 * the previous segment via `carry`. With `from` null (first point of a stroke) it stamps `to`.
 */
export function strokeStamps(from: Vec2 | null, to: Vec2, spacing: number, carry: number): StrokeStamps {
  if (!from) return { stamps: [{ x: to.x, y: to.y }], carry: 0 };
  const step = spacing > 0 ? spacing : 0.5;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return { stamps: [], carry };
  const stamps: Vec2[] = [];
  let t = step - carry;
  while (t <= len) {
    stamps.push({ x: from.x + (dx * t) / len, y: from.y + (dy * t) / len });
    t += step;
  }
  return { stamps, carry: len - (t - step) };
}

// --- Greyscale <-> RGBA -------------------------------------------------------------------

/** RGBA pixels -> greyscale (Rec. 601 luma, weighted by alpha so transparent counts as black). */
export function rgbaToGreyscale(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const n = width * height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const luma = 0.299 * (rgba[o] as number) + 0.587 * (rgba[o + 1] as number) + 0.114 * (rgba[o + 2] as number);
    out[i] = Math.round((luma * (rgba[o + 3] as number)) / 255);
  }
  return out;
}

/** Greyscale -> opaque RGBA (for encoding to PNG). */
export function greyscaleToRgba(grey: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(grey.length * 4);
  for (let i = 0; i < grey.length; i++) {
    const v = grey[i] as number;
    const o = i * 4;
    out[o] = v;
    out[o + 1] = v;
    out[o + 2] = v;
    out[o + 3] = 255;
  }
  return out;
}

/** Greyscale -> RGBA of a single tint colour whose alpha follows the mask (for the on-screen overlay). */
export function greyscaleToTint(grey: Uint8Array, rgb: readonly [number, number, number], maxAlpha: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(grey.length * 4);
  for (let i = 0; i < grey.length; i++) {
    const o = i * 4;
    out[o] = rgb[0];
    out[o + 1] = rgb[1];
    out[o + 2] = rgb[2];
    out[o + 3] = Math.round((grey[i] as number) * maxAlpha);
  }
  return out;
}

// --- Freehand outline ---------------------------------------------------------------------

type Pt = [number, number];

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ramer-Douglas-Peucker simplification of an open polyline (iterative; keeps first and last point). */
export function simplifyRDP(points: readonly Pt[], tolerance: number): Pt[] {
  const n = points.length;
  if (n <= 2) return points.map(([x, y]) => [x, y] as Pt);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop() as [number, number];
    let worst = -1;
    let worstD = tolerance;
    for (let i = lo + 1; i < hi; i++) {
      const d = distToSegment(points[i] as Pt, points[lo] as Pt, points[hi] as Pt);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([lo, worst], [worst, hi]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push([(points[i] as Pt)[0], (points[i] as Pt)[1]]);
  return out;
}

/** Absolute area of a polygon (shoelace formula). */
export function polygonArea(points: readonly Pt[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i] as Pt;
    const b = points[j] as Pt;
    sum += b[0] * a[1] - a[0] * b[1];
  }
  return Math.abs(sum) / 2;
}

/** Smallest polygon area (shorter-side units squared) accepted as a real outline. */
export const MIN_OUTLINE_AREA = 1e-5;
export const OUTLINE_TOLERANCE = 0.003;

/**
 * Turns a raw finger trace (fixation units) into a closed outline: simplifies it, and drops a final
 * point that sits on the first one. Returns null when fewer than 3 points or no area are left.
 */
export function finishOutline(trace: readonly Pt[], tolerance = OUTLINE_TOLERANCE): Pt[] | null {
  if (trace.length < 3) return null;
  let pts = simplifyRDP(trace, tolerance);
  if (pts.length > 3) {
    const f = pts[0] as Pt;
    const l = pts[pts.length - 1] as Pt;
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) <= tolerance) pts = pts.slice(0, -1);
  }
  if (pts.length < 3 || polygonArea(pts) < MIN_OUTLINE_AREA) return null;
  return pts;
}

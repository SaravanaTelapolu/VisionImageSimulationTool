// Pure maths for tiled full-resolution export (v0.2, Q5). No WebGL here; unit-tested in Node.
//
// A tile renders the core rectangle it owns from a source rectangle = core + margin, so every
// output pixel of the core sees the same source pixels as an untiled render would:
// - margin >= how far any output pixel can sample (size-change lenses + distortion + ghost
//   offset) + the reach of the widest blur level used (3 sigma) + a little bilinear slack;
// - tile source rectangles start (and, inside the image, end) on multiples of the pyramid's
//   largest downscale factor, so the decimated pyramid levels of neighbouring tiles lie on the
//   same texel grid. The image is treated as padded to a multiple of that factor by repeating its
//   last row and column, and every tile sees the same padding, so edges match too.
// - Missing-area fill is built once from the whole (downscaled) image and shared by all tiles.
import { MAX_BLUR_PX, MAX_SIZE_CHANGE } from '../../model/types';
import type { RenderParams } from '../types';
import { BLUR_LEVELS_REF, CONTRAST_MEAN_LEVEL, channelHasAny, planPyramid, type PyramidLevelPlan } from './math';

/** Largest canvas side a 2D canvas can usually hold (Chrome, Android). */
export const MAX_CANVAS_SIDE = 16384;
/** Largest canvas area (pixels) tried for a full-resolution export (Chrome's limit is 2^28). */
export const MAX_CANVAS_AREA = 16384 * 16384;
/** A tile's core must be at least this many pixels wide, or tiling is not worth it. */
export const MIN_TILE_CORE = 256;
/** Long side of the whole-image copy the shared missing-area fill is built from. */
export const FILL_SOURCE_MAX_SIDE = 1536;

/** Highest per-channel byte in an RGBA8 map (0 when the channel is empty). */
export function channelMax(data: Uint8Array, channel: number): number {
  let m = 0;
  for (let i = channel; i < data.length; i += 4) if (data[i]! > m) m = data[i]!;
  return m;
}

/** Map texel box (inclusive) that linear filtering reads for output pixels in `rect`. */
export function mapTexelBox(
  rect: Rect,
  fullWidth: number,
  fullHeight: number,
  mapWidth: number,
  mapHeight: number,
): { i0: number; j0: number; i1: number; j1: number } {
  const sx = mapWidth / fullWidth;
  const sy = mapHeight / fullHeight;
  return {
    i0: Math.max(0, Math.floor(rect.x * sx - 0.5) - 1),
    j0: Math.max(0, Math.floor(rect.y * sy - 0.5) - 1),
    i1: Math.min(mapWidth - 1, Math.floor((rect.x + rect.width) * sx - 0.5) + 2),
    j1: Math.min(mapHeight - 1, Math.floor((rect.y + rect.height) * sy - 0.5) + 2),
  };
}

/** Per-channel maxima of an RGBA8 map over a texel box. */
function boxMax(data: Uint8Array, mapWidth: number, box: { i0: number; j0: number; i1: number; j1: number }): number[] {
  const m = [0, 0, 0, 0];
  for (let j = box.j0; j <= box.j1; j++) {
    for (let i = box.i0, o = (j * mapWidth + box.i0) * 4; i <= box.i1; i++, o += 4) {
      for (let k = 0; k < 4; k++) if (data[o + k]! > m[k]!) m[k] = data[o + k]!;
    }
  }
  return m;
}

/** Index of the smallest pyramid level whose sigma is >= blurRef (the highest level the shader mixes). */
export function topLevelFor(blurRef: number, levels: readonly number[] = BLUR_LEVELS_REF): number {
  if (!(blurRef > 0)) return 0;
  for (let i = 0; i < levels.length; i++) if ((levels[i] ?? 0) >= blurRef) return i;
  return levels.length - 1;
}

export interface TileReach {
  /** How far (px) a sample can move from its output pixel: lenses + distortion + ghost. */
  warpPx: number;
  /** Highest pyramid level any pixel reads. */
  topLevel: number;
  /** Reach (px) of that level: 3 sigma plus two texels of its grid. */
  blurPx: number;
  /** Margin in px (not yet aligned). */
  marginPx: number;
}

/**
 * How far around a tile's core the source must reach so the core renders exactly as untiled.
 * `params` are in full-image pixels; `plan` is the full image's pyramid plan. Everything that
 * decides how far a pixel samples (blur level, distortion and ghost strength, the lenses that
 * cover it) is read at that pixel, so with `rect` (the core) only the map texels and lenses over
 * the core count; without it, the whole image.
 */
export function tileReach(
  params: RenderParams,
  fullWidth: number,
  fullHeight: number,
  plan: PyramidLevelPlan[],
  rect?: Rect,
): TileReach {
  const short = Math.min(fullWidth, fullHeight);
  const maps = params.maps;
  const g = params.globals;
  let ma: number[];
  let mb: number[];
  if (rect) {
    const box = mapTexelBox(rect, fullWidth, fullHeight, maps.width, maps.height);
    ma = boxMax(maps.a, maps.width, box);
    mb = boxMax(maps.b, maps.width, box);
  } else {
    ma = [0, 1, 2, 3].map((k) => channelMax(maps.a, k));
    mb = [0, 1, 2, 3].map((k) => channelMax(maps.b, k));
  }

  // Lenses: centre + d / (1 + amount * w) moves a point by at most |amount| / (1 - |amount|) of
  // its distance from the centre (shrinking), and points move only inside the ellipse.
  let lensPx = 0;
  for (const l of params.lenses) {
    const amt = Math.min(Math.abs(Number.isFinite(l.amount) ? l.amount : 0), MAX_SIZE_CHANGE);
    if (amt === 0) continue;
    const r = Math.max(Math.abs(l.rx), Math.abs(l.ry));
    if (!Number.isFinite(r)) continue;
    if (rect) {
      // Skip lenses whose bounding circle misses the core.
      const nx = Math.min(Math.max(l.cx, rect.x), rect.x + rect.width);
      const ny = Math.min(Math.max(l.cy, rect.y), rect.y + rect.height);
      if (Math.hypot(l.cx - nx, l.cy - ny) > r + 1) continue;
    }
    lensPx = Math.max(lensPx, (amt / (1 - amt)) * r);
  }
  // Distortion: |displacement| <= (1 + 0.25 + 0.25 * sqrt 2) / 1.15 < 1.5 times strength * amplitude.
  const dist = ma[1]! / 255;
  const amp = Math.max(0, Number.isFinite(g.distortMaxAmplitude) ? g.distortMaxAmplitude : 0) * short;
  const distPx = dist > 0 ? 1.5 * dist * amp : 0;
  // Double image: the ghost is sampled at -ghostOffset from the warped point.
  const ghostPx = mb[3]! > 0 ? Math.hypot(g.ghostOffset[0] || 0, g.ghostOffset[1] || 0) * short : 0;
  const warpPx = lensPx + distPx + ghostPx;

  // Blur: the shader mixes the two levels around the blur value; contrast loss reads its mean level.
  const blurRef = (ma[0]! / 255) * MAX_BLUR_PX;
  let topLevel = topLevelFor(blurRef);
  if (ma[2]! > 0) topLevel = Math.max(topLevel, CONTRAST_MEAN_LEVEL);
  topLevel = Math.min(topLevel, plan.length - 1);
  const lvl = plan[topLevel];
  const blurPx = lvl ? 3 * lvl.sigmaPx + 2 * lvl.factor : 0;
  return { warpPx, topLevel, blurPx, marginPx: Math.ceil(warpPx + blurPx + 2) };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Tile {
  /** Output pixels this tile owns (inside the image). */
  core: Rect;
  /** Source pixels it renders from (inside the padded image; may run past the image by < align). */
  src: Rect;
}

export interface TilePlan {
  /** Image size padded up to a multiple of `align`. */
  paddedWidth: number;
  paddedHeight: number;
  /** Largest margin any tile uses (a multiple of `align`). */
  margin: number;
  align: number;
  tiles: Tile[];
}

const ceilTo = (v: number, step: number): number => Math.ceil(v / step) * step;

/** Margin for a core rectangle: a fixed number, or computed per core (see tileReach). */
export type MarginFor = number | ((core: Rect) => number);

/**
 * Plans tiles for a width x height image: every pixel belongs to exactly one tile core, and each
 * tile's source (core + its margin, clipped to the padded image) is at most `tileMax` on a side.
 * Starts from the whole image and halves (on `align` boundaries) any core whose source would be
 * too big, so areas with far-reaching effects get small tiles and quiet areas big ones; where
 * halving cannot work, it splits into as many equal parts as the core's margin needs.
 * Returns null when a core would have to shrink below MIN_TILE_CORE.
 */
export function planTiles(width: number, height: number, tileMax: number, margin: MarginFor, align: number): TilePlan | null {
  const W = Math.max(1, Math.floor(width));
  const H = Math.max(1, Math.floor(height));
  const A = Math.max(1, Math.floor(align));
  const paddedWidth = ceilTo(W, A);
  const paddedHeight = ceilTo(H, A);
  const marginOf = (core: Rect): number => ceilTo(Math.max(0, typeof margin === 'number' ? margin : margin(core)), A);
  const minCore = Math.max(MIN_TILE_CORE, A);

  // Cores are in image pixels; a core that ends at the image edge runs to the padded edge in its
  // source. Returns the tiles for a core, or null when it cannot be tiled.
  const visit = (x0: number, y0: number, x1: number, y1: number): Tile[] | null => {
    const core = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    const m = marginOf(core);
    const sx0 = Math.max(0, x0 - m);
    const sy0 = Math.max(0, y0 - m);
    const sx1 = Math.min(paddedWidth, (x1 >= W ? paddedWidth : x1) + m);
    const sy1 = Math.min(paddedHeight, (y1 >= H ? paddedHeight : y1) + m);
    const overX = sx1 - sx0 > tileMax;
    const overY = sy1 - sy0 > tileMax;
    if (!overX && !overY) return [{ core, src: { x: sx0, y: sy0, width: sx1 - sx0, height: sy1 - sy0 } }];
    const splitX = overX && (!overY || core.width >= core.height);
    const start = splitX ? x0 : y0;
    const size = splitX ? core.width : core.height;
    const part = (a: number, b: number) => (splitX ? visit(a, y0, b, y1) : visit(x0, a, x1, b));
    // 1. Halve: the halves get their own (often smaller) margins, so quiet areas keep big tiles.
    if (size >= 2 * minCore) {
      const mid = start + ceilTo(size / 2, A);
      const first = part(start, mid);
      const second = first && part(mid, start + size);
      if (first && second) return [...first, ...second];
    }
    // 2. Else split into as many equal parts as this core's own margin needs (always enough,
    //    because a part's margin is never larger than its parent's).
    const maxCore = Math.floor((tileMax - 2 * m) / A) * A;
    if (maxCore < minCore) return null;
    const k = Math.ceil(size / maxCore);
    if (k < 2) return null;
    const step = ceilTo(Math.ceil(size / k), A);
    const out: Tile[] = [];
    for (let a = start; a < start + size; a += step) {
      const tiles = part(a, Math.min(start + size, a + step));
      if (!tiles) return null;
      out.push(...tiles);
    }
    return out;
  };
  const tiles = visit(0, 0, W, H);
  if (!tiles) return null;
  const maxMargin = tiles.reduce((mx, t) => Math.max(mx, marginOf(t.core)), 0);
  return { paddedWidth, paddedHeight, margin: maxMargin, align: A, tiles };
}

/** The pyramid alignment for an image: its largest level downscale factor. */
export function pyramidAlign(width: number, height: number): number {
  const plan = planPyramid(width, height);
  return plan.reduce((m, p) => Math.max(m, p.factor), 1);
}

/** True when a 2D canvas of this size is within the usual browser limits (it may still fail). */
export function canvasSizeAllowed(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= MAX_CANVAS_SIDE && height <= MAX_CANVAS_SIDE && width * height <= MAX_CANVAS_AREA;
}

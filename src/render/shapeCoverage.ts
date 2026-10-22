// Per-shape coverage samplers for the effect-map builder. Pure maths: no DOM or canvas.
import { lengthToPixels, toPixel } from '../model/coords';
import type { ImageFrame, Shape } from '../model/types';
import { buildPathCoverage } from './pathCoverage';

/** A greyscale mask (0..255, row-major, top row first), as decoded from a painted-mask PNG. */
export interface MaskData {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Inclusive map-pixel rectangle plus a function giving the 0..1 coverage of map pixel (i, j). */
export interface CoverageSampler {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  sample(i: number, j: number): number;
  /**
   * Optional: narrows row j to the map columns that can have non-zero coverage. Writes the inclusive
   * range into out[0], out[1] (within x0..x1) and returns false when the row is empty.
   */
  rowSpan?(j: number, out: Int32Array): boolean;
}

export function clamp01(v: number): number {
  return v > 0 ? (v < 1 ? v : 1) : 0; // NaN -> 0
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

interface MapGeometry {
  /** Image pixels per map pixel, horizontally and vertically. */
  sx: number;
  sy: number;
  mapWidth: number;
  mapHeight: number;
}

/** Clamps an image-pixel bounding box to inclusive map-pixel bounds (with a 1 px margin for anti-aliasing). */
function mapBounds(g: MapGeometry, minX: number, minY: number, maxX: number, maxY: number) {
  const x0 = Math.max(0, Math.floor(minX / g.sx - 0.5) - 1);
  const y0 = Math.max(0, Math.floor(minY / g.sy - 0.5) - 1);
  const x1 = Math.min(g.mapWidth - 1, Math.ceil(maxX / g.sx - 0.5) + 1);
  const y1 = Math.min(g.mapHeight - 1, Math.ceil(maxY / g.sy - 0.5) + 1);
  return { x0, y0, x1, y1 };
}

function ellipseSampler(
  shape: Extract<Shape, { type: 'ellipse' }>,
  feather: number,
  frame: ImageFrame,
  g: MapGeometry,
): CoverageSampler | null {
  const c = toPixel(frame, { x: shape.cx, y: shape.cy });
  const rx = lengthToPixels(frame, shape.rx);
  const ry = lengthToPixels(frame, shape.ry);
  if (!(rx > 0) || !(ry > 0) || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return null;
  const theta = (shape.rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const hx = Math.hypot(rx * cos, ry * sin);
  const hy = Math.hypot(rx * sin, ry * cos);
  const b = mapBounds(g, c.x - hx, c.y - hy, c.x + hx, c.y + hy);
  if (b.x0 > b.x1 || b.y0 > b.y1) return null;

  const f = clamp01(feather);
  const inner = 1 - f;
  const inner2 = inner * inner;
  const hard = f < 1e-6;
  const pixel = (g.sx + g.sy) / 2;
  const invRx2 = 1 / (rx * rx);
  const invRy2 = 1 / (ry * ry);
  // Row extent: solve Q(dx, dy) = 1 for dx, where Q is the squared normalised radial distance.
  const qa = cos * cos * invRx2 + sin * sin * invRy2;
  const qb = 2 * sin * cos * (invRx2 - invRy2);
  const qc = sin * sin * invRx2 + cos * cos * invRy2;

  return {
    ...b,
    rowSpan(j, out) {
      const dy = (j + 0.5) * g.sy - c.y;
      const disc = qb * qb * dy * dy - 4 * qa * (qc * dy * dy - 1);
      if (disc < 0) return false;
      const root = Math.sqrt(disc);
      const left = c.x + (-qb * dy - root) / (2 * qa);
      const right = c.x + (-qb * dy + root) / (2 * qa);
      // One map pixel of margin on each side covers the anti-aliased hard edge.
      const i0 = Math.max(b.x0, Math.floor(left / g.sx - 0.5) - 1);
      const i1 = Math.min(b.x1, Math.ceil(right / g.sx - 0.5) + 1);
      if (i0 > i1) return false;
      out[0] = i0;
      out[1] = i1;
      return true;
    },
    sample(i, j) {
      const dx = (i + 0.5) * g.sx - c.x;
      const dy = (j + 0.5) * g.sy - c.y;
      // Rotate into the ellipse frame (clockwise-on-screen rotation, +y down).
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      const d2 = u * u * invRx2 + v * v * invRy2;
      if (!hard) {
        // Skip the square root for the common cases (flat interior, outside).
        if (d2 <= inner2) return 1;
        if (d2 >= 1) return 0;
      }
      const d = Math.sqrt(d2);
      if (hard) {
        if (d < 1e-9) return 1;
        // Approximate signed distance to the outline in image pixels, anti-aliased over one map pixel.
        const gx = u * invRx2;
        const gy = v * invRy2;
        const grad = Math.sqrt(gx * gx + gy * gy) / d;
        const dist = (1 - d) / grad;
        return clamp01(0.5 + dist / pixel);
      }
      if (d <= inner) return 1;
      if (d >= 1) return 0;
      return 1 - smoothstep(inner, 1, d);
    },
  };
}

/**
 * Rectangle spot: rx / ry are the half-width / half-height. Hard edge: the product of two one-pixel
 * anti-aliased ramps (one per axis). Feather f: the product of two smoothstep fall-offs over the outer
 * fraction f of each half-size, so the fade has the same meaning as the ellipse's and the corners come
 * out rounded (no diagonal crease, which a plain box distance would give).
 */
function rectSampler(
  shape: Extract<Shape, { type: 'rect' }>,
  feather: number,
  frame: ImageFrame,
  g: MapGeometry,
): CoverageSampler | null {
  const c = toPixel(frame, { x: shape.cx, y: shape.cy });
  const rx = lengthToPixels(frame, shape.rx);
  const ry = lengthToPixels(frame, shape.ry);
  if (!(rx > 0) || !(ry > 0) || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return null;
  const theta = (shape.rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const hx = Math.abs(rx * cos) + Math.abs(ry * sin);
  const hy = Math.abs(rx * sin) + Math.abs(ry * cos);
  const b = mapBounds(g, c.x - hx, c.y - hy, c.x + hx, c.y + hy);
  if (b.x0 > b.x1 || b.y0 > b.y1) return null;

  const f = clamp01(feather);
  const inner = 1 - f;
  const hard = f < 1e-6;
  const pixel = (g.sx + g.sy) / 2;
  // Corners of the outline grown by one map pixel (so the row span keeps the anti-aliased fringe of a hard
  // edge), in image pixels, in order round the outline. Frame: u right, v down, rotated clockwise on screen.
  const grow = hard ? pixel : 0;
  const cornersX = new Float64Array(4);
  const cornersY = new Float64Array(4);
  const signs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  signs.forEach(([su, sv], k) => {
    const u = su * (rx + grow);
    const v = sv * (ry + grow);
    cornersX[k] = c.x + u * cos - v * sin;
    cornersY[k] = c.y + u * sin + v * cos;
  });
  const fall = (t: number) => (t <= inner ? 1 : t >= 1 ? 0 : 1 - smoothstep(inner, 1, t));

  return {
    ...b,
    rowSpan(j, out) {
      // The rectangle is convex, so the covered part of a row is one run between its outline crossings.
      const y = (j + 0.5) * g.sy;
      let left = Infinity;
      let right = -Infinity;
      for (let k = 0; k < 4; k++) {
        const ax = cornersX[k]!;
        const ay = cornersY[k]!;
        const bx = cornersX[(k + 1) % 4]!;
        const by = cornersY[(k + 1) % 4]!;
        const lo = Math.min(ay, by);
        const hi = Math.max(ay, by);
        if (y < lo || y > hi) continue;
        if (hi - lo < 1e-9) {
          left = Math.min(left, ax, bx);
          right = Math.max(right, ax, bx);
          continue;
        }
        const x = ax + ((y - ay) / (by - ay)) * (bx - ax);
        if (x < left) left = x;
        if (x > right) right = x;
      }
      if (left > right) return false;
      // One map pixel of margin on each side covers rounding to map-pixel centres.
      const i0 = Math.max(b.x0, Math.floor(left / g.sx - 0.5) - 1);
      const i1 = Math.min(b.x1, Math.ceil(right / g.sx - 0.5) + 1);
      if (i0 > i1) return false;
      out[0] = i0;
      out[1] = i1;
      return true;
    },
    sample(i, j) {
      const dx = (i + 0.5) * g.sx - c.x;
      const dy = (j + 0.5) * g.sy - c.y;
      // Rotate into the rectangle frame (clockwise-on-screen rotation, +y down).
      const au = Math.abs(dx * cos + dy * sin);
      const av = Math.abs(-dx * sin + dy * cos);
      if (hard) return clamp01(0.5 + (rx - au) / pixel) * clamp01(0.5 + (ry - av) / pixel);
      if (au >= rx || av >= ry) return 0;
      return fall(au / rx) * fall(av / ry);
    },
  };
}

function pathSampler(
  shape: Extract<Shape, { type: 'path' }>,
  feather: number,
  frame: ImageFrame,
  g: MapGeometry,
): CoverageSampler | null {
  const n = shape.points.length;
  if (n < 3) return null;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < n; k++) {
    const pt = shape.points[k]!;
    const p = toPixel(frame, { x: pt[0], y: pt[1] });
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    xs[k] = p.x;
    ys[k] = p.y;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const b = mapBounds(g, minX, minY, maxX, maxY);
  if (b.x0 > b.x1 || b.y0 > b.y1) return null;

  const featherWidth = clamp01(feather) * 0.5 * Math.min(maxX - minX, maxY - minY);
  // Scanline fill + banded edge distances (see pathCoverage.ts). The raster is scratch memory valid until the
  // next path sampler is created, which holds for the effect-map builder (one sampler at a time).
  const raster = buildPathCoverage(xs, ys, n, b, g.sx, g.sy, featherWidth);
  const cov = raster.cov;
  const w = b.x1 - b.x0 + 1;

  return {
    ...b,
    sample(i, j) {
      return cov[(j - b.y0) * w + (i - b.x0)]!;
    },
  };
}

function maskSampler(
  shape: Extract<Shape, { type: 'mask' }>,
  mask: MaskData | undefined,
  frame: ImageFrame,
  g: MapGeometry,
): CoverageSampler | null {
  if (!mask || mask.width < 1 || mask.height < 1 || mask.data.length < mask.width * mask.height) return null;
  const tl = toPixel(frame, { x: shape.x, y: shape.y });
  const w = lengthToPixels(frame, shape.width);
  const h = lengthToPixels(frame, shape.height);
  if (!(w > 0) || !(h > 0) || !Number.isFinite(tl.x) || !Number.isFinite(tl.y)) return null;
  const b = mapBounds(g, tl.x, tl.y, tl.x + w, tl.y + h);
  if (b.x0 > b.x1 || b.y0 > b.y1) return null;
  const { width: mw, height: mh, data } = mask;

  return {
    ...b,
    sample(i, j) {
      const px = (i + 0.5) * g.sx;
      const py = (j + 0.5) * g.sy;
      if (px < tl.x || py < tl.y || px > tl.x + w || py > tl.y + h) return 0;
      // Texel centres sit at (k + 0.5); clamp to the edge texels.
      let tx = ((px - tl.x) / w) * mw - 0.5;
      let ty = ((py - tl.y) / h) * mh - 0.5;
      tx = tx < 0 ? 0 : tx > mw - 1 ? mw - 1 : tx;
      ty = ty < 0 ? 0 : ty > mh - 1 ? mh - 1 : ty;
      const x0 = Math.floor(tx);
      const y0 = Math.floor(ty);
      const x1 = x0 + 1 < mw ? x0 + 1 : x0;
      const y1 = y0 + 1 < mh ? y0 + 1 : y0;
      const fx = tx - x0;
      const fy = ty - y0;
      const top = data[y0 * mw + x0]! * (1 - fx) + data[y0 * mw + x1]! * fx;
      const bottom = data[y1 * mw + x0]! * (1 - fx) + data[y1 * mw + x1]! * fx;
      return (top * (1 - fy) + bottom * fy) / 255;
    },
  };
}

/**
 * Builds a coverage sampler for one region shape on a map of mapWidth x mapHeight covering the whole image.
 * Map pixel (i, j) has its centre at image pixel ((i + 0.5) * W / mapWidth, (j + 0.5) * H / mapHeight).
 * Returns null when the shape covers nothing (degenerate, outside the map, or a mask with no data).
 */
export function createCoverageSampler(
  shape: Shape,
  feather: number,
  frame: ImageFrame,
  mapWidth: number,
  mapHeight: number,
  mask?: MaskData,
): CoverageSampler | null {
  if (mapWidth < 1 || mapHeight < 1) return null;
  const g: MapGeometry = { sx: frame.width / mapWidth, sy: frame.height / mapHeight, mapWidth, mapHeight };
  switch (shape.type) {
    case 'ellipse':
      return ellipseSampler(shape, feather, frame, g);
    case 'rect':
      return rectSampler(shape, feather, frame, g);
    case 'path':
      return pathSampler(shape, feather, frame, g);
    case 'mask':
      return maskSampler(shape, mask, frame, g);
    case 'full':
      return { x0: 0, y0: 0, x1: mapWidth - 1, y1: mapHeight - 1, sample: () => 1 };
  }
}

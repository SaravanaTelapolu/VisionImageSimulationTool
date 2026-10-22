import { lengthToPixels, toPixel } from '../model/coords';
import { MAX_SIZE_CHANGE, MAX_SIZE_CHANGE_LENSES, type ImageFrame, type Region } from '../model/types';
import type { SizeChangeLens } from './types';

/** Weight of a lens at normalised radius r (0 centre, 1 edge); mirrors lensWeight() in the shader. */
export function lensWeight(r: number, feather: number): number {
  if (r >= 1) return 0;
  if (feather <= 1e-4) return 1;
  const t = Math.min(Math.max((1 - r) / feather, 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Where output pixel `p` samples the source under a set of size-change lenses (all in the same
 * pixel space). Mirrors applyLenses() in shaders/effects.ts. The normalised radius is elliptical
 * (hypot) for ovals and the box norm (max of |u|, |v|) for rectangles.
 *
 * Overlap rule (L8): lenses do not compound. Each lens on its own would move the sample point by
 * d_i = (p - c_i) * (1 / (1 + a_i * w_i) - 1), where a_i is its amount and w_i its feathered
 * weight at p. The displacements are blended with weights s_i^4, s_i = |a_i * w_i|: a soft
 * "strongest lens wins" that stays continuous where lenses meet (a hard switch would tear the
 * image along the seam). Two identical overlapping lenses therefore look like one lens, the
 * magnification never exceeds the strongest lens's +-30% where one lens dominates, and a lens
 * that does not reach p has no influence on it.
 */
export function warpByLenses(p: { x: number; y: number }, lenses: readonly SizeChangeLens[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let wsum = 0;
  for (const l of lenses) {
    const amount = Math.max(-MAX_SIZE_CHANGE, Math.min(MAX_SIZE_CHANGE, l.amount));
    if (amount === 0 || !(l.rx > 0) || !(l.ry > 0)) continue;
    const dx = p.x - l.cx;
    const dy = p.y - l.cy;
    const c = Math.cos(l.rotation);
    const s = Math.sin(l.rotation);
    const lx = (c * dx + s * dy) / l.rx;
    const ly = (-s * dx + c * dy) / l.ry;
    const r = l.box ? Math.max(Math.abs(lx), Math.abs(ly)) : Math.hypot(lx, ly);
    const w = lensWeight(r, Math.max(0, Math.min(1, l.feather)));
    const strength = Math.abs(amount * w);
    if (!(strength > 0)) continue;
    const k = 1 / (1 + amount * w) - 1;
    const weight = strength ** 4;
    sx += dx * k * weight;
    sy += dy * k * weight;
    wsum += weight;
  }
  return wsum > 0 ? { x: p.x + sx / wsum, y: p.y + sy / wsum } : { x: p.x, y: p.y };
}

/**
 * Size-change lenses for the distortion pass: visible spot (ellipse or rectangle) regions with a
 * non-zero sizeChange, in image pixels, rotation in radians, amount clamped to +-MAX_SIZE_CHANGE,
 * `box` set for rectangles. Only the first
 * MAX_SIZE_CHANGE_LENSES (in region order) are returned.
 */
export function collectLenses(regions: Region[], frame: ImageFrame): SizeChangeLens[] {
  const lenses: SizeChangeLens[] = [];
  for (const region of regions) {
    if (lenses.length >= MAX_SIZE_CHANGE_LENSES) break;
    const shape = region.shape;
    if (!region.visible || (shape.type !== 'ellipse' && shape.type !== 'rect')) continue;
    const change = region.effects.sizeChange;
    if (!Number.isFinite(change) || change === 0) continue;
    const rx = lengthToPixels(frame, shape.rx);
    const ry = lengthToPixels(frame, shape.ry);
    if (!(rx > 0) || !(ry > 0)) continue;
    const c = toPixel(frame, { x: shape.cx, y: shape.cy });
    lenses.push({
      cx: c.x,
      cy: c.y,
      rx,
      ry,
      rotation: (shape.rotation * Math.PI) / 180,
      amount: Math.max(-MAX_SIZE_CHANGE, Math.min(MAX_SIZE_CHANGE, change)),
      feather: Math.max(0, Math.min(1, region.feather)),
      box: shape.type === 'rect',
    });
  }
  return lenses;
}

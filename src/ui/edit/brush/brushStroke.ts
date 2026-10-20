import type { Vec2 } from '../../../model/types';
import {
  imageLengthToMaskPx,
  imageToMaskPx,
  stampSoftCircle,
  strokeSpacing,
  strokeStamps,
  type BrushMode,
  type Rect,
} from '../../../render/maskRaster';
import type { MaskData } from '../../../render/shapeCoverage';

export interface BrushStrokeOptions {
  /** The greyscale buffer to paint into (modified in place). */
  mask: MaskData;
  /** Where the mask sits, in image pixels. */
  rect: Rect;
  /** Brush diameter in image pixels. */
  diameter: number;
  /** 0 = hard edge, 1 = fully soft. */
  softness: number;
  mode: BrushMode;
}

export interface BrushStroke {
  /** Adds a point (image px) to the stroke, stamping along the way from the previous point. */
  add(p: Vec2): void;
}

/** One brush stroke: soft round stamps every quarter radius along the path of the finger. */
export function createBrushStroke(opts: BrushStrokeOptions): BrushStroke {
  const { mask, rect, softness, mode } = opts;
  const radius = Math.max(0.5, imageLengthToMaskPx(opts.diameter / 2, rect, mask.width, mask.height));
  const spacing = strokeSpacing(radius);
  let last: Vec2 | null = null;
  let carry = 0;
  return {
    add(p) {
      const m = imageToMaskPx(p, rect, mask.width, mask.height);
      if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
      const r = strokeStamps(last, m, spacing, carry);
      last = m;
      carry = r.carry;
      for (const s of r.stamps) stampSoftCircle(mask.data, mask.width, mask.height, s.x, s.y, radius, softness, mode);
    },
  };
}

/** True when two buffers hold the same pixels. */
export function sameMask(a: MaskData, b: MaskData): boolean {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

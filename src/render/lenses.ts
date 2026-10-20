import { lengthToPixels, toPixel } from '../model/coords';
import { MAX_SIZE_CHANGE, MAX_SIZE_CHANGE_LENSES, type ImageFrame, type Region } from '../model/types';
import type { SizeChangeLens } from './types';

/**
 * Size-change lenses for the distortion pass: visible ellipse regions with a non-zero sizeChange,
 * in image pixels, rotation in radians, amount clamped to +-MAX_SIZE_CHANGE. Only the first
 * MAX_SIZE_CHANGE_LENSES (in region order) are returned.
 */
export function collectLenses(regions: Region[], frame: ImageFrame): SizeChangeLens[] {
  const lenses: SizeChangeLens[] = [];
  for (const region of regions) {
    if (lenses.length >= MAX_SIZE_CHANGE_LENSES) break;
    const shape = region.shape;
    if (!region.visible || shape.type !== 'ellipse') continue;
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
    });
  }
  return lenses;
}

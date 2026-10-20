// Editing-mode state: placing a new shape by tapping on the image.
import { signal } from '@preact/signals';
import { fromPixel } from '../model/coords';
import { defaultEllipse, newRegion } from '../model/defaults';
import { addRegion } from '../model/ops';
import type { Region, Shape, Vec2 } from '../model/types';
import { applyEdit, endEdit, imageFrame, profile, selectedRegionId } from './store';

/** Set while the next tap on the image should add a shape of this kind. */
export const placingShape = signal<null | 'ellipse'>(null);

export function startPlacing(kind: 'ellipse'): void {
  placingShape.value = kind;
}

export function cancelPlacing(): void {
  placingShape.value = null;
}

/**
 * Adds the shape being placed, centred on `point` (image pixels), selects it and leaves placement mode.
 * Returns the new region, or null when nothing is being placed or no image is loaded.
 */
export function placeShapeAt(point: Vec2): Region | null {
  const kind = placingShape.peek();
  const frame = imageFrame.peek();
  if (!kind || !frame) return null;
  const u = fromPixel(frame, point);
  const base = defaultEllipse();
  const shape: Shape = base.type === 'ellipse' ? { ...base, cx: u.x, cy: u.y } : base;
  const region = newRegion(shape, `Spot ${profile.peek().regions.length + 1}`);
  applyEdit((p) => addRegion(p, region));
  endEdit();
  selectedRegionId.value = region.id;
  placingShape.value = null;
  return region;
}

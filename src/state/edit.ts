// Editing-mode state: placing a new shape by tapping on the image.
import { signal } from '@preact/signals';
import { fromPixel } from '../model/coords';
import { defaultEllipse, defaultRect, newRegion } from '../model/defaults';
import { addRegion } from '../model/ops';
import type { Region, Shape, Vec2 } from '../model/types';
import type { BrushMode } from '../render/maskRaster';
import { nextRegionName } from '../ui/panels/regions/helpers';
import { applyEdit, endEdit, imageFrame, profile, selectedRegionId } from './store';

export type PlacingKind = 'ellipse' | 'rect' | 'path' | 'brush';

/**
 * The active image tool. 'ellipse' / 'rect': the next tap adds an oval / rectangle spot. 'path':
 * one-finger drag draws a freehand outline. 'brush': one-finger drag paints on the selected mask region.
 */
export const placingShape = signal<null | PlacingKind>(null);

/** While redrawing the outline of an existing path region ('path' mode), that region's id. */
export const redrawingPathId = signal<string | null>(null);

export function startPlacing(kind: PlacingKind): void {
  redrawingPathId.value = null;
  placingShape.value = kind;
}

/** Starts freehand drawing that replaces the outline of an existing path region. */
export function startRedrawing(regionId: string): void {
  placingShape.value = 'path';
  redrawingPathId.value = regionId;
}

export function cancelPlacing(): void {
  placingShape.value = null;
  redrawingPathId.value = null;
}

// --- Brush settings (shared by the brush tool and the regions panel toolbar) ----------------

export type { BrushMode };

export const brushMode = signal<BrushMode>('paint');
/** Brush diameter in shorter-side units, so it means the same on any screen or zoom level. */
export const brushSize = signal(0.08);
export const BRUSH_SIZE_MIN = 0.01;
export const BRUSH_SIZE_MAX = 0.3;
/** 0 = hard edge, 1 = fully soft. */
export const brushSoftness = signal(0.5);

/**
 * Adds the shape being placed, centred on `point` (image pixels), selects it and leaves placement mode.
 * Returns the new region, or null when nothing is being placed or no image is loaded.
 */
export function placeShapeAt(point: Vec2): Region | null {
  const kind = placingShape.peek();
  const frame = imageFrame.peek();
  if ((kind !== 'ellipse' && kind !== 'rect') || !frame) return null;
  const u = fromPixel(frame, point);
  const base = kind === 'rect' ? defaultRect() : defaultEllipse();
  const shape: Shape = base.type === 'ellipse' || base.type === 'rect' ? { ...base, cx: u.x, cy: u.y } : base;
  const name = kind === 'rect' ? nextRegionName(profile.peek(), 'rect') : `Spot ${profile.peek().regions.length + 1}`;
  const region = newRegion(shape, name);
  applyEdit((p) => addRegion(p, region));
  endEdit();
  selectedRegionId.value = region.id;
  placingShape.value = null;
  return region;
}

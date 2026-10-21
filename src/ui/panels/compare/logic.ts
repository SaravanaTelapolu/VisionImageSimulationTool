// Pure maths for the compare views (no DOM): wipe divider, side-by-side layout.
import type { Size } from '../../viewport/transform';

export const WIPE_MIN = 0;
export const WIPE_MAX = 1;
export const WIPE_STEP = 0.02;
export const WIPE_STEP_BIG = 0.1;

/** Keeps a wipe position inside 0..1; anything that is not a number falls back to the middle. */
export function clampWipe(pos: number): number {
  if (!Number.isFinite(pos)) return 0.5;
  return Math.min(WIPE_MAX, Math.max(WIPE_MIN, pos));
}

/** New wipe position for a keyboard key, or null when the key does not move the divider. */
export function wipeAfterKey(pos: number, key: string, big = false): number | null {
  const step = big ? WIPE_STEP_BIG : WIPE_STEP;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return clampWipe(pos - step);
    case 'ArrowRight':
    case 'ArrowUp':
      return clampWipe(pos + step);
    case 'PageDown':
      return clampWipe(pos - WIPE_STEP_BIG);
    case 'PageUp':
      return clampWipe(pos + WIPE_STEP_BIG);
    case 'Home':
      return WIPE_MIN;
    case 'End':
      return WIPE_MAX;
    default:
      return null;
  }
}

/** Wipe position for a pointer at clientX, inside a box that starts at `left` and is `width` wide. */
export function wipeFromClientX(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return 0.5;
  return clampWipe((clientX - left) / width);
}

/**
 * Where the simulated layer starts, in the layer's own pixels. The divider sits at `pos` of the
 * box width on screen; the layer is drawn at screen = x * scale + tx. Result is clamped to 0..layerWidth.
 */
export function clipLeft(pos: number, boxWidth: number, tx: number, scale: number, layerWidth: number): number {
  if (!(scale > 0)) return 0;
  const x = (clampWipe(pos) * boxWidth - tx) / scale;
  return Math.min(layerWidth, Math.max(0, x));
}

export type SideBySideLayout = 'stacked' | 'side-by-side';

/** Stacked vertically when the area is portrait (phones), side by side when it is landscape. */
export function chooseSideBySideLayout(box: Size): SideBySideLayout {
  return box.width > box.height ? 'side-by-side' : 'stacked';
}

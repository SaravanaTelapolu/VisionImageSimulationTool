import type { ImageFrame, Vec2 } from './types';

/** Converts fixation-relative units (shorter side = 1) to image pixels. */
export function toPixel(frame: ImageFrame, p: Vec2): Vec2 {
  const s = Math.min(frame.width, frame.height);
  return { x: frame.fixation.x + p.x * s, y: frame.fixation.y + p.y * s };
}

/** Converts image pixels to fixation-relative units. */
export function fromPixel(frame: ImageFrame, p: Vec2): Vec2 {
  const s = Math.min(frame.width, frame.height);
  return { x: (p.x - frame.fixation.x) / s, y: (p.y - frame.fixation.y) / s };
}

/** Converts a length in shorter-side units to pixels. */
export function lengthToPixels(frame: ImageFrame, length: number): number {
  return length * Math.min(frame.width, frame.height);
}

/** A frame with the fixation point at the image centre. */
export function centredFrame(width: number, height: number): ImageFrame {
  return { width, height, fixation: { x: width / 2, y: height / 2 } };
}

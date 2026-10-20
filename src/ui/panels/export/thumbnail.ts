// Small side-by-side preview of the export, built from the live preview canvas (cheap: no full-size render).
import { composeExport } from '../../../export';
import { snapshotPreview } from '../../../state/render';
import { image } from '../../../state/store';
import type { ExportOptions } from './options';
import { scaledCopy } from './run';

/** Long side of each panel in the thumbnail. */
export const THUMB_MAX_SIDE = 480;

/** Composes the thumbnail, or null when there is no image or no live simulation to copy. */
export function buildThumbnail(opts: ExportOptions, caption: string[] | undefined): HTMLCanvasElement | null {
  const img = image.peek();
  const snap = snapshotPreview();
  if (!img || !snap) return null;
  const sim = scaledCopy(snap, THUMB_MAX_SIDE);
  const orig = document.createElement('canvas');
  orig.width = sim.width;
  orig.height = sim.height;
  const ctx = orig.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img.working, 0, 0, orig.width, orig.height);
  return composeExport({
    simulated: sim,
    original: orig,
    orientation: opts.orientation,
    labels: opts.labels,
    ...(opts.caption && caption ? { caption } : {}),
  });
}

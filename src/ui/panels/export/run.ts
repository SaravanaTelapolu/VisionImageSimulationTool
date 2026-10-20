// The export job: renders what the options ask for and hands every file to the share sheet at once.
import { canvasToBlob, composeExport, shareOrDownload } from '../../../export';
import type { ShareFile } from '../../../export';
import { getOriginalCanvas, renderFullSize } from '../../../state/render';
import { captionLinesFromFields, planExportFiles, type CaptionFields, type ExportOptions, type ShareOutcome } from './options';

/** Long side of each panel in the side-by-side image (keeps the canvas inside phone limits). */
export const SIDE_BY_SIDE_MAX_SIDE = 2048;

export interface ExportJobResult {
  outcome: ShareOutcome;
  fileCount: number;
  /** True when the device could not render the full size and a smaller image was produced. */
  downscaled: boolean;
  /** Pixel size of the simulated render. */
  width: number;
  height: number;
}

const mime = (o: ExportOptions): 'image/png' | 'image/jpeg' => (o.format === 'jpeg' ? 'image/jpeg' : 'image/png');

async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  try {
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available.');
    ctx.drawImage(bmp, 0, 0);
    return c;
  } finally {
    bmp.close();
  }
}

/** The canvas itself, or a copy scaled down so its long side is at most maxSide. */
export function scaledCopy(src: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  const long = Math.max(src.width, src.height);
  if (long <= maxSide) return src;
  const k = maxSide / long;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * k));
  c.height = Math.max(1, Math.round(src.height * k));
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/**
 * Renders every chosen file, then shares or downloads them in a single call.
 * `onProgress` receives a short plain-language step ("Rendering…").
 */
export async function runExportJob(
  opts: ExportOptions,
  fields: CaptionFields,
  onProgress: (text: string) => void = () => undefined,
): Promise<ExportJobResult> {
  const today = new Date();
  const plan = planExportFiles(opts, fields, today);
  if (plan.length === 0) throw new Error('Choose at least one thing to save.');
  const type = mime(opts);
  const quality = opts.jpegQuality;
  const caption = opts.caption ? captionLinesFromFields(fields, today) : undefined;
  const files: ShareFile[] = [];
  const nameOf = (kind: string): string => plan.find((p) => p.kind === kind)?.name ?? `${kind}.${opts.format}`;

  // The simulation is rendered once. When its pixels are needed again (caption, JPEG re-encode,
  // side by side) it is rendered as PNG so nothing is compressed twice.
  const needPixels = opts.sideBySide || (opts.simulated && opts.caption);
  onProgress('Rendering…');
  const sim = await renderFullSize(needPixels ? { type: 'image/png' } : { type, quality });
  const simCanvas = needPixels ? await blobToCanvas(sim.blob) : null;

  if (opts.simulated) {
    if (simCanvas && opts.caption) {
      onProgress('Adding the caption…');
      const withCaption = composeExport({ simulated: simCanvas, orientation: 'auto', ...(caption ? { caption } : {}) });
      files.push({ blob: await canvasToBlob(withCaption, type, quality), name: nameOf('simulated') });
    } else if (simCanvas && type !== 'image/png') {
      files.push({ blob: await canvasToBlob(simCanvas, type, quality), name: nameOf('simulated') });
    } else {
      files.push({ blob: sim.blob, name: nameOf('simulated') });
    }
  }

  if (opts.original) {
    onProgress('Preparing the original…');
    const orig = await getOriginalCanvas();
    files.push({ blob: await canvasToBlob(orig, type, quality), name: nameOf('original') });
  }

  if (opts.sideBySide && simCanvas) {
    onProgress('Building the side-by-side image…');
    const simPanel = scaledCopy(simCanvas, SIDE_BY_SIDE_MAX_SIDE);
    const original = await getOriginalCanvas(Math.max(simPanel.width, simPanel.height));
    const composed = composeExport({
      simulated: simPanel,
      original,
      orientation: opts.orientation,
      labels: opts.labels,
      ...(caption ? { caption } : {}),
    });
    files.push({ blob: await canvasToBlob(composed, type, quality), name: nameOf('side-by-side') });
  }

  onProgress('Sharing…');
  const outcome = await shareOrDownload(files, 'Vision simulation');
  return { outcome, fileCount: files.length, downscaled: sim.downscaled, width: sim.width, height: sim.height };
}

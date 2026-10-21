// The export job, in two steps so Android's share sheet works: "prepare" renders every file (this can
// take seconds), then "share" runs straight from a fresh tap, because navigator.share needs one.
import { canvasToBlob, composeExport } from '../../../export';
import type { ShareFile } from '../../../export';
import { getOriginalCanvas, renderFullSizeCanvas } from '../../../state/render';
import { captionLinesFromFields, planExportFiles, type CaptionFields, type ExportOptions } from './options';

/** Long side of each panel in the side-by-side image (keeps the canvas inside phone limits). */
export const SIDE_BY_SIDE_MAX_SIDE = 2048;

/** Everything the Share and Download buttons need, rendered ahead of the tap. */
export interface PreparedExport {
  files: ShareFile[];
  /** The same files as File objects, built ahead so the tap handler has nothing to wait for. */
  shareFiles: File[];
  /** True when the device could not render the full size and a smaller image was produced. */
  downscaled: boolean;
  /** Pixel size of the simulated render. */
  width: number;
  height: number;
  /** Pixel size of the original photo. */
  originalWidth: number;
  originalHeight: number;
  /** Why "Full resolution" fell back to a smaller image, when it did. */
  fallback?: string;
}

const mime = (o: ExportOptions): 'image/png' | 'image/jpeg' => (o.format === 'jpeg' ? 'image/jpeg' : 'image/png');

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
 * Step 1: renders every chosen file. Nothing is shared or saved yet.
 * `onProgress` receives a short plain-language step ("Rendering…").
 */
export async function prepareExport(
  opts: ExportOptions,
  fields: CaptionFields,
  onProgress: (text: string) => void = () => undefined,
): Promise<PreparedExport> {
  const today = new Date();
  const plan = planExportFiles(opts, fields, today);
  if (plan.length === 0) throw new Error('Choose at least one thing to save.');
  const type = mime(opts);
  const quality = opts.jpegQuality;
  const caption = opts.caption ? captionLinesFromFields(fields, today) : undefined;
  const files: ShareFile[] = [];
  const nameOf = (kind: string): string => plan.find((p) => p.kind === kind)?.name ?? `${kind}.${opts.format}`;

  // The simulation is rendered once, as a canvas (no PNG round trip). A simulated file always goes
  // through composeExport, because it must carry the caption or, when the caption is off, the
  // one-line approximation strip (review L3). The Original export stays clean and needs no render.
  const needPixels = opts.sideBySide || opts.simulated;
  let simCanvas: HTMLCanvasElement | null = null;
  const fullResolution = opts.size === 'full';
  let size: Pick<PreparedExport, 'width' | 'height' | 'downscaled' | 'originalWidth' | 'originalHeight' | 'fallback'> = {
    width: 0,
    height: 0,
    downscaled: false,
    originalWidth: 0,
    originalHeight: 0,
  };
  if (needPixels) {
    onProgress(fullResolution ? 'Rendering at full resolution…' : 'Rendering…');
    const sim = await renderFullSizeCanvas({ fullResolution });
    simCanvas = sim.canvas;
    size = {
      width: sim.width,
      height: sim.height,
      downscaled: sim.downscaled,
      originalWidth: sim.originalWidth,
      originalHeight: sim.originalHeight,
      ...(sim.fallback ? { fallback: sim.fallback } : {}),
    };
  }

  if (opts.simulated && simCanvas) {
    onProgress(caption ? 'Adding the caption…' : 'Adding the approximation note…');
    const composed = composeExport({ simulated: simCanvas, orientation: 'auto', ...(caption ? { caption } : {}) });
    files.push({ blob: await canvasToBlob(composed, type, quality), name: nameOf('simulated') });
  }

  if (opts.original) {
    onProgress('Preparing the original…');
    const orig = await getOriginalCanvas(undefined, { fullResolution });
    if (!simCanvas) {
      size = { width: orig.width, height: orig.height, downscaled: false, originalWidth: orig.width, originalHeight: orig.height };
    }
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

  const shareFiles = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
  return { files, shareFiles, ...size };
}

// --- Step 2: share or download, straight from a tap ---------------------------------------------

type ShareNavigator = Pick<Navigator, 'share' | 'canShare'>;

const currentNavigator = (): Partial<ShareNavigator> => (typeof navigator === 'undefined' ? {} : navigator);

/** True when this browser can hand these files to a share sheet (Android Chrome, iOS Safari). */
export function canShareFiles(shareFiles: File[], nav: Partial<ShareNavigator> = currentNavigator()): boolean {
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files: shareFiles });
  } catch {
    return false;
  }
}

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

/**
 * Opens the share sheet. navigator.share is called synchronously, before anything is awaited, so it
 * still counts as part of the user's tap. Resolves 'cancelled' when the sheet is dismissed; any other
 * failure rejects (the caller offers "Download instead").
 */
export function shareNow(
  shareFiles: File[],
  title: string,
  nav: Partial<ShareNavigator> = currentNavigator(),
): Promise<'shared' | 'cancelled'> {
  let pending: Promise<void>;
  try {
    if (typeof nav.share !== 'function') throw new Error('Sharing is not available in this browser.');
    pending = nav.share({ files: shareFiles, title });
  } catch (e) {
    return Promise.reject(e);
  }
  return pending.then(
    () => 'shared' as const,
    (e: unknown) => {
      if (isAbort(e)) return 'cancelled' as const;
      throw e;
    },
  );
}

/** Saves every file through the browser's download mechanism. Returns how many were started. */
export function downloadFiles(files: ShareFile[]): number {
  for (const f of files) {
    const url = URL.createObjectURL(f.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return files.length;
}

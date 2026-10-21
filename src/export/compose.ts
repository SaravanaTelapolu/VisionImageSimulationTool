import { APPROXIMATION_LINE, wrapText } from './caption';
import { captionPadFor, labelBandFor, layoutExport, lineHeightFor } from './layout';

export type SizedImageSource = CanvasImageSource & { width: number; height: number };

export interface ComposeOptions {
  simulated: SizedImageSource;
  original?: SizedImageSource;
  orientation: 'auto' | 'horizontal' | 'vertical';
  caption?: string[];
  labels?: boolean;
  background?: string;
  /**
   * With no caption lines, a small strip carrying the "my own approximation" note is still added
   * (default true). Pass false only for images that must stay clean, such as the Original export.
   */
  approximationNote?: boolean;
}

const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Intrinsic pixel size of an image source (natural size for <img>, else width/height). */
function sizeOf(src: SizedImageSource): { w: number; h: number } {
  const s = src as unknown as Record<string, unknown>;
  const pick = (a: string, b: string): number => {
    const v = s[a];
    return typeof v === 'number' && v > 0 ? v : (s[b] as number);
  };
  return { w: pick('naturalWidth', 'width'), h: pick('naturalHeight', 'height') };
}

/** Draws the (optional) original and the simulated image with labels and a caption bar. */
export function composeExport(opts: ComposeOptions): HTMLCanvasElement {
  const labels = opts.labels ?? false;
  const simSize = sizeOf(opts.simulated);
  const origSize = opts.original ? sizeOf(opts.original) : undefined;
  const base = {
    simulated: simSize,
    ...(origSize ? { original: origSize } : {}),
    orientation: opts.orientation,
    labels,
  };

  // Width and font do not depend on the caption, so measure first, then size the bar.
  const probe = layoutExport({ ...base, captionLines: 0 });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');

  const fontPx = probe.fontPx;
  ctx.font = `${fontPx}px ${FONT_FAMILY}`;
  const pad = captionPadFor(fontPx);
  const measure = (s: string): number => ctx.measureText(s).width;
  const wrapped: string[] = [];
  const captionLines = opts.caption ?? [];
  // A caption always ends with the approximation line already; without one, add just that line.
  const noteOnly = captionLines.length === 0 && (opts.approximationNote ?? true);
  for (const line of noteOnly ? [APPROXIMATION_LINE] : captionLines) wrapped.push(...wrapText(line, probe.width - 2 * pad, measure));

  const layout = layoutExport({ ...base, captionLines: wrapped.length });
  // Resizing resets the context state, so everything is set after this.
  canvas.width = layout.width;
  canvas.height = layout.height;
  ctx.fillStyle = opts.background ?? '#111111';
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const sources = opts.original ? [opts.original, opts.simulated] : [opts.simulated];
  layout.panels.forEach((p, i) => {
    const src = sources[i];
    if (src) ctx.drawImage(src, p.x, p.y, p.w, p.h);
    if (p.label) {
      ctx.font = `600 ${fontPx}px ${FONT_FAMILY}`;
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(p.label, p.x + Math.round(fontPx * 0.3), p.y - labelBandFor(fontPx) / 2, p.w);
    }
  });

  if (layout.caption) {
    const c = layout.caption;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = noteOnly ? '#c8c8c8' : '#ffffff';
    ctx.font = `${fontPx}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const lh = lineHeightFor(fontPx);
    wrapped.forEach((line, i) => {
      ctx.fillText(line, c.x + pad, c.y + pad + i * lh + lh / 2);
    });
  }
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))),
      type,
      quality,
    );
  });
}

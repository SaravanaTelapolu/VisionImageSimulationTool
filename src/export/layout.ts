export interface Size {
  w: number;
  h: number;
}

export interface PanelLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  /** "Original" / "Simulated", or '' when labels are off. */
  label: string;
}

export interface ExportLayout {
  width: number;
  height: number;
  panels: PanelLayout[];
  caption: { x: number; y: number; w: number; h: number } | null;
  fontPx: number;
  gap: number;
}

export interface LayoutOptions {
  simulated: Size;
  original?: Size;
  orientation: 'auto' | 'horizontal' | 'vertical';
  captionLines: number;
  labels: boolean;
}

export const MIN_FONT_PX = 14;
/** 'auto' stacks the panels only when the image is wider than this (width / height). */
export const AUTO_STACK_ASPECT = 1.15;
const FONT_FRACTION = 0.028;

export const lineHeightFor = (fontPx: number): number => Math.round(fontPx * 1.35);
export const captionPadFor = (fontPx: number): number => Math.round(fontPx * 0.6);
/** Height of the strip above each panel that holds its label (labels on only). */
export const labelBandFor = (fontPx: number): number => Math.round(fontPx * 1.6);

/**
 * Lays out the export image. The simulated image keeps its own pixel size; the original (if any)
 * is scaled to the same height (horizontal) or width (vertical). The original comes first.
 * 'auto' places portrait and square images (and near-square ones up to aspect 1.15) side by side;
 * only clearly landscape images (aspect > 1.15) are stacked.
 * Labels sit in a band above each panel (panel.y already includes the band).
 */
export function layoutExport(opts: LayoutOptions): ExportLayout {
  const sim = opts.simulated;
  const orig = opts.original;
  const horizontal =
    opts.orientation === 'horizontal' || (opts.orientation === 'auto' && sim.w / sim.h <= AUTO_STACK_ASPECT);

  const items: { size: Size; label: string }[] = [];
  if (orig) items.push({ size: orig, label: 'Original' });
  items.push({ size: sim, label: 'Simulated' });

  const sizes: Size[] = items.map(({ size }) =>
    horizontal
      ? { w: Math.max(1, Math.round((size.w * sim.h) / size.h)), h: sim.h }
      : { w: sim.w, h: Math.max(1, Math.round((size.h * sim.w) / size.w)) },
  );

  const n = items.length;
  const widthNoGap = horizontal ? sizes.reduce((a, s) => a + s.w, 0) : sim.w;
  const fontPx = Math.max(MIN_FONT_PX, Math.round(widthNoGap * FONT_FRACTION));
  const gap = n > 1 ? Math.max(4, Math.round(fontPx * 0.5)) : 0;
  const band = opts.labels ? labelBandFor(fontPx) : 0;

  const panels: PanelLayout[] = [];
  let width: number;
  let contentBottom: number;
  if (horizontal) {
    width = widthNoGap + gap * (n - 1);
    let x = 0;
    sizes.forEach((s, i) => {
      panels.push({ x, y: band, w: s.w, h: s.h, label: opts.labels ? items[i]!.label : '' });
      x += s.w + gap;
    });
    contentBottom = band + sim.h;
  } else {
    width = sim.w;
    let y = 0;
    sizes.forEach((s, i) => {
      panels.push({ x: 0, y: y + band, w: s.w, h: s.h, label: opts.labels ? items[i]!.label : '' });
      y += band + s.h + gap;
    });
    contentBottom = y - gap;
  }

  let caption: ExportLayout['caption'] = null;
  let height = contentBottom;
  if (opts.captionLines > 0) {
    const h = opts.captionLines * lineHeightFor(fontPx) + 2 * captionPadFor(fontPx);
    caption = { x: 0, y: contentBottom, w: width, h };
    height = contentBottom + h;
  }
  return { width, height, panels, caption, fontPx, gap };
}

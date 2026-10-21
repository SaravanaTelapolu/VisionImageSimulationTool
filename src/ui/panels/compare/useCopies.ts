import { useSignalEffect, type ReadonlySignal } from '@preact/signals';
import type { RefObject } from 'preact';
import { previewSource, renderTick } from '../../../state/render';
import { image, previewCanvas } from '../../../state/store';

/** Displayed size in CSS pixels. Copies are drawn no bigger than this (times the pixel ratio), which keeps thin lines clean. */
export interface DisplaySize {
  width: number;
  height: number;
}

/** Sizes the canvas to the source, or smaller when it is shown small, and draws the source into it. */
function draw(
  canvas: HTMLCanvasElement,
  src: CanvasImageSource,
  w: number,
  h: number,
  target: DisplaySize | null | undefined,
): void {
  let cw = w;
  let ch = h;
  if (target && target.width > 0 && target.height > 0) {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const k = Math.min(1, (target.width * dpr) / w, (target.height * dpr) / h);
    cw = Math.max(1, Math.round(w * k));
    ch = Math.max(1, Math.round(h * k));
  }
  if (canvas.width !== cw) canvas.width = cw;
  if (canvas.height !== ch) canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, cw, ch);
}

/** Keeps a 2D canvas showing the untouched working image. */
export function useOriginalCopy(ref: RefObject<HTMLCanvasElement>, target?: ReadonlySignal<DisplaySize | null>): void {
  useSignalEffect(() => {
    const img = image.value;
    const src = previewSource.value; // same pixels the simulation starts from (H3)
    const canvas = ref.current;
    if (!img || !canvas) return;
    if (src && src.width > 0 && src.height > 0) draw(canvas, src, src.width, src.height, target?.value);
    else draw(canvas, img.working, img.width, img.height, target?.value);
  });
}

/**
 * Keeps a 2D canvas showing a copy of the simulated preview, redrawn after every render
 * (renderTick). Without a live preview (no WebGL) it shows the original image instead.
 */
export function useSimulatedCopy(ref: RefObject<HTMLCanvasElement>, target?: ReadonlySignal<DisplaySize | null>): void {
  useSignalEffect(() => {
    void renderTick.value;
    const img = image.value;
    const preview = previewCanvas.value;
    const canvas = ref.current;
    if (!img || !canvas) return;
    const t = target?.value;
    if (preview && preview.width > 0 && preview.height > 0) {
      draw(canvas, preview, preview.width, preview.height, t);
      return;
    }
    draw(canvas, img.working, img.width, img.height, t);
  });
}

import { useSignalEffect } from '@preact/signals';
import type { RefObject } from 'preact';
import { renderTick } from '../../../state/render';
import { image, previewCanvas } from '../../../state/store';

function size(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return canvas.getContext('2d');
}

/** Keeps a 2D canvas showing the untouched working image. */
export function useOriginalCopy(ref: RefObject<HTMLCanvasElement>): void {
  useSignalEffect(() => {
    const img = image.value;
    const canvas = ref.current;
    if (!img || !canvas) return;
    const ctx = size(canvas, img.width, img.height);
    ctx?.drawImage(img.working, 0, 0, img.width, img.height);
  });
}

/**
 * Keeps a 2D canvas showing a copy of the simulated preview, redrawn after every render
 * (renderTick). Without a live preview (no WebGL) it shows the original image instead.
 */
export function useSimulatedCopy(ref: RefObject<HTMLCanvasElement>): void {
  useSignalEffect(() => {
    void renderTick.value;
    const img = image.value;
    const preview = previewCanvas.value;
    const canvas = ref.current;
    if (!img || !canvas) return;
    if (preview && preview.width > 0 && preview.height > 0) {
      const ctx = size(canvas, preview.width, preview.height);
      ctx?.drawImage(preview, 0, 0);
      return;
    }
    size(canvas, img.width, img.height)?.drawImage(img.working, 0, 0, img.width, img.height);
  });
}

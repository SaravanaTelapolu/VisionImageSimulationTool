export interface WorkingImage {
  original: File;
  working: ImageBitmap | HTMLCanvasElement;
  width: number;
  height: number;
}

/**
 * Scale (w, h) so the longer side is at most maxLongSide, keeping aspect ratio.
 * Never upscales. Results are whole pixels, at least 1.
 */
export function fitWithin(
  w: number,
  h: number,
  maxLongSide: number,
): { width: number; height: number } {
  const long = Math.max(w, h);
  if (!(long > 0) || long <= maxLongSide) return { width: w, height: h };
  const scale = maxLongSide / long;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

function drawToCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

async function decodeToCanvas(file: File, maxLongSide: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, maxLongSide);
    return drawToCanvas(img, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Decode a photo into a working-size bitmap (long side <= maxLongSide).
 * Uses createImageBitmap (honouring EXIF orientation) when available, else a canvas.
 */
export async function loadWorkingImage(file: File, maxLongSide = 2048): Promise<WorkingImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const full = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const { width, height } = fitWithin(full.width, full.height, maxLongSide);
      if (width === full.width && height === full.height) {
        return { original: file, working: full, width, height };
      }
      try {
        try {
          const resized = await createImageBitmap(full, {
            resizeWidth: width,
            resizeHeight: height,
            resizeQuality: 'high',
          });
          return { original: file, working: resized, width: resized.width, height: resized.height };
        } catch {
          // Resize options unsupported: draw the full bitmap onto a canvas instead.
          const canvas = drawToCanvas(full, width, height);
          return { original: file, working: canvas, width, height };
        }
      } finally {
        full.close();
      }
    } catch {
      // fall through to the <img> + canvas decoder
    }
  }
  const canvas = await decodeToCanvas(file, maxLongSide);
  return { original: file, working: canvas, width: canvas.width, height: canvas.height };
}

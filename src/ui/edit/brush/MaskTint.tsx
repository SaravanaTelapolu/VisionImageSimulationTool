import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ImageFrame, MaskShape } from '../../../model/types';
import { greyscaleToTint, maskRectPx } from '../../../render/maskRaster';
import { maskData } from '../../../state/masks';

/** Tint colour and strength of the faint overlay that shows where the mask is painted. */
const TINT: readonly [number, number, number] = [255, 64, 96];
const TINT_ALPHA = 0.4;

/**
 * A faint tinted picture of the selected mask, drawn over the photo so the painted area is visible
 * while editing. It follows maskData, so it updates live during a stroke.
 */
export function MaskTint({ regionId, shape, frame }: { regionId: string; shape: MaskShape; frame: ImageFrame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mask = maskData.value.get(regionId);

  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c || !mask) return;
    if (c.width !== mask.width) c.width = mask.width;
    if (c.height !== mask.height) c.height = mask.height;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(greyscaleToTint(mask.data, TINT, TINT_ALPHA), mask.width, mask.height), 0, 0);
  }, [mask]);

  const rect = maskRectPx(shape, frame);
  return (
    <foreignObject x={rect.x} y={rect.y} width={rect.width} height={rect.height} pointer-events="none">
      <canvas ref={canvas} aria-hidden="true" style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} />
    </foreignObject>
  );
}

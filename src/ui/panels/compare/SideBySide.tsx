import { useSignal } from '@preact/signals';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { image, previewCanvas } from '../../../state/store';
import { fitScale, type Size } from '../../viewport/transform';
import { chooseSideBySideLayout } from './logic';
import { useOriginalCopy, useSimulatedCopy, type DisplaySize } from './useCopies';
import './compare.css';

const PAD = 6;
const GAP = 8;

/**
 * Original and simulated pictures together, replacing the viewport while the Side by side mode is on.
 * Stacked vertically in portrait areas (phones), next to each other in landscape ones.
 */
export function SideBySide() {
  const img = image.value;
  const rootRef = useRef<HTMLDivElement>(null);
  const originalRef = useRef<HTMLCanvasElement>(null);
  const simulatedRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const target = useSignal<DisplaySize | null>(null);
  useOriginalCopy(originalRef, target);
  useSimulatedCopy(simulatedRef, target);

  const layout = chooseSideBySideLayout(box);
  // The picture frame hugs the image, so each label sits on the picture's own corner.
  const cellW = layout === 'stacked' ? box.width - PAD * 2 : (box.width - PAD * 2 - GAP) / 2;
  const cellH = layout === 'stacked' ? (box.height - PAD * 2 - GAP) / 2 : box.height - PAD * 2;
  const k = img ? fitScale({ width: img.width, height: img.height }, { width: cellW, height: cellH }) : 1;
  const frameW = img ? Math.floor(img.width * k) : 0;
  const frameH = img ? Math.floor(img.height * k) : 0;
  useLayoutEffect(() => {
    target.value = frameW > 0 ? { width: frameW, height: frameH } : null;
  }, [frameW, frameH]);
  const frame = img ? { width: `${frameW}px`, height: `${frameH}px` } : undefined;
  const live = previewCanvas.value !== null;

  return (
    <div class="sbs" ref={rootRef} data-layout={layout}>
      <figure class="sbs-cell">
        <div class="sbs-pic" style={frame}>
          <figcaption class="sbs-label">Original</figcaption>
          <canvas ref={originalRef} role="img" aria-label={`Original photo: ${img?.name ?? ''}`} />
        </div>
      </figure>
      <figure class="sbs-cell">
        <div class="sbs-pic" style={frame}>
          <figcaption class="sbs-label sbs-label-sim">Simulated</figcaption>
          <canvas ref={simulatedRef} role="img" aria-label={`Simulated view of ${img?.name ?? ''}`} />
        </div>
        {img && !live && <p class="sbs-note">The simulation is not available here, so this is the original.</p>}
      </figure>
      {!img && <p class="sbs-empty">Open a photo to compare.</p>}
    </div>
  );
}

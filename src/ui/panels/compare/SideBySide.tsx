import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { image, previewCanvas } from '../../../state/store';
import type { Size } from '../../viewport/transform';
import { chooseSideBySideLayout } from './logic';
import { useOriginalCopy, useSimulatedCopy } from './useCopies';
import './compare.css';

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

  useOriginalCopy(originalRef);
  useSimulatedCopy(simulatedRef);

  const layout = chooseSideBySideLayout(box);
  const live = previewCanvas.value !== null;

  return (
    <div class="sbs" ref={rootRef} data-layout={layout}>
      <figure class="sbs-cell">
        <figcaption class="sbs-label">Original</figcaption>
        <div class="sbs-pic">
          <canvas ref={originalRef} role="img" aria-label={`Original photo: ${img?.name ?? ''}`} />
        </div>
      </figure>
      <figure class="sbs-cell">
        <figcaption class="sbs-label sbs-label-sim">Simulated</figcaption>
        <div class="sbs-pic">
          <canvas ref={simulatedRef} role="img" aria-label={`Simulated view of ${img?.name ?? ''}`} />
        </div>
        {img && !live && <p class="sbs-note">The simulation is not available here, so this is the original.</p>}
      </figure>
      {!img && <p class="sbs-empty">Open a photo to compare.</p>}
    </div>
  );
}

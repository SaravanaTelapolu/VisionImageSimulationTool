import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { APPROXIMATION_LINE, buildCaptionLines } from '../../export/caption';
import { image, previewCanvas, profile } from '../../state/store';
import { closePresent, compareMode, wipePos } from '../../state/ui';
import { clampWipe, clipLeft } from '../panels/compare/logic';
import { useOriginalCopy, useSimulatedCopy } from '../panels/compare/useCopies';
import { fitView, viewScale, type Size } from '../viewport/transform';
import { WipeDivider } from '../viewport/WipeDivider';
import { releaseWakeLock, requestWakeLock, type WakeLockHandle } from './wakeLock';
import './present.css';

/** Full-screen presentation of the photo for showing the doctor. Mount it only while it is open. */
export function PresentMode() {
  const img = image.value;
  const rootRef = useRef<HTMLDivElement>(null);
  const originalRef = useRef<HTMLCanvasElement>(null);
  const simulatedRef = useRef<HTMLCanvasElement>(null);
  const enteredFullscreen = useRef(false);

  const [box, setBox] = useState<Size>({ width: window.innerWidth, height: window.innerHeight });
  const [showOriginal, setShowOriginal] = useState(false);
  const [wipe, setWipe] = useState(compareMode.peek() === 'wipe');

  useOriginalCopy(originalRef);
  useSimulatedCopy(simulatedRef);

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

  // Full screen when the browser allows it; the fixed overlay is the fallback. Esc in full screen is
  // consumed by the browser, which reports it as a fullscreenchange.
  useEffect(() => {
    const root = rootRef.current;
    root?.focus();
    const onFsChange = () => {
      if (document.fullscreenElement) enteredFullscreen.current = true;
      else if (enteredFullscreen.current) closePresent();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    try {
      void root?.requestFullscreen?.().catch(() => undefined);
    } catch {
      // not allowed: stay in the overlay
    }
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      if (document.fullscreenElement) {
        try {
          void document.exitFullscreen().catch(() => undefined);
        } catch {
          // already out
        }
      }
    };
  }, []);

  // Keep the screen awake while presenting (and again after the tab was hidden).
  useEffect(() => {
    let lock: WakeLockHandle | null = null;
    let stopped = false;
    const acquire = async () => {
      const got = await requestWakeLock();
      if (stopped) void releaseWakeLock(got);
      else lock = got;
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !lock) void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void releaseWakeLock(lock);
    };
  }, []);

  const toggle = () => setShowOriginal((v) => !v);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePresent();
      } else if (e.key === ' ' || e.code === 'Space') {
        // On a focused button Space means "press it".
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        if (!wipe) toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wipe]);

  // The picture fills the screen (contain), centred.
  const rect = useMemo(() => {
    if (!img) return { left: 0, top: 0, width: box.width, height: box.height, scale: 1 };
    const size = { width: img.width, height: img.height };
    const v = fitView(size, box);
    const scale = viewScale(v, size, box);
    return { left: v.tx, top: v.ty, width: img.width * scale, height: img.height * scale, scale };
  }, [img, box]);

  const live = previewCanvas.value !== null;
  const pos = clampWipe(wipePos.value);
  const clip = wipe ? `inset(0 0 0 ${clipLeft(pos, box.width, rect.left, 1, rect.width)}px)` : undefined;

  const p = profile.value;
  const lines = buildCaptionLines({ date: new Date(), eye: p.eye, viewingDistanceCm: p.viewingDistanceCm });
  const caption = lines[0] ?? '';

  const label = wipe ? null : showOriginal ? 'Original' : 'Simulated';

  return (
    <div
      class="present"
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Presentation"
      tabIndex={-1}
      onClick={() => {
        if (!wipe) toggle();
      }}
    >
      <div
        class="present-pic"
        style={{ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }}
      >
        <canvas ref={originalRef} class="present-canvas" role="img" aria-label={`Original photo: ${img?.name ?? ''}`} />
        <canvas
          ref={simulatedRef}
          class="present-canvas"
          role="img"
          aria-label={`Simulated view of ${img?.name ?? ''}`}
          style={{ visibility: wipe || !showOriginal ? 'visible' : 'hidden', clipPath: clip }}
        />
      </div>

      {wipe && box.width > 0 && (
        <WipeDivider pos={pos} width={box.width} onChange={(v) => (wipePos.value = clampWipe(v))} />
      )}

      {label && (
        <div class="present-badge" aria-live="polite">
          {label}
        </div>
      )}
      {!live && (
        <p class="present-warn" role="status">
          The simulation is not available on this device.
        </p>
      )}

      <div class="present-buttons" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          class="present-btn"
          aria-pressed={wipe}
          onClick={() => setWipe((w) => !w)}
          title={wipe ? 'Back to tap to switch' : 'Wipe between original and simulated'}
        >
          Wipe
        </button>
        <button type="button" class="present-btn present-exit" onClick={closePresent} aria-label="Exit full screen">
          Exit
        </button>
      </div>

      <div class="present-caption">
        <span>{caption}</span>
        <span>{APPROXIMATION_LINE}</span>
        <span class="present-hint">{wipe ? 'Drag the divider.' : 'Tap or press Space to switch.'}</span>
      </div>
    </div>
  );
}

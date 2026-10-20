import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { image, previewCanvas, viewMode } from '../../state/store';
import { compareMode, wipePos } from '../../state/ui';
import { clampWipe, clipLeft } from '../panels/compare/logic';
import { ViewportContext, type ViewportInfo } from './context';
import { FixationCrosshair } from './FixationCrosshair';
import { WipeDivider } from './WipeDivider';
import '../panels/compare/compare.css';
import {
  clampView,
  fitView,
  panBy,
  screenToImage,
  viewScale,
  zoomAbout,
  type Point,
  type Size,
  type View,
} from './transform';

export interface ViewportProps {
  /**
   * Extra overlay content (region outlines, handles, ...), drawn inside an SVG whose user units
   * are image pixels. Use info.px(n) for sizes that must stay constant on screen. Drawn above the
   * fixation crosshair. The SVG ignores pointer events so gestures reach the viewport; give
   * handles style="pointer-events: all" and call stopPropagation() on pointerdown.
   */
  overlay?: (info: ViewportInfo) => ComponentChildren;
}

const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_DIST = 30;
const TAP_MOVE_TOLERANCE = 8;

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The image area: content canvas + SVG overlay, with pinch / wheel zoom and pan.
 * Touch: two fingers pinch and pan. Mouse: wheel zooms, drag pans. Double-tap / double-click resets.
 */
export function Viewport({ overlay }: ViewportProps) {
  const img = image.value;
  const preview = previewCanvas.value;
  const wipe = compareMode.value === 'wipe';
  // In wipe mode the original is always drawn underneath and the simulated layer is clipped over it.
  const showPreview = preview !== null && (wipe || viewMode.value === 'simulated');
  const showOriginal = !showPreview || wipe;

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const [box, setBox] = useState<Size>({ width: 0, height: 0 });
  const [view, setViewState] = useState<View>({ zoom: 1, tx: 0, ty: 0 });

  // Latest values for event handlers (they are attached once).
  const viewRef = useRef(view);
  const boxRef = useRef(box);
  const sizeRef = useRef<Size>({ width: 1, height: 1 });
  sizeRef.current = img ? { width: img.width, height: img.height } : { width: 1, height: 1 };

  const setView = (v: View) => {
    viewRef.current = v;
    setViewState(v);
  };

  // Track the box size.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      if (next.width === boxRef.current.width && next.height === boxRef.current.height) return;
      boxRef.current = next;
      setBox(next);
      setView(clampView(viewRef.current, sizeRef.current, next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // New image: reset the view and draw the plain 2D content.
  useLayoutEffect(() => {
    if (!img) return;
    setView(fitView(sizeRef.current, boxRef.current));
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img.working, 0, 0, img.width, img.height);
  }, [img]);

  // Mount the renderer's canvas (when supplied) into its host element.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (preview) {
      preview.style.width = '100%';
      preview.style.height = '100%';
      preview.style.display = 'block';
      host.replaceChildren(preview);
    } else {
      host.replaceChildren();
    }
  }, [preview, img]);

  // Gestures.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const pts = new Map<number, Point>();
    let tap: { t: number; at: Point; moved: boolean } | null = null;
    let lastTap: { t: number; at: Point } | null = null;

    const local = (e: { clientX: number; clientY: number }): Point => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // pointer may already be gone
      }
      const p = local(e);
      pts.set(e.pointerId, p);
      tap = pts.size === 1 ? { t: performance.now(), at: p, moved: false } : null;
    };

    const onMove = (e: PointerEvent) => {
      const old = pts.get(e.pointerId);
      if (!old) return;
      const p = local(e);
      pts.set(e.pointerId, p);
      const sz = sizeRef.current;
      const bx = boxRef.current;
      if (pts.size === 2) {
        const others = [...pts.entries()].filter(([id]) => id !== e.pointerId);
        const other = others[0]?.[1];
        if (!other) return;
        const midOld = { x: (old.x + other.x) / 2, y: (old.y + other.y) / 2 };
        const midNew = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 };
        const dOld = dist(old, other);
        const dNew = dist(p, other);
        let v = viewRef.current;
        if (dOld > 1) v = zoomAbout(v, sz, bx, dNew / dOld, midOld);
        v = panBy(v, sz, bx, midNew.x - midOld.x, midNew.y - midOld.y);
        setView(v);
      } else if (pts.size === 1) {
        if (tap && dist(p, tap.at) > TAP_MOVE_TOLERANCE) tap.moved = true;
        // A single finger does not pan (later tools use it); mouse and pen drag to pan.
        if (e.pointerType !== 'touch') setView(panBy(viewRef.current, sz, bx, p.x - old.x, p.y - old.y));
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      const p = local(e);
      pts.delete(e.pointerId);
      if (e.type === 'pointerup' && pts.size === 0 && tap && !tap.moved) {
        const now = performance.now();
        if (now - tap.t < DOUBLE_TAP_MS) {
          if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && dist(lastTap.at, p) < DOUBLE_TAP_DIST) {
            setView(fitView(sizeRef.current, boxRef.current));
            lastTap = null;
          } else {
            lastTap = { t: now, at: p };
          }
        }
      }
      if (pts.size === 0) tap = null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const k = e.ctrlKey ? 0.01 : 0.0015; // ctrlKey = trackpad pinch
      const factor = Math.exp(-e.deltaY * unit * k);
      setView(zoomAbout(viewRef.current, sizeRef.current, boxRef.current, factor, local(e)));
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  const info = useMemo<ViewportInfo | null>(() => {
    if (!img || box.width <= 0 || box.height <= 0) return null;
    const imageSize = { width: img.width, height: img.height };
    const scale = viewScale(view, imageSize, box);
    return {
      image: imageSize,
      box,
      view,
      scale,
      px: (n: number) => n / scale,
      clientToImage: (cx: number, cy: number) => {
        const r = rootRef.current?.getBoundingClientRect();
        const p = { x: cx - (r?.left ?? 0), y: cy - (r?.top ?? 0) };
        return screenToImage(viewRef.current, imageSize, boxRef.current, p);
      },
    };
  }, [img, box, view]);

  const scale = info?.scale ?? 1;
  const pos = clampWipe(wipePos.value);
  const previewClip =
    wipe && img ? `inset(0 0 0 ${clipLeft(pos, box.width, view.tx, scale, img.width)}px)` : undefined;
  const contentStyle = img
    ? {
        width: `${img.width}px`,
        height: `${img.height}px`,
        transform: `translate(${view.tx}px, ${view.ty}px) scale(${scale})`,
      }
    : undefined;

  return (
    <div class="viewport" ref={rootRef} data-zoomed={view.zoom > 1.001 ? 'true' : 'false'}>
      {img && (
        <>
          <div class="viewport-content" style={contentStyle}>
            <canvas
              ref={canvasRef}
              class="viewport-canvas"
              style={{ display: showOriginal ? 'block' : 'none' }}
              role="img"
              aria-label={`Photo: ${img.name}`}
            />
            <div
              ref={hostRef}
              class="viewport-preview"
              style={{ display: showPreview ? 'block' : 'none', clipPath: previewClip }}
            />
          </div>
          {info && (
            <svg
              class="viewport-overlay"
              width={box.width}
              height={box.height}
              viewBox={`${-view.tx / scale} ${-view.ty / scale} ${box.width / scale} ${box.height / scale}`}
            >
              <ViewportContext.Provider value={info}>
                <FixationCrosshair />
                {overlay?.(info)}
              </ViewportContext.Provider>
            </svg>
          )}
          {wipe && box.width > 0 && (
            <WipeDivider pos={pos} width={box.width} onChange={(p) => (wipePos.value = clampWipe(p))} />
          )}
        </>
      )}
    </div>
  );
}

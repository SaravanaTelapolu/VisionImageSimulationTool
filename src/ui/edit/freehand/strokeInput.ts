// One-finger stroke input on the viewport, shared by the freehand and brush tools.
//
// The viewport lets a single touch through (it only pans/zooms with two fingers), so a tool just
// listens for the first pointer going down on the bare image. A second finger cancels the stroke
// so pinching still works. Mouse and pen presses are stopped before the viewport sees them, so
// drawing does not also pan the view.
import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import type { Vec2 } from '../../../model/types';
import type { ViewportInfo } from '../../viewport/context';

const activePointers = new Set<number>();
let tracking = false;

function ensureTracking(): void {
  if (tracking || typeof window === 'undefined') return;
  tracking = true;
  const add = (e: PointerEvent) => void activePointers.add(e.pointerId);
  const remove = (e: PointerEvent) => void activePointers.delete(e.pointerId);
  window.addEventListener('pointerdown', add, true);
  window.addEventListener('pointerup', remove, true);
  window.addEventListener('pointercancel', remove, true);
  window.addEventListener('blur', () => activePointers.clear());
}

/** Number of pointers (fingers) currently down anywhere on the page. */
export function activePointerCount(): number {
  ensureTracking();
  return activePointers.size;
}

export interface StrokeHandlers {
  /** First point of a stroke, in image pixels. */
  start(p: Vec2): void;
  /** More points (image px), oldest first. */
  move(points: Vec2[]): void;
  /** The finger was lifted. */
  end(): void;
  /** The stroke was abandoned (second finger, pointercancel, tool switched off). */
  cancel(): void;
}

/**
 * Wires one-finger strokes on the viewport that contains `anchor`. `active` switches it on.
 * Presses that land on SVG overlay content (handles, banners, the crosshair) are ignored.
 */
export function useStrokeInput(
  active: boolean,
  anchor: RefObject<Element>,
  info: () => ViewportInfo,
  handlers: StrokeHandlers,
): void {
  const h = useRef(handlers);
  h.current = handlers;
  const infoRef = useRef(info);
  infoRef.current = info;

  useEffect(() => {
    if (!active) return;
    ensureTracking();
    const root = anchor.current?.closest('.viewport');
    if (!root) return;
    let id: number | null = null;

    const toImage = (e: { clientX: number; clientY: number }): Vec2 => {
      const p = infoRef.current().clientToImage(e.clientX, e.clientY);
      return { x: p.x, y: p.y };
    };

    const abandon = () => {
      if (id === null) return;
      id = null;
      h.current.cancel();
    };

    // Runs (window, capture) before the root's own handler, so a second finger is seen first.
    const onAnyDown = (e: PointerEvent) => {
      if (id !== null && e.pointerId !== id) abandon();
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (id !== null || activePointers.size > 1) return;
      const target = e.target;
      // Overlay content (handles, banner) keeps its own presses; the fixation crosshair does not:
      // while a tool is on, a press there belongs to the tool.
      const onCrosshair = target instanceof Element && target.closest('.fixation') !== null;
      if (target instanceof Element && !onCrosshair && target.closest('svg')) return;
      if (e.pointerType !== 'touch' || onCrosshair) e.stopPropagation();
      id = e.pointerId;
      h.current.start(toImage(e));
    };

    const onMove = (e: PointerEvent) => {
      if (id === null || e.pointerId !== id) return;
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const list = events.length > 0 ? events : [e];
      h.current.move(list.map(toImage));
    };

    const onUp = (e: PointerEvent) => {
      if (id === null || e.pointerId !== id) return;
      id = null;
      if (e.type === 'pointerup') h.current.end();
      else h.current.cancel();
    };

    window.addEventListener('pointerdown', onAnyDown, true);
    root.addEventListener('pointerdown', onDown as EventListener, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      window.removeEventListener('pointerdown', onAnyDown, true);
      root.removeEventListener('pointerdown', onDown as EventListener, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      abandon();
    };
  }, [active]);
}

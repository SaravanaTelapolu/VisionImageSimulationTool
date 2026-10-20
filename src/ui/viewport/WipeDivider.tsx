import { useRef } from 'preact/hooks';
import { wipeAfterKey, wipeFromClientX } from '../panels/compare/logic';

export interface WipeDividerProps {
  /** Divider position, 0..1 of the container width. */
  pos: number;
  /** Container width in CSS pixels (the divider's parent is this wide). */
  width: number;
  onChange: (pos: number) => void;
}

/** Labels are hidden when the divider is this close to an edge, so they never run off screen. */
const LABEL_ROOM = 96;

/**
 * A draggable vertical divider for the before/after wipe. Original is on the left, simulated on the
 * right. Put it inside a positioned container.
 *
 * Only two small things catch pointers, so taps anywhere else reach the photo and its regions:
 * the round 44 px knob (the keyboard-focusable slider) and a narrow strip along the line.
 * Keyboard: arrows move it (Shift = bigger steps), Home / End jump to the ends.
 */
export function WipeDivider({ pos, width, onChange }: WipeDividerProps) {
  const dragging = useRef(false);
  const x = pos * width;

  const moveTo = (e: PointerEvent) => {
    // The knob and the line strip are both children of .wipe, whose parent is the measured container.
    const parent = (e.currentTarget as HTMLElement).parentElement?.parentElement;
    if (!parent) return;
    const r = parent.getBoundingClientRect();
    onChange(wipeFromClientX(e.clientX, r.left, r.width));
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation(); // do not start a pan or a tap on the viewport underneath
    dragging.current = true;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // pointer may already be gone
    }
    moveTo(e);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging.current) return;
    e.stopPropagation();
    moveTo(e);
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging.current) return;
    e.stopPropagation();
    dragging.current = false;
  };
  const onKey = (e: KeyboardEvent) => {
    const next = wipeAfterKey(pos, e.key, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(next);
  };
  const stop = (e: Event) => e.stopPropagation();
  const drag = {
    onPointerDown: onDown,
    onPointerMove: onMove,
    onPointerUp: onUp,
    onPointerCancel: onUp,
    onClick: stop,
  };

  const percent = Math.round(pos * 100);
  return (
    <div class="wipe" style={{ left: `${x}px` }}>
      {x > LABEL_ROOM && <span class="wipe-label wipe-label-left">Original</span>}
      {width - x > LABEL_ROOM && <span class="wipe-label wipe-label-right">Simulated</span>}
      <div class="wipe-line" aria-hidden="true" {...drag} />
      <div
        class="wipe-handle"
        role="slider"
        tabIndex={0}
        aria-label="Wipe divider: original on the left, simulated on the right"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent} percent from the left`}
        onKeyDown={onKey}
        {...drag}
      >
        <span class="wipe-knob" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 7l-5 5 5 5" />
            <path d="M15 7l5 5-5 5" />
          </svg>
        </span>
      </div>
    </div>
  );
}

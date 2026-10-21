import { useRef } from 'preact/hooks';
import { fixation, image } from '../../state/store';
import { useViewport } from './context';

/** Minimum touch target diameter, in screen pixels. */
const HIT_DIAMETER = 48;

/**
 * Draggable fixation marker, drawn inside the viewport's SVG overlay (image coordinates).
 * Works with one finger or the mouse; arrow keys nudge it (Shift = 10 px).
 */
export function FixationCrosshair() {
  const vp = useViewport();
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const img = image.value;
  const f = fixation.value;
  if (!vp || !img) return null;
  const { px } = vp;

  const clampToImage = (x: number, y: number) => ({
    x: Math.min(img.width, Math.max(0, x)),
    y: Math.min(img.height, Math.max(0, y)),
  });

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation(); // keep the viewport from starting a pan / double-tap
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = vp.clientToImage(e.clientX, e.clientY);
    drag.current = { id: e.pointerId, dx: f.x - p.x, dy: f.y - p.y };
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const p = vp.clientToImage(e.clientX, e.clientY);
    fixation.value = clampToImage(p.x + d.dx, p.y + d.dy);
  };

  const onPointerEnd = (e: PointerEvent) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else return;
    e.preventDefault();
    fixation.value = clampToImage(f.x + dx, f.y + dy);
  };

  const arm = px(18);
  const gap = px(5);
  const ring = px(10);
  const lines = (
    <>
      <line x1={f.x - arm} y1={f.y} x2={f.x - gap} y2={f.y} />
      <line x1={f.x + gap} y1={f.y} x2={f.x + arm} y2={f.y} />
      <line x1={f.x} y1={f.y - arm} x2={f.x} y2={f.y - gap} />
      <line x1={f.x} y1={f.y + gap} x2={f.x} y2={f.y + arm} />
      <circle cx={f.x} cy={f.y} r={ring} fill="none" />
    </>
  );

  return (
    <g
      class="fixation"
      role="application"
      aria-label="Fixation point. Drag to move, or use the arrow keys."
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
      style={{ pointerEvents: 'all', cursor: 'grab', touchAction: 'none' }}
    >
      <circle cx={f.x} cy={f.y} r={px(HIT_DIAMETER / 2)} fill="transparent" />
      <g stroke="#000" stroke-width={px(5)} stroke-linecap="round">
        {lines}
      </g>
      <g stroke="#ffd54a" stroke-width={px(2.5)} stroke-linecap="round">
        {lines}
      </g>
    </g>
  );
}

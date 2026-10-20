import { useRef } from 'preact/hooks';
import { toPixel } from '../../../model/coords';
import { updateShape } from '../../../model/ops';
import type { PathShape, Vec2 } from '../../../model/types';
import { applyEdit, endEdit, imageFrame, profile, selectedRegionId } from '../../../state/store';
import type { ViewportInfo } from '../../viewport/context';
import { hitTestAll, pickTapTarget } from '../geometry';
import { dragVertex, handleIndices, handleStep, translatePoints } from './pathGeometry';
import { activePointerCount } from './strokeInput';

const DARK = '#000';
const WHITE = '#fff';

/** Visible handle dot diameter and minimum touch target, in screen pixels. */
const DOT = 14;
const HIT = 44;
/** Finger travel that turns a press on the body into a move, in screen pixels. */
const BODY_DRAG_SLOP = 6;
/** Tiny shapes are tappable as if they were at least this far across, in screen pixels. */
const MIN_TAP_RADIUS = 22;

type Pt = [number, number];

interface PathDrag {
  pointerId: number;
  kind: 'body' | 'vertex';
  regionId: string;
  startPoints: Pt[];
  startImage: Vec2;
  startClient: Vec2;
  index: number;
  step: number;
  moved: boolean;
}

/**
 * Editing handles for the selected freehand outline: drag inside the shape to move it, drag a
 * dot to reshape it. At most ~40 dots are shown (evenly sampled); a sampled dot drags its
 * neighbouring vertices along smoothly.
 */
export function PathEditor({ regionId, shape, info }: { regionId: string; shape: PathShape; info: ViewportInfo }) {
  const frame = imageFrame.value;
  const drag = useRef<PathDrag | null>(null);
  const infoRef = useRef(info);
  infoRef.current = info;
  if (!frame) return null;

  const { px } = info;
  const s = Math.min(frame.width, frame.height);
  const pixelPts = shape.points.map(([x, y]) => toPixel(frame, { x, y }));
  const polygon = pixelPts.map((p) => `${p.x},${p.y}`).join(' ');
  const indices = handleIndices(shape.points.length);
  const step = handleStep(shape.points.length);

  const begin = (kind: 'body' | 'vertex', index: number) => (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (drag.current || activePointerCount() > 1) return; // a second finger belongs to the viewport (pinch)
    e.stopPropagation(); // keep the viewport from panning / counting a double-tap
    e.preventDefault();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // pointer already gone
    }
    const p = infoRef.current.clientToImage(e.clientX, e.clientY);
    drag.current = {
      pointerId: e.pointerId,
      kind,
      regionId,
      startPoints: shape.points.map(([x, y]) => [x, y] as Pt),
      startImage: { x: p.x, y: p.y },
      startClient: { x: e.clientX, y: e.clientY },
      index,
      step,
      moved: false,
    };
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (activePointerCount() > 1) {
      finish(false);
      return;
    }
    if (d.kind === 'body' && !d.moved) {
      if (Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) < BODY_DRAG_SLOP) return;
    }
    d.moved = true;
    const p = infoRef.current.clientToImage(e.clientX, e.clientY);
    const dx = (p.x - d.startImage.x) / s;
    const dy = (p.y - d.startImage.y) / s;
    const points =
      d.kind === 'body' ? translatePoints(d.startPoints, dx, dy) : dragVertex(d.startPoints, d.index, dx, dy, d.step);
    const next: PathShape = { type: 'path', points };
    applyEdit((pr) => updateShape(pr, d.regionId, next), `shape:${d.regionId}`);
  };

  const finish = (tapAt: boolean | { x: number; y: number }) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) endEdit();
    else if (tapAt && typeof tapAt === 'object' && d.kind === 'body') selectAt(tapAt, infoRef.current);
  };

  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    finish(e.type === 'pointerup' ? { x: e.clientX, y: e.clientY } : false);
  };

  const dotR = px(DOT / 2);
  const hitR = px(HIT / 2);
  return (
    <g onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {/* Body: drag to move; a tap falls through to selection. */}
      <polygon
        points={polygon}
        fill="transparent"
        style={{ pointerEvents: 'all', touchAction: 'none', cursor: 'move' }}
        onPointerDown={begin('body', 0)}
      />
      {indices.map((i) => {
        const at = pixelPts[i] as Vec2;
        return (
          <g
            key={i}
            role="application"
            aria-label={`Reshape the outline, point ${i + 1}`}
            style={{ pointerEvents: 'all', touchAction: 'none', cursor: 'grab' }}
            onPointerDown={begin('vertex', i)}
          >
            <circle cx={at.x} cy={at.y} r={hitR} fill="transparent" />
            <circle cx={at.x} cy={at.y} r={dotR} fill={WHITE} stroke={DARK} stroke-width={px(2.5)} />
          </g>
        );
      })}
    </g>
  );
}

/** Tap on a path body: cycle the selection through the shapes under the finger (like ellipses do). */
function selectAt(client: { x: number; y: number }, info: ViewportInfo): void {
  const frame = imageFrame.peek();
  if (!frame) return;
  const p = info.clientToImage(client.x, client.y);
  const hits = hitTestAll(profile.peek().regions, p, frame, info.px(MIN_TAP_RADIUS));
  selectedRegionId.value = pickTapTarget(hits, selectedRegionId.peek());
}

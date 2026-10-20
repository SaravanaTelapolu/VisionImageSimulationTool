import { useEffect, useRef } from 'preact/hooks';
import { lengthToPixels, toPixel } from '../../model/coords';
import { removeRegion, updateShape } from '../../model/ops';
import type { EllipseShape, ImageFrame, Region, Vec2 } from '../../model/types';
import { cancelPlacing, placeShapeAt, placingShape } from '../../state/edit';
import { applyEdit, endEdit, imageFrame, profile, selectedRegionId } from '../../state/store';
import '../../state/masks'; // starts the mask decode/cache sync
import type { ViewportInfo } from '../viewport/context';
import { BrushLayer } from './brush';
import { FreehandLayer, PathEditor } from './freehand';
import {
  dragRadius,
  ellipseAxes,
  ellipseHandles,
  hitTestAll,
  moveEllipse,
  pickTapTarget,
  radiusGrabOffset,
  rotationFromPointer,
  translateEllipse,
} from './geometry';

const DARK = '#000';
const ACCENT = '#ffd54a';
const WHITE = '#fff';
const CYAN = '#4dd0e1';

/** Visible handle dot diameter and minimum touch target, in screen pixels. */
const DOT = 14;
const HIT = 44;
/** Gap between the ellipse's top edge and the rotation handle, in screen pixels. */
const ROTATE_GAP = 36;
/** Tiny ellipses are tappable as if they had at least this radius, in screen pixels. */
const MIN_TAP_RADIUS = 22;
/** Finger travel that turns a press into a drag (body move) or cancels a tap, in screen pixels. */
const BODY_DRAG_SLOP = 6;
const TAP_SLOP = 8;

/** Keyboard nudge, in shorter-side units. */
const NUDGE = 0.005;
const NUDGE_BIG = 0.025;

type DragKind = 'tap' | 'move' | 'rx' | 'ry' | 'rotate';

interface Drag {
  id: number;
  kind: DragKind;
  regionId: string;
  start: EllipseShape | null;
  startClient: Vec2;
  moved: boolean;
  /** move: centre minus pointer (image px). rx / ry: radius minus pointer distance along the axis. */
  grabVec: Vec2;
  grabOffset: number;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isTextTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

function selectedRegion(): Region | undefined {
  const id = selectedRegionId.peek();
  return id === null ? undefined : profile.peek().regions.find((r) => r.id === id);
}

/**
 * Draws every visible region and, for the selected ellipse, its handles. Handles taps (select /
 * deselect / place a new ellipse) and handle drags. Pass it to `<Viewport overlay={...}>`.
 */
export function RegionOverlay({ info }: { info: ViewportInfo }) {
  const frame = imageFrame.value;
  const regions = profile.value.regions;
  const selectedId = selectedRegionId.value;
  const placing = placingShape.value;

  const anchor = useRef<SVGGElement>(null);
  const infoRef = useRef(info);
  infoRef.current = info;
  const drag = useRef<Drag | null>(null);
  const active = useRef(new Set<number>());
  const hasFrame = frame !== null;

  const finishDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.kind !== 'tap') endEdit();
  };

  const handleTap = (client: Vec2) => {
    const f = imageFrame.peek();
    if (!f) return;
    const inf = infoRef.current;
    const p = inf.clientToImage(client.x, client.y);
    if (placingShape.peek()) {
      if (p.x >= 0 && p.y >= 0 && p.x <= f.width && p.y <= f.height) placeShapeAt(p);
      return;
    }
    const hits = hitTestAll(profile.peek().regions, p, f, inf.px(MIN_TAP_RADIUS));
    selectedRegionId.value = pickTapTarget(hits, selectedRegionId.peek());
  };

  // Window-level pointer tracking (capture phase, so it also sees events handles stop). Keeps
  // one gesture at a time and drops it the moment a second pointer goes down (pinch).
  useEffect(() => {
    const onDownCapture = (e: PointerEvent) => {
      active.current.add(e.pointerId);
      const d = drag.current;
      if (d && d.id !== e.pointerId) finishDrag();
    };

    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const client = { x: e.clientX, y: e.clientY };
      if (d.kind === 'tap') {
        if (dist(client, d.startClient) > TAP_SLOP) d.moved = true;
        return;
      }
      const f = imageFrame.peek();
      const start = d.start;
      if (!f || !start) return;
      if (d.kind === 'move' && !d.moved) {
        if (dist(client, d.startClient) < BODY_DRAG_SLOP) return;
      }
      d.moved = true;
      const p = infoRef.current.clientToImage(client.x, client.y);
      let next: EllipseShape;
      switch (d.kind) {
        case 'move':
          next = moveEllipse(start, { x: p.x + d.grabVec.x, y: p.y + d.grabVec.y }, f);
          break;
        case 'rx':
          next = dragRadius(start, 'x', p, f, d.grabOffset);
          break;
        case 'ry':
          next = dragRadius(start, 'y', p, f, d.grabOffset);
          break;
        default:
          next = { ...start, rotation: rotationFromPointer(start, p, f) };
      }
      applyEdit((pr) => updateShape(pr, d.regionId, next), `shape:${d.regionId}`);
    };

    const onUp = (e: PointerEvent) => {
      active.current.delete(e.pointerId);
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const tapped = e.type === 'pointerup' && !d.moved && (d.kind === 'tap' || d.kind === 'move');
      finishDrag();
      if (tapped) handleTap({ x: e.clientX, y: e.clientY });
    };

    const onBlur = () => {
      active.current.clear();
      finishDrag();
    };

    window.addEventListener('pointerdown', onDownCapture, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointerdown', onDownCapture, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('blur', onBlur);
      finishDrag();
    };
  }, []);

  // Taps on the image itself: listen on the viewport root. The SVG ignores pointer events and
  // the fixation marker / handles stop propagation, so only presses on bare image reach it.
  useEffect(() => {
    const root = anchor.current?.closest('.viewport') as HTMLElement | null;
    if (!root) return;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (active.current.size > 1 || drag.current) return;
      // Freehand drawing and brush painting handle their own strokes (see FreehandLayer / BrushLayer).
      const tool = placingShape.peek();
      if (tool === 'path' || tool === 'brush') return;
      drag.current = {
        id: e.pointerId,
        kind: 'tap',
        regionId: '',
        start: null,
        startClient: { x: e.clientX, y: e.clientY },
        moved: false,
        grabVec: { x: 0, y: 0 },
        grabOffset: 0,
      };
    };
    // While placing a spot, the fixation crosshair must not swallow the tap: take the press before it does.
    const onFixationCapture = (e: PointerEvent) => {
      if (placingShape.peek() !== 'ellipse') return;
      if (!(e.target instanceof Element) || !e.target.closest('.fixation')) return;
      e.stopPropagation();
      onDown(e);
    };
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointerdown', onFixationCapture, true);
    return () => {
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointerdown', onFixationCapture, true);
    };
  }, [hasFrame]);

  // Crosshair cursor while placing.
  useEffect(() => {
    if (!placing) return;
    const root = anchor.current?.closest('.viewport') as HTMLElement | null;
    if (!root) return;
    root.style.cursor = 'crosshair';
    return () => {
      root.style.cursor = '';
    };
  }, [placing]);

  // Keyboard (desktop): arrows nudge the selected ellipse, Delete removes, Escape deselects / cancels.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTextTarget(e.target)) return;
      if (!imageFrame.peek()) return;
      if (e.key === 'Escape') {
        if (placingShape.peek()) cancelPlacing();
        else selectedRegionId.value = null;
        return;
      }
      const r = selectedRegion();
      if (!r) return;
      if (e.key === 'Delete') {
        e.preventDefault();
        applyEdit((p) => removeRegion(p, r.id));
        endEdit();
        selectedRegionId.value = null;
        return;
      }
      if (r.shape.type !== 'ellipse') return;
      const step = e.shiftKey ? NUDGE_BIG : NUDGE;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else return;
      e.preventDefault();
      const f = imageFrame.peek();
      if (!f) return;
      const moved = translateEllipse(r.shape, dx, dy);
      if (moved.type === 'ellipse') {
        const c = toPixel(f, { x: moved.cx, y: moved.cy });
        const clamped = moveEllipse(moved, c, f);
        applyEdit((p) => updateShape(p, r.id, clamped), `nudge:${r.id}`);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.startsWith('Arrow')) endEdit();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const begin = (kind: Exclude<DragKind, 'tap'>) => (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (active.current.size > 1 || drag.current) return; // a second finger: leave it to the viewport (pinch)
    const f = imageFrame.peek();
    const r = selectedRegion();
    if (!f || !r || r.shape.type !== 'ellipse') return;
    e.stopPropagation(); // keep the viewport from panning / counting a double-tap
    e.preventDefault();
    const start = r.shape;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // pointer already gone
    }
    const p = infoRef.current.clientToImage(e.clientX, e.clientY);
    const centre = toPixel(f, { x: start.cx, y: start.cy });
    drag.current = {
      id: e.pointerId,
      kind,
      regionId: r.id,
      start,
      startClient: { x: e.clientX, y: e.clientY },
      moved: false,
      grabVec: { x: centre.x - p.x, y: centre.y - p.y },
      grabOffset: kind === 'rx' ? radiusGrabOffset(start, 'x', p, f) : kind === 'ry' ? radiusGrabOffset(start, 'y', p, f) : 0,
    };
  };

  if (!frame) return <g ref={anchor} />;

  const { px } = info;
  const selected = regions.find((r) => r.id === selectedId);
  const ordered = selected ? [...regions.filter((r) => r !== selected), selected] : regions;

  return (
    <g ref={anchor}>
      <g pointer-events="none">
        {ordered.map((r) =>
          r.visible ? <RegionOutline key={r.id} region={r} frame={frame} selected={r === selected} px={px} /> : null,
        )}
      </g>
      {selected && selected.visible && selected.shape.type === 'ellipse' && !placing && (
        <EllipseHandlesView shape={selected.shape} frame={frame} px={px} begin={begin} />
      )}
      {selected && selected.visible && selected.shape.type === 'path' && !placing && (
        <PathEditor regionId={selected.id} shape={selected.shape} info={info} />
      )}
      <BrushLayer info={info} />
      <FreehandLayer info={info} />
      {placing === 'ellipse' && <PlacingBanner info={info} />}
    </g>
  );
}

// --- Outlines -----------------------------------------------------------------------------

function RegionOutline({
  region,
  frame,
  selected,
  px,
}: {
  region: Region;
  frame: ImageFrame;
  selected: boolean;
  px: (n: number) => number;
}) {
  const s = region.shape;
  const dash = s.type === 'full' || s.type === 'mask' ? `${px(9)} ${px(6)}` : undefined;
  const make = (stroke: string, width: number) => {
    const common = {
      fill: 'none',
      stroke,
      'stroke-width': width,
      'stroke-dasharray': dash,
      'stroke-linejoin': 'round' as const,
    };
    switch (s.type) {
      case 'ellipse': {
        const c = toPixel(frame, { x: s.cx, y: s.cy });
        return (
          <ellipse
            cx={c.x}
            cy={c.y}
            rx={lengthToPixels(frame, s.rx)}
            ry={lengthToPixels(frame, s.ry)}
            transform={`rotate(${s.rotation} ${c.x} ${c.y})`}
            {...common}
          />
        );
      }
      case 'path': {
        if (s.points.length < 2) return null;
        const pts = s.points.map(([x, y]) => {
          const q = toPixel(frame, { x, y });
          return `${q.x},${q.y}`;
        });
        return <polygon points={pts.join(' ')} {...common} />;
      }
      case 'mask': {
        const a = toPixel(frame, { x: s.x, y: s.y });
        return (
          <rect x={a.x} y={a.y} width={lengthToPixels(frame, s.width)} height={lengthToPixels(frame, s.height)} {...common} />
        );
      }
      case 'full': {
        const inset = px(4);
        return (
          <rect x={inset} y={inset} width={Math.max(0, frame.width - 2 * inset)} height={Math.max(0, frame.height - 2 * inset)} {...common} />
        );
      }
    }
  };
  const w = selected ? 2.5 : 1.5;
  return (
    <g stroke-linecap="round" opacity={region.visible ? 1 : 0.4}>
      {make(DARK, px(w + 3))}
      {make(selected ? ACCENT : WHITE, px(w))}
    </g>
  );
}

// --- Handles ------------------------------------------------------------------------------

interface HandleProps {
  at: Vec2;
  /** Hit radius in image px. */
  hitR: number;
  dotR: number;
  strokeW: number;
  fill: string;
  label: string;
  cursor: string;
  onPointerDown: (e: PointerEvent) => void;
}

function Handle({ at, hitR, dotR, strokeW, fill, label, cursor, onPointerDown }: HandleProps) {
  return (
    <g
      role="application"
      aria-label={label}
      style={{ pointerEvents: 'all', touchAction: 'none', cursor }}
      onPointerDown={onPointerDown}
    >
      <circle cx={at.x} cy={at.y} r={hitR} fill="transparent" />
      <circle cx={at.x} cy={at.y} r={dotR} fill={fill} stroke={DARK} stroke-width={strokeW} />
    </g>
  );
}

function EllipseHandlesView({
  shape,
  frame,
  px,
  begin,
}: {
  shape: EllipseShape;
  frame: ImageFrame;
  px: (n: number) => number;
  begin: (kind: Exclude<DragKind, 'tap'>) => (e: PointerEvent) => void;
}) {
  const h = ellipseHandles(shape, frame, px(ROTATE_GAP));
  const rxPx = lengthToPixels(frame, shape.rx);
  const ryPx = lengthToPixels(frame, shape.ry);
  const { v } = ellipseAxes(shape.rotation);
  const topEdge = { x: h.center.x - v.x * ryPx, y: h.center.y - v.y * ryPx };
  const dotR = px(DOT / 2);
  const strokeW = px(2.5);
  const full = px(HIT / 2);
  // When the radius handle sits close to the centre, shrink its target so the centre stays reachable.
  const radiusHit = (rPx: number) => Math.min(full, Math.max(px(12), rPx * 0.7));
  const c = shape;
  return (
    <g>
      {/* Body: drag to move; a tap falls through to selection. */}
      <ellipse
        cx={h.center.x}
        cy={h.center.y}
        rx={rxPx}
        ry={ryPx}
        transform={`rotate(${c.rotation} ${h.center.x} ${h.center.y})`}
        fill="transparent"
        style={{ pointerEvents: 'all', touchAction: 'none', cursor: 'move' }}
        onPointerDown={begin('move')}
      />
      <g pointer-events="none">
        <line x1={topEdge.x} y1={topEdge.y} x2={h.rotate.x} y2={h.rotate.y} stroke={DARK} stroke-width={px(5)} stroke-linecap="round" />
        <line x1={topEdge.x} y1={topEdge.y} x2={h.rotate.x} y2={h.rotate.y} stroke={CYAN} stroke-width={px(2)} stroke-linecap="round" />
      </g>
      <Handle at={h.rotate} hitR={full} dotR={dotR} strokeW={strokeW} fill={CYAN} label="Rotate the ellipse" cursor="grab" onPointerDown={begin('rotate')} />
      <Handle at={h.rx} hitR={radiusHit(rxPx)} dotR={dotR} strokeW={strokeW} fill={ACCENT} label="Change the ellipse width" cursor="ew-resize" onPointerDown={begin('rx')} />
      <Handle at={h.ry} hitR={radiusHit(ryPx)} dotR={dotR} strokeW={strokeW} fill={ACCENT} label="Change the ellipse height" cursor="ns-resize" onPointerDown={begin('ry')} />
      <Handle at={h.center} hitR={full} dotR={dotR} strokeW={strokeW} fill={WHITE} label="Move the ellipse" cursor="move" onPointerDown={begin('move')} />
    </g>
  );
}

// --- Placement banner ---------------------------------------------------------------------

function PlacingBanner({ info }: { info: ViewportInfo }) {
  const { px, view, scale, box } = info;
  const visW = box.width / scale;
  const w = Math.min(px(340), visW - px(16));
  const h = px(56);
  const x = -view.tx / scale + (visW - w) / 2;
  const y = -view.ty / scale + px(8);
  const btnW = px(92);
  const btnH = px(44);
  const btnX = x + w - btnW - px(6);
  const btnY = y + (h - btnH) / 2;
  const stop = (e: Event) => e.stopPropagation();
  const cancel = () => cancelPlacing();
  return (
    <g role="status" style={{ pointerEvents: 'all' }} onPointerDown={stop}>
      <rect x={x} y={y} width={w} height={h} rx={px(10)} fill="#14141a" stroke={ACCENT} stroke-width={px(2)} />
      <text
        x={x + px(14)}
        y={y + h / 2}
        dominant-baseline="central"
        fill={WHITE}
        font-size={px(16)}
        font-weight="600"
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        pointer-events="none"
        style={{ userSelect: 'none' }}
      >
        Tap where the spot is
      </text>
      <g
        role="button"
        tabIndex={0}
        aria-label="Cancel placing"
        style={{ cursor: 'pointer', touchAction: 'none' }}
        onClick={cancel}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            cancel();
          }
        }}
      >
        <rect x={btnX} y={btnY} width={btnW} height={btnH} rx={px(8)} fill={ACCENT} stroke={DARK} stroke-width={px(2)} />
        <text
          x={btnX + btnW / 2}
          y={btnY + btnH / 2}
          text-anchor="middle"
          dominant-baseline="central"
          fill="#000"
          font-size={px(16)}
          font-weight="700"
          font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
          pointer-events="none"
          style={{ userSelect: 'none' }}
        >
          Cancel
        </text>
      </g>
    </g>
  );
}

import { signal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { fromPixel } from '../../../model/coords';
import { newRegion } from '../../../model/defaults';
import { addRegion, updateShape } from '../../../model/ops';
import type { Vec2 } from '../../../model/types';
import { finishOutline } from '../../../render/maskRaster';
import { cancelPlacing, placingShape, redrawingPathId } from '../../../state/edit';
import { applyEdit, endEdit, imageFrame, profile, selectedRegionId } from '../../../state/store';
import { nextRegionName } from '../../panels/regions/helpers';
import type { ViewportInfo } from '../../viewport/context';
import { ToolBanner } from './ToolBanner';
import { useStrokeInput } from './strokeInput';

const DARK = '#000';
const ACCENT = '#ffd54a';

/** A new trace point is kept only when the finger moved at least this far, in screen pixels. */
const MIN_STEP = 2;

/** The outline being drawn right now, in image pixels. */
const draft = signal<Vec2[]>([]);
/** Shown in the banner after a trace that could not become an outline. */
const notice = signal('');

export const FREEHAND_HINT = 'Draw around the area';

/**
 * Freehand drawing mode: one finger traces a closed outline; on release it is simplified and added
 * as a 'path' region (or replaces the outline of the path being redrawn). Also draws the hint banner.
 */
export function FreehandLayer({ info }: { info: ViewportInfo }) {
  const active = placingShape.value === 'path';
  const anchor = useRef<SVGGElement>(null);
  const infoRef = useRef(info);
  infoRef.current = info;

  const clamp = (p: Vec2): Vec2 => {
    const { width, height } = infoRef.current.image;
    return { x: Math.min(width, Math.max(0, p.x)), y: Math.min(height, Math.max(0, p.y)) };
  };

  useStrokeInput(active, anchor, () => infoRef.current, {
    start(p) {
      notice.value = '';
      draft.value = [clamp(p)];
    },
    move(points) {
      const minStep = infoRef.current.px(MIN_STEP);
      const cur = draft.peek();
      let last = cur[cur.length - 1];
      const added: Vec2[] = [];
      for (const raw of points) {
        const p = clamp(raw);
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < minStep) continue;
        added.push(p);
        last = p;
      }
      if (added.length > 0) draft.value = [...cur, ...added];
    },
    end() {
      const trace = draft.peek();
      draft.value = [];
      commitOutline(trace);
    },
    cancel() {
      draft.value = [];
    },
  });

  const pts = draft.value;
  const { px } = info;
  return (
    <g ref={anchor}>
      {active && pts.length > 1 && (
        <g pointer-events="none" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <polyline points={polyPoints(pts)} stroke={DARK} stroke-width={px(6)} />
          <polyline points={polyPoints(pts)} stroke={ACCENT} stroke-width={px(3)} />
          {pts.length > 2 && (
            <polyline
              points={polyPoints([pts[pts.length - 1] as Vec2, pts[0] as Vec2])}
              stroke={ACCENT}
              stroke-width={px(2)}
              stroke-dasharray={`${px(6)} ${px(6)}`}
              opacity={0.8}
            />
          )}
        </g>
      )}
      {active && (
        <ToolBanner info={info} text={notice.value || FREEHAND_HINT} buttonLabel="Cancel" onButton={cancelFreehand} />
      )}
    </g>
  );
}

function polyPoints(pts: readonly Vec2[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(' ');
}

function cancelFreehand(): void {
  draft.value = [];
  notice.value = '';
  cancelPlacing();
}

/**
 * Turns a finger trace (image pixels) into a region. Returns the region id, or null when the trace
 * was too short or enclosed no area (drawing mode stays on so the user can try again).
 */
export function commitOutline(trace: readonly Vec2[]): string | null {
  const frame = imageFrame.peek();
  if (!frame) return null;
  const units = trace.map((p) => {
    const u = fromPixel(frame, p);
    return [u.x, u.y] as [number, number];
  });
  const outline = finishOutline(units);
  if (!outline) {
    notice.value = 'Too small - try again';
    return null;
  }
  notice.value = '';
  const redrawId = redrawingPathId.peek();
  let id: string;
  if (redrawId && profile.peek().regions.some((r) => r.id === redrawId && r.shape.type === 'path')) {
    id = redrawId;
    applyEdit((p) => updateShape(p, redrawId, { type: 'path', points: outline }));
  } else {
    const region = newRegion({ type: 'path', points: outline }, nextRegionName(profile.peek(), 'path'));
    id = region.id;
    applyEdit((p) => addRegion(p, region));
  }
  endEdit();
  selectedRegionId.value = id;
  cancelPlacing();
  return id;
}

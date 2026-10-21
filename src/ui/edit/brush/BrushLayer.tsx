import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { updateShape } from '../../../model/ops';
import type { MaskShape, Region, Vec2 } from '../../../model/types';
import { maskRectPx } from '../../../render/maskRaster';
import type { MaskData } from '../../../render/shapeCoverage';
import { brushMode, brushSize, brushSoftness, cancelPlacing, placingShape } from '../../../state/edit';
import { encodeMaskPng, isMaskPending, maskData, primeMaskCache, setLiveMask } from '../../../state/masks';
import { applyEdit, endEdit, imageFrame, profile, selectedRegionId } from '../../../state/store';
import type { ViewportInfo } from '../../viewport/context';
import { ToolBanner } from '../freehand/ToolBanner';
import { useStrokeInput } from '../freehand/strokeInput';
import { createBrushStroke, sameMask, type BrushStroke } from './brushStroke';
import { MaskTint } from './MaskTint';

const DARK = '#000';
const ACCENT = '#ffd54a';

export const BRUSH_HINT = 'Paint with one finger';

/** Where the brush ring is drawn (image px) while a stroke is in progress. */
const cursor = signal<Vec2 | null>(null);

interface Session {
  regionId: string;
  shape: MaskShape;
  original: MaskData;
  buffer: MaskData;
  stroke: BrushStroke;
  raf: number;
}

/** The selected region, if it is a visible mask. */
function selectedMask(regions: readonly Region[], id: string | null): (Region & { shape: MaskShape }) | null {
  if (id === null) return null;
  const r = regions.find((x) => x.id === id);
  return r && r.visible && r.shape.type === 'mask' ? (r as Region & { shape: MaskShape }) : null;
}

/**
 * Brush painting for the selected mask region: a faint tint of the mask while it is selected, and,
 * while the brush is on, one-finger painting (or erasing) with a soft round brush. The preview
 * follows the finger; each stroke is committed as one undo step when the finger lifts.
 */
export function BrushLayer({ info }: { info: ViewportInfo }) {
  const frame = imageFrame.value;
  const regions = profile.value.regions;
  const selected = selectedMask(regions, selectedRegionId.value);
  const painting = placingShape.value === 'brush' && selected !== null && frame !== null;
  const anchor = useRef<SVGGElement>(null);
  const infoRef = useRef(info);
  infoRef.current = info;
  const session = useRef<Session | null>(null);

  // The brush only makes sense on a selected mask: switch it off if the selection moves away.
  useEffect(() => {
    if (placingShape.peek() === 'brush' && selected === null) cancelPlacing();
  }, [selected === null]);

  const flush = () => {
    const s = session.current;
    if (!s) return;
    s.raf = 0;
    setLiveMask(s.regionId, s.buffer);
  };

  const stop = () => {
    const s = session.current;
    if (s?.raf) cancelAnimationFrame(s.raf);
    session.current = null;
    cursor.value = null;
    return s;
  };

  useStrokeInput(painting, anchor, () => infoRef.current, {
    start(p) {
      const f = imageFrame.peek();
      const region = selectedMask(profile.peek().regions, selectedRegionId.peek());
      const current = region && !isMaskPending(region.shape.dataUrl) ? maskData.peek().get(region.id) : undefined;
      if (!f || !region || !current) return; // still decoding, or nothing selected: ignore this stroke
      const buffer: MaskData = { width: current.width, height: current.height, data: current.data.slice() };
      const diameter = brushSize.peek() * Math.min(f.width, f.height);
      session.current = {
        regionId: region.id,
        shape: region.shape,
        original: current,
        buffer,
        stroke: createBrushStroke({
          mask: buffer,
          rect: maskRectPx(region.shape, f),
          diameter,
          softness: brushSoftness.peek(),
          mode: brushMode.peek(),
        }),
        raf: 0,
      };
      session.current.stroke.add(p);
      cursor.value = p;
      session.current.raf = requestAnimationFrame(flush);
    },
    move(points) {
      const s = session.current;
      if (!s) return;
      for (const p of points) s.stroke.add(p);
      const last = points[points.length - 1];
      if (last) cursor.value = last;
      if (!s.raf) s.raf = requestAnimationFrame(flush);
    },
    end() {
      const s = stop();
      if (!s) return;
      commitStroke(s);
    },
    cancel() {
      const s = stop();
      if (s) setLiveMask(s.regionId, s.original); // a stray touch that turned into a pinch: undo the dab
    },
  });

  const { px } = info;
  const ring = cursor.value;
  const radius = frame ? (brushSize.value * Math.min(frame.width, frame.height)) / 2 : 0;
  return (
    <g ref={anchor}>
      {selected && frame && <MaskTint regionId={selected.id} shape={selected.shape} frame={frame} />}
      {painting && ring && (
        <g pointer-events="none" fill="none">
          <circle cx={ring.x} cy={ring.y} r={radius} stroke={DARK} stroke-width={px(3)} />
          <circle cx={ring.x} cy={ring.y} r={radius} stroke={brushMode.value === 'paint' ? ACCENT : '#fff'} stroke-width={px(1.5)} />
        </g>
      )}
      {painting && <ToolBanner info={info} text={BRUSH_HINT} buttonLabel="Done" onButton={cancelPlacing} />}
    </g>
  );
}

/** Encodes the painted buffer and records the stroke as a single undo step. */
function commitStroke(s: Session): void {
  setLiveMask(s.regionId, s.buffer);
  if (sameMask(s.original, s.buffer)) return; // nothing changed (for example erasing blank space)
  const dataUrl = encodeMaskPng(s.buffer);
  if (!dataUrl) return;
  // The buffer is never touched again (the next stroke paints into a fresh copy), so the cache can
  // hold it directly; maskData already points at it, so the profile change publishes nothing new.
  primeMaskCache(dataUrl, s.buffer);
  const current = profile.peek().regions.find((r) => r.id === s.regionId);
  if (!current || current.shape.type !== 'mask') return;
  const next: MaskShape = { ...current.shape, dataUrl };
  applyEdit((p) => updateShape(p, s.regionId, next), `mask:${s.regionId}`);
  endEdit();
}

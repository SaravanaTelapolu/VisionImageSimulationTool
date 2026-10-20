import { Segmented, Slider } from '../../controls';
import {
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
  brushMode,
  brushSize,
  brushSoftness,
  cancelPlacing,
  placingShape,
  startPlacing,
  type BrushMode,
} from '../../../state/edit';
import './brush.css';

const MODES = [
  { value: 'paint', label: 'Paint' },
  { value: 'erase', label: 'Erase' },
] as const;

/**
 * Brush controls for the selected mask region (shown in the Regions panel): Paint / Erase,
 * brush size, softness and Done. When the brush is off it offers to switch it back on.
 */
export function BrushToolbar() {
  const on = placingShape.value === 'brush';
  if (!on) {
    return (
      <div class="tool-box" role="group" aria-label="Brush">
        <p class="tool-box-note">This area is painted with a brush. Its coloured tint shows where it applies.</p>
        <button type="button" class="btn" onClick={() => startPlacing('brush')}>
          Paint or erase
        </button>
      </div>
    );
  }
  return (
    <div class="tool-box" role="group" aria-label="Brush tools">
      <Segmented<BrushMode> label="Brush" value={brushMode.value} options={MODES} onChange={(m) => (brushMode.value = m)} />
      <Slider
        label="Brush size"
        value={brushSize.value}
        min={BRUSH_SIZE_MIN}
        max={BRUSH_SIZE_MAX}
        step={0.005}
        scale={100}
        unit="%"
        noReset
        help="Width of the brush as a share of the photo's shorter side."
        onInput={(v) => (brushSize.value = v)}
      />
      <Slider
        label="Softness"
        value={brushSoftness.value}
        min={0}
        max={1}
        step={0.05}
        scale={100}
        unit="%"
        noReset
        onInput={(v) => (brushSoftness.value = v)}
      />
      <button type="button" class="btn" onClick={cancelPlacing}>
        Done
      </button>
    </div>
  );
}

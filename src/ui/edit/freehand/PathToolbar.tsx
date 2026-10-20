import { placingShape, redrawingPathId, startRedrawing } from '../../../state/edit';
import '../brush/brush.css';

/** Shown in the Regions panel when a freehand region is selected: how to edit it, and Redraw. */
export function PathToolbar({ regionId }: { regionId: string }) {
  const redrawing = placingShape.value === 'path' && redrawingPathId.value === regionId;
  return (
    <div class="tool-box" role="group" aria-label="Freehand outline">
      <p class="tool-box-note">Drag inside the shape to move it. Drag the white dots to reshape it.</p>
      <button type="button" class="btn" disabled={redrawing} onClick={() => startRedrawing(regionId)}>
        {redrawing ? 'Draw the new outline...' : 'Redraw outline'}
      </button>
    </div>
  );
}

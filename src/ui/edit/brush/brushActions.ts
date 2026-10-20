import { newRegion } from '../../../model/defaults';
import { addRegion } from '../../../model/ops';
import { maskSizeFor, wholeImageMaskRect } from '../../../render/maskRaster';
import { startPlacing } from '../../../state/edit';
import { encodeMaskPng, primeMaskCache } from '../../../state/masks';
import { applyEdit, endEdit, imageFrame, profile, selectedRegionId } from '../../../state/store';
import { nextRegionName } from '../../panels/regions/helpers';

/**
 * Adds an empty brush-mask region covering the whole image (at most 512 px on the long side,
 * with the image's aspect), selects it and switches the brush on. Returns its id, or null when
 * no photo is loaded or the browser cannot encode PNGs.
 */
export function addBrushRegion(): string | null {
  const frame = imageFrame.peek();
  if (!frame) return null;
  const { width, height } = maskSizeFor(frame.width, frame.height);
  const blank = { width, height, data: new Uint8Array(width * height) };
  const dataUrl = encodeMaskPng(blank);
  if (!dataUrl) return null;
  primeMaskCache(dataUrl, blank);
  const region = newRegion(
    { type: 'mask', dataUrl, ...wholeImageMaskRect(frame) },
    nextRegionName(profile.peek(), 'mask'),
  );
  applyEdit((p) => addRegion(p, region));
  endEdit();
  selectedRegionId.value = region.id;
  startPlacing('brush');
  return region.id;
}

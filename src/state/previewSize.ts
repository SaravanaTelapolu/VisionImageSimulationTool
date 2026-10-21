// Live preview resolution (H3). The simulated picture is compared with the original (flip, wipe,
// side by side, present), so it must never be shown at a lower resolution than the original. The
// preview source is sized to what is actually displayed, in device pixels, instead of a fixed
// 1024 px: min(cap, working image, GPU limit, displayed size), rounded up to steps so small zoom
// changes do not re-upload the image, with hysteresis so it does not flap.

/** Upper bound of the live preview's long side (the working image is at most 2048 px anyway). */
export const PREVIEW_CAP_SIDE = 2048;
/** Long side used before any view has reported its displayed size. */
export const PREVIEW_DEFAULT_SIDE = 1024;
/** Smallest preview long side (tiny views still get a usable picture for copies). */
export const PREVIEW_MIN_SIDE = 512;
/** Wanted sizes are rounded up to a multiple of this. */
export const PREVIEW_STEP = 256;
/** When the wanted size is at least this fraction of the limit, use the limit (the full working image). */
export const PREVIEW_SNAP_FRACTION = 0.8;
/** Shrink only when the new size is below this fraction of the current one. */
export const PREVIEW_SHRINK_FRACTION = 0.7;

export interface PreviewSideInput {
  /** Largest displayed long side of the whole image, in device pixels, over all views; null if unknown. */
  wanted: number | null;
  /** Long side of the current preview source, or null when there is none (new image). */
  current: number | null;
  /** Long side of the working image. */
  imageLong: number;
  /** Largest side the GPU can handle. */
  gpuMax: number;
  /** Defaults to PREVIEW_CAP_SIDE. */
  cap?: number;
}

/** Long side the live preview source should have. Pure; see the module comment. */
export function choosePreviewLongSide(input: PreviewSideInput): number {
  const imageLong = Math.max(1, Math.round(input.imageLong));
  const gpuMax = input.gpuMax > 0 ? input.gpuMax : Number.POSITIVE_INFINITY;
  const cap = input.cap && input.cap > 0 ? input.cap : PREVIEW_CAP_SIDE;
  const limit = Math.max(1, Math.floor(Math.min(imageLong, gpuMax, cap)));

  let target: number;
  const wanted = input.wanted;
  if (wanted === null || !Number.isFinite(wanted) || wanted <= 0) {
    target = Math.min(limit, PREVIEW_DEFAULT_SIDE);
  } else {
    const stepped = Math.max(PREVIEW_MIN_SIDE, Math.ceil(wanted / PREVIEW_STEP) * PREVIEW_STEP);
    target = stepped >= limit * PREVIEW_SNAP_FRACTION ? limit : stepped;
  }
  target = Math.min(target, limit);

  const current = input.current;
  if (current === null || !(current > 0) || current > limit) return target;
  if (target > current) return target; // grow at once: sharpness matters more than one re-upload
  if (target >= current * PREVIEW_SHRINK_FRACTION) return current; // small shrink: keep (hysteresis)
  return target;
}

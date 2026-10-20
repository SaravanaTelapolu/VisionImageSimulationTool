// Pure maths for the WebGL renderer. No WebGL here, so everything is unit-tested in Node.
import { BLUR_REFERENCE_SHORT_SIDE, MAX_BLUR_PX } from '../../model/types';
import type { RenderParams, SizeChangeLens } from '../types';

/**
 * Blur pyramid levels, as Gaussian standard deviations in reference pixels
 * (pixels at BLUR_REFERENCE_SHORT_SIDE). Level 0 is the untouched source.
 */
export const BLUR_LEVELS_REF: readonly number[] = [0, 2.5, 5, 10, 20, MAX_BLUR_PX];

/** Pyramid level used as the "local mean" for contrast loss. */
export const CONTRAST_MEAN_LEVEL = 4;

/** Missing-area (fill-in) scales: Gaussian sigmas in reference pixels, fine to coarse. */
export const FILL_SIGMAS_REF: readonly number[] = [6, 20, 64];

/** Fill-in maps are computed at this many texels along the image's shorter side. */
export const FILL_SHORT_SIDE_TEXELS = 128;

/** Max number of merged (bilinear) tap pairs per side in the separable blur shader. */
export const MAX_KERNEL_PAIRS = 32;

/** Long-side cap for full-size export, even if the GPU allows more (memory on phones). */
export const EXPORT_MAX_SIDE = 4096;

/** Pixel scale: how many output pixels one reference pixel covers. */
export function pixelScale(width: number, height: number): number {
  const s = Math.min(width, height);
  return s > 0 ? s / BLUR_REFERENCE_SHORT_SIDE : 0;
}

/** Normalised 1-D Gaussian weights g[0..radius] (g[0] is the centre; the kernel is symmetric). */
export function gaussianWeights(sigma: number, radius = Math.ceil(3 * sigma)): number[] {
  if (!(sigma > 0) || radius < 1) return [1];
  const raw: number[] = [];
  for (let i = 0; i <= radius; i++) raw.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  let sum = raw[0] ?? 0;
  for (let i = 1; i <= radius; i++) sum += 2 * (raw[i] ?? 0);
  return raw.map((w) => w / sum);
}

export interface LinearKernel {
  /** Weight of the centre tap. */
  centre: number;
  /** Offsets (in input texels) of the merged taps; each is sampled at +offset and -offset. */
  offsets: number[];
  /** Weight of each merged tap (applied to both sides). */
  weights: number[];
}

/**
 * Gaussian kernel for the "linear sampling" trick: two neighbouring taps are merged into one
 * bilinear fetch at their weighted mean position. Very small sigmas become the identity.
 * The radius is capped at 2 * MAX_KERNEL_PAIRS texels (the kernel is renormalised).
 */
export function linearKernel(sigma: number, maxPairs = MAX_KERNEL_PAIRS): LinearKernel {
  if (!(sigma > 0.3)) return { centre: 1, offsets: [], weights: [] };
  const radius = Math.min(Math.ceil(3 * sigma), 2 * maxPairs);
  const g = gaussianWeights(sigma, radius);
  const offsets: number[] = [];
  const weights: number[] = [];
  for (let k = 1; k <= radius; k += 2) {
    const w1 = g[k] ?? 0;
    const w2 = g[k + 1] ?? 0;
    const w = w1 + w2;
    if (w <= 0) continue;
    offsets.push((k * w1 + (k + 1) * w2) / w);
    weights.push(w);
  }
  return { centre: g[0] ?? 1, offsets, weights };
}

/** Sigma that, applied after a blur of `from`, gives a total blur of `to` (Gaussians add in quadrature). */
export function incrementalSigma(from: number, to: number): number {
  return Math.sqrt(Math.max(0, to * to - from * from));
}

/**
 * Per-level mix weights for a blur value (reference px). The value is clamped to the level range
 * and split between the two nearest levels; weights sum to 1.
 */
export function levelWeights(blurRef: number, levels: readonly number[] = BLUR_LEVELS_REF): number[] {
  const w = levels.map(() => 0);
  const n = levels.length;
  if (n === 0) return w;
  const first = levels[0] ?? 0;
  const last = levels[n - 1] ?? 0;
  const b = Math.min(Math.max(Number.isFinite(blurRef) ? blurRef : 0, first), last);
  for (let i = 0; i < n - 1; i++) {
    const lo = levels[i] ?? 0;
    const hi = levels[i + 1] ?? 0;
    if (b <= hi) {
      const t = hi > lo ? (b - lo) / (hi - lo) : 0;
      w[i] = 1 - t;
      w[i + 1] = t;
      return w;
    }
  }
  w[n - 1] = 1;
  return w;
}

/**
 * Downscale factor (power of two) for a pyramid level with the given sigma in output pixels:
 * as small as possible while the level's sigma stays >= `minTexelSigma` texels, so bilinear
 * upsampling of the level stays smooth. Never shrinks the short side below `minShort` texels.
 */
export function levelFactor(sigmaPx: number, shortSide: number, minTexelSigma = 4, minShort = 8): number {
  let f = 1;
  while (sigmaPx / (f * 2) >= minTexelSigma && shortSide / (f * 2) >= minShort) f *= 2;
  return f;
}

export interface PyramidLevelPlan {
  /** Sigma in output pixels. */
  sigmaPx: number;
  /** Downscale factor relative to the source. */
  factor: number;
  width: number;
  height: number;
  /** Sigma to add on top of the previous level, in output pixels. */
  incrementPx: number;
}

/** Plans the blur pyramid for an image: each level is built from the previous one. */
export function planPyramid(
  width: number,
  height: number,
  levels: readonly number[] = BLUR_LEVELS_REF,
): PyramidLevelPlan[] {
  const scale = pixelScale(width, height);
  const short = Math.min(width, height);
  const plan: PyramidLevelPlan[] = [];
  let prevSigma = 0;
  let prevFactor = 1;
  for (const ref of levels) {
    const sigmaPx = ref * scale;
    const factor = Math.max(prevFactor, levelFactor(sigmaPx, short));
    plan.push({
      sigmaPx,
      factor,
      width: Math.max(1, Math.round(width / factor)),
      height: Math.max(1, Math.round(height / factor)),
      incrementPx: incrementalSigma(prevSigma, sigmaPx),
    });
    prevSigma = sigmaPx;
    prevFactor = factor;
  }
  return plan;
}

/**
 * Lens weight from the normalised elliptical radius r (1 = on the ellipse) and feather (0..1,
 * fraction of the size): 1 inside 1 - feather, smoothly to 0 at the edge, 0 outside.
 */
export function lensWeight(r: number, feather: number): number {
  if (!(r < 1)) return 0;
  const f = Math.min(Math.max(feather, 0), 1);
  const inner = 1 - f;
  if (r <= inner || f <= 1e-4) return 1;
  const t = (1 - r) / f; // 0 at the edge, 1 at the inner radius
  return t * t * (3 - 2 * t);
}

/** Normalised elliptical radius of point (x, y) for a lens (rotation is clockwise on screen, +y down). */
export function lensRadius(lens: SizeChangeLens, x: number, y: number): number {
  const dx = x - lens.cx;
  const dy = y - lens.cy;
  const c = Math.cos(lens.rotation);
  const s = Math.sin(lens.rotation);
  const u = (c * dx + s * dy) / Math.max(lens.rx, 1e-6);
  const v = (-s * dx + c * dy) / Math.max(lens.ry, 1e-6);
  return Math.hypot(u, v);
}

/**
 * Where an output pixel samples the image under one size-change lens:
 * centre + (p - centre) / (1 + amount * weight). Positive amounts enlarge.
 */
export function lensSample(lens: SizeChangeLens, x: number, y: number): { x: number; y: number } {
  const w = lensWeight(lensRadius(lens, x, y), lens.feather);
  const k = 1 + lens.amount * w;
  return { x: lens.cx + (x - lens.cx) / k, y: lens.cy + (y - lens.cy) / k };
}

/** Unit vector for a direction in degrees, clockwise on screen (+y down). */
export function directionVector(angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

export interface FitResult {
  width: number;
  height: number;
  /** Output / input size ratio (1 when nothing changed). */
  scale: number;
  downscaled: boolean;
}

/** Fits (width, height) so neither side exceeds maxSide, keeping the aspect ratio; never upscales. */
export function fitToMaxSide(width: number, height: number, maxSide: number): FitResult {
  const long = Math.max(width, height);
  if (!(long > maxSide) || !(maxSide > 0)) return { width, height, scale: 1, downscaled: false };
  const scale = maxSide / long;
  return {
    width: Math.max(1, Math.min(maxSide, Math.round(width * scale))),
    height: Math.max(1, Math.min(maxSide, Math.round(height * scale))),
    scale,
    downscaled: true,
  };
}

/**
 * Scales the pixel-space parts of RenderParams (fixation and lenses) by sx, sy. Maps and globals
 * are resolution-independent and pass through. Useful to turn preview params into export params.
 */
export function scaleRenderParams(params: RenderParams, sx: number, sy = sx): RenderParams {
  const sr = Math.sqrt(Math.abs(sx * sy));
  return {
    ...params,
    fixation: { x: params.fixation.x * sx, y: params.fixation.y * sy },
    lenses: params.lenses.map((l) => ({
      ...l,
      cx: l.cx * sx,
      cy: l.cy * sy,
      // Non-uniform scaling of a rotated ellipse is not an ellipse; aspect-preserving scales are exact.
      rx: l.rx * sr,
      ry: l.ry * sr,
    })),
  };
}

/** True if any byte of the given channel (0..3) of an RGBA8 array is non-zero. */
export function channelHasAny(data: Uint8Array, channel: number): boolean {
  for (let i = channel; i < data.length; i += 4) if (data[i] !== 0) return true;
  return false;
}

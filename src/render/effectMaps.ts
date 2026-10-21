// CPU rasteriser: turns visible regions into the three RGBA8 effect maps read by the shaders.
// Pure TypeScript (no DOM/canvas) so it runs in Node tests and in a Web Worker.
import { EFFECT_MAP_A, EFFECT_MAP_B, MAX_BLUR_PX, type EffectKey, type ImageFrame, type Region } from '../model/types';
import type { EffectMaps } from './types';
import { clamp01, createCoverageSampler, type MaskData } from './shapeCoverage';

export type { MaskData } from './shapeCoverage';

/** Map size for an image: aspect ratio kept, longer side at most maxSide, never larger than the image. */
export function mapSizeFor(imageWidth: number, imageHeight: number, maxSide = 512): { width: number; height: number } {
  const w = Math.max(1, Math.floor(imageWidth));
  const h = Math.max(1, Math.floor(imageHeight));
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Strength 0..1 stored for one effect (blur is normalised by MAX_BLUR_PX). */
function strengthOf(region: Region, key: EffectKey): number {
  const v = region.effects[key];
  return clamp01(key === 'blur' ? v / MAX_BLUR_PX : v);
}

/** Index of darkSpot in the combined A+B channel list (its value lives in B.r). */
const KEYS: readonly EffectKey[] = [...EFFECT_MAP_A, ...EFFECT_MAP_B];
const DARK_CHANNEL = KEYS.indexOf('darkSpot');

/** A region's dark-spot shade as stored in map C (0 = black .. 255 = mid grey). */
export function shadeByte(region: Region): number {
  return Math.round(clamp01(region.darkSpotShade) * 255);
}

/**
 * Rasterises regions into effect maps. Value = clamp(strength, 0, 1) * coverage, stored as round(v * 255);
 * overlapping regions combine per channel with max. Hidden regions and regions with no non-zero map effect
 * are skipped (sizeChange is not in the maps).
 *
 * Map C (D05): C.r is the shade of the region whose dark spot is strongest at that texel (ties: the darker
 * shade). Texels without any dark spot then take the shade of their strongest neighbouring dark-spot texel
 * (a 1-texel dilation), so linear filtering on the GPU does not pull a grey spot's edge towards black.
 */
export function buildEffectMaps(
  regions: Region[],
  frame: ImageFrame,
  mapWidth: number,
  mapHeight: number,
  masks?: Map<string, MaskData>,
): EffectMaps {
  const width = Math.max(1, Math.floor(mapWidth));
  const height = Math.max(1, Math.floor(mapHeight));
  const a = new Uint8Array(width * height * 4);
  const b = new Uint8Array(width * height * 4);
  const c = new Uint8Array(width * height * 4);
  const maps: EffectMaps = { width, height, a, b, c };
  let greySpots = false;
  // Bounding box of texels with a dark spot (for the dilation pass).
  let bx0 = width;
  let by0 = height;
  let bx1 = -1;
  let by1 = -1;

  const span = new Int32Array(2);

  for (const region of regions) {
    if (!region.visible) continue;
    // Only the channels with a non-zero strength are written.
    const channels: number[] = [];
    const levels: number[] = [];
    KEYS.forEach((key, channel) => {
      const strength = strengthOf(region, key);
      if (strength > 0) {
        channels.push(channel);
        levels.push(strength * 255);
      }
    });
    const count = channels.length;
    if (count === 0) continue;
    const sampler = createCoverageSampler(region.shape, region.feather, frame, width, height, masks?.get(region.id));
    if (!sampler) continue;
    const shade = shadeByte(region);
    if (shade > 0 && region.effects.darkSpot > 0) greySpots = true;

    for (let j = sampler.y0; j <= sampler.y1; j++) {
      let i0 = sampler.x0;
      let i1 = sampler.x1;
      if (sampler.rowSpan) {
        if (!sampler.rowSpan(j, span)) continue;
        i0 = span[0]!;
        i1 = span[1]!;
      }
      for (let i = i0; i <= i1; i++) {
        const cov = sampler.sample(i, j);
        if (cov <= 0) continue;
        const o = (j * width + i) * 4;
        for (let k = 0; k < count; k++) {
          const channel = channels[k]!;
          const level = levels[k]!;
          const val = cov >= 1 ? Math.round(level) : Math.round(level * cov);
          const target = channel < 4 ? a : b;
          const idx = o + (channel & 3);
          const cur = target[idx]!;
          if (channel === DARK_CHANNEL && val > 0) {
            if (i < bx0) bx0 = i;
            if (i > bx1) bx1 = i;
            if (j < by0) by0 = j;
            if (j > by1) by1 = j;
            // The strongest dark spot sets the shade; on a tie the darker shade wins.
            if (val > cur) c[o] = shade;
            else if (val === cur && shade < c[o]!) c[o] = shade;
          }
          if (val > cur) target[idx] = val;
        }
      }
    }
  }
  if (greySpots && bx1 >= 0) dilateShade(b, c, width, height, bx0 - 1, by0 - 1, bx1 + 1, by1 + 1);
  return maps;
}

/**
 * For texels without a dark spot (B.r = 0), copies C.r from the 8-neighbour with the strongest dark
 * spot (ties: darker), within the given texel box. Reads only texels with B.r > 0, which it never
 * writes, so it works in place.
 */
export function dilateShade(
  b: Uint8Array,
  c: Uint8Array,
  width: number,
  height: number,
  x0 = 0,
  y0 = 0,
  x1 = width - 1,
  y1 = height - 1,
): void {
  for (let j = Math.max(0, y0); j <= Math.min(height - 1, y1); j++) {
    for (let i = Math.max(0, x0); i <= Math.min(width - 1, x1); i++) {
      const o = (j * width + i) * 4;
      if (b[o] !== 0) continue;
      let best = 0;
      let shade = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const y = j + dj;
        if (y < 0 || y >= height) continue;
        for (let di = -1; di <= 1; di++) {
          const x = i + di;
          if ((di === 0 && dj === 0) || x < 0 || x >= width) continue;
          const n = (y * width + x) * 4;
          const v = b[n]!;
          if (v === 0) continue;
          const s = c[n]!;
          if (v > best || (v === best && s < shade)) {
            best = v;
            shade = s;
          }
        }
      }
      if (best > 0) c[o] = shade;
    }
  }
}

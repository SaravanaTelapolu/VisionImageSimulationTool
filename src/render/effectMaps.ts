// CPU rasteriser: turns visible regions into the two RGBA8 effect maps read by the shaders.
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

/**
 * Rasterises regions into effect maps. Value = clamp(strength, 0, 1) * coverage, stored as round(v * 255);
 * overlapping regions combine per channel with max. Hidden regions and regions with no non-zero map effect
 * are skipped (sizeChange is not in the maps).
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
  const maps: EffectMaps = { width, height, a, b };
  const keys = [...EFFECT_MAP_A, ...EFFECT_MAP_B];

  const span = new Int32Array(2);

  for (const region of regions) {
    if (!region.visible) continue;
    // Only the channels with a non-zero strength are written.
    const channels: number[] = [];
    const levels: number[] = [];
    keys.forEach((key, channel) => {
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
          if (val > target[idx]!) target[idx] = val;
        }
      }
    }
  }
  return maps;
}

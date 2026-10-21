// Pure helpers for the live preview and export: preview sizing, frame scaling, render params and
// map memoisation. No DOM or WebGL here, so everything is unit-tested in Node.
import type { ImageFrame, Profile, Region, Vec2 } from '../../model/types';
import { buildEffectMaps, mapSizeFor, type MaskData } from '../../render/effectMaps';
import { collectLenses } from '../../render/lenses';
import type { EffectMaps, RenderParams } from '../../render/types';

/** Long side of the live preview source, in pixels (plan: "the preview renders at up to 1024 px"). */
export const PREVIEW_MAX_SIDE = 1024;
/** Long side of the effect maps used for the live preview. */
export const PREVIEW_MAP_MAX_SIDE = 512;
/** Long side of the effect maps used for full-size export and other one-off renders. */
export const EXPORT_MAP_MAX_SIDE = 1024;

export interface Size {
  width: number;
  height: number;
}

/** Preview size for an image: aspect kept, long side at most maxSide, never upscaled, whole pixels >= 1. */
export function previewSizeFor(width: number, height: number, maxSide = PREVIEW_MAX_SIDE): Size {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const long = Math.max(w, h);
  if (!(maxSide > 0) || long <= maxSide) return { width: w, height: h };
  const s = maxSide / long;
  return {
    width: Math.max(1, Math.min(maxSide, Math.round(w * s))),
    height: Math.max(1, Math.min(maxSide, Math.round(h * s))),
  };
}

/** Scales a point from an image of size `from` to the same point in the image of size `to`. */
export function scalePoint(p: Vec2, from: Size, to: Size): Vec2 {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return { x: p.x * sx, y: p.y * sy };
}

/** The frame of `to` with the fixation point carried over from an image of size `from`. */
export function scaleFrame(fixation: Vec2, from: Size, to: Size): ImageFrame {
  return { width: to.width, height: to.height, fixation: scalePoint(fixation, from, to) };
}

/** Builds full render params for a profile on a frame. `maps` may be passed in when already built. */
export function buildRenderParams(
  profile: Profile,
  frame: ImageFrame,
  maps: EffectMaps,
): RenderParams {
  return {
    maps,
    globals: profile.globals,
    lenses: collectLenses(profile.regions, frame),
    fixation: { x: frame.fixation.x, y: frame.fixation.y },
  };
}

/** Builds effect maps for a frame at a map size chosen by mapSizeFor(frame, maxSide). */
export function buildMapsForFrame(
  regions: Region[],
  frame: ImageFrame,
  masks: Map<string, MaskData> | undefined,
  maxSide: number,
): EffectMaps {
  const size = mapSizeFor(frame.width, frame.height, maxSide);
  return buildEffectMaps(regions, frame, size.width, size.height, masks);
}

export interface MapMemoInput {
  regions: Region[];
  /** Fixation in source (working) pixels; compared by value. */
  fixation: Vec2;
  masks: Map<string, MaskData> | undefined;
  /** Frame the maps are built for. */
  frame: ImageFrame;
}

/**
 * Memoises effect-map building. A new map object (with new arrays, so the renderer re-uploads)
 * is built only when the regions array, the masks map (by reference), the fixation or the frame
 * size changes. `build` is injectable for tests.
 */
export function createMapMemo(
  maxSide: number,
  build: (regions: Region[], frame: ImageFrame, masks: Map<string, MaskData> | undefined, maxSide: number) => EffectMaps =
    buildMapsForFrame,
) {
  let last: { input: MapMemoInput; maps: EffectMaps } | null = null;
  return {
    /** Returns cached maps or builds new ones; `built` says which. */
    get(input: MapMemoInput): { maps: EffectMaps; built: boolean } {
      const prev = last?.input;
      if (
        last &&
        prev &&
        prev.regions === input.regions &&
        prev.masks === input.masks &&
        prev.fixation.x === input.fixation.x &&
        prev.fixation.y === input.fixation.y &&
        prev.frame.width === input.frame.width &&
        prev.frame.height === input.frame.height
      ) {
        return { maps: last.maps, built: false };
      }
      const maps = build(input.regions, input.frame, input.masks, maxSide);
      last = { input, maps };
      return { maps, built: true };
    },
    /** Forgets the cache (for example after a lost WebGL context). */
    clear(): void {
      last = null;
    },
  };
}

/** Formats a timing for display: one decimal under 10 ms, whole numbers above. */
export function formatMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '–';
  return ms < 10 ? ms.toFixed(1) : String(Math.round(ms));
}

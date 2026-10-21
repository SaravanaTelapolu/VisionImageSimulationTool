import { effect, signal } from '@preact/signals';
import type { Profile } from '../model/types';
import { greyscaleToRgba, rgbaToGreyscale } from '../render/maskRaster';
import type { MaskData } from '../render/shapeCoverage';
import { profile } from './store';

/**
 * Decoded greyscale data for 'mask' regions, keyed by region id. The effect-map builder reads
 * this. This module keeps it in sync with the profile: every visible mask region's dataUrl is
 * decoded when it is new or changed. The brush tool writes live data into it while a stroke is in
 * progress (setLiveMask) so the preview follows the finger.
 */
export const maskData = signal<Map<string, MaskData>>(new Map());

/** Recently used decoded masks that no region currently references (kept so undo/redo is instant). */
const SPARE_CACHE_ENTRIES = 8;

const cache = new Map<string, MaskData>(); // dataUrl -> decoded; insertion order = recency
/** Decodes in flight, by dataUrl (shared by the live sync and decodeMasksFor). */
const pending = new Map<string, Promise<MaskData | null>>();
const failed = new Set<string>();
/** Bumped by resetMaskCache so decodes started before a reset are not stored afterwards. */
let epoch = 0;

// --- Codec (DOM) --------------------------------------------------------------------------

export interface MaskCodec {
  decode(dataUrl: string): Promise<MaskData | null>;
  encode(data: MaskData): string | null;
}

function canvasCodec(): MaskCodec {
  return {
    decode(dataUrl) {
      if (typeof document === 'undefined' || typeof Image === 'undefined') return Promise.resolve(null);
      return new Promise<MaskData | null>((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            if (w < 1 || h < 1) return resolve(null);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return resolve(null);
            ctx.drawImage(img, 0, 0);
            const rgba = ctx.getImageData(0, 0, w, h).data;
            resolve({ width: w, height: h, data: rgbaToGreyscale(rgba, w, h) });
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      });
    },
    encode(data) {
      if (typeof document === 'undefined') return null;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = data.width;
        canvas.height = data.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const rgba = greyscaleToRgba(data.data);
        ctx.putImageData(new ImageData(rgba, data.width, data.height), 0, 0);
        const url = canvas.toDataURL('image/png');
        return url.startsWith('data:image/') ? url : null;
      } catch {
        return null;
      }
    },
  };
}

let codec: MaskCodec = canvasCodec();

/** Test hook: replace the canvas-based PNG codec. Pass nothing to restore the real one. */
export function setMaskCodec(next?: MaskCodec): void {
  codec = next ?? canvasCodec();
}

/** Encodes a greyscale buffer to a PNG data URL; null when canvas is unavailable. */
export function encodeMaskPng(data: MaskData): string | null {
  return codec.encode(data);
}

// --- Cache and sync -----------------------------------------------------------------------

/** Remember the decoded data for a dataUrl we just produced, so it never needs decoding. */
export function primeMaskCache(dataUrl: string, data: MaskData): void {
  cache.delete(dataUrl);
  cache.set(dataUrl, data);
  failed.delete(dataUrl);
}

/** Number of cached decoded masks (for tests). */
export function maskCacheSize(): number {
  return cache.size;
}

/** Clears the cache and published data (for tests and profile switches). */
export function resetMaskCache(): void {
  epoch++;
  cache.clear();
  pending.clear();
  failed.clear();
  maskData.value = new Map();
}

/** Publishes a mask's data right away (the brush calls this while painting). */
export function setLiveMask(id: string, data: MaskData): void {
  const next = new Map(maskData.peek());
  next.set(id, data);
  maskData.value = next;
}

/** Starts (or joins) the decode of a dataUrl. Resolves with the decoded data, or null on failure. */
function request(dataUrl: string): Promise<MaskData | null> {
  const hit = cache.get(dataUrl);
  if (hit) return Promise.resolve(hit);
  if (failed.has(dataUrl)) return Promise.resolve(null);
  const inFlight = pending.get(dataUrl);
  if (inFlight) return inFlight;
  const started = epoch;
  const finish = (data: MaskData | null): MaskData | null => {
    if (started !== epoch) return data; // the cache was reset meanwhile: do not store or publish
    if (pending.get(dataUrl) === done) pending.delete(dataUrl);
    if (data) {
      if (!cache.has(dataUrl)) cache.set(dataUrl, data);
    } else {
      failed.add(dataUrl);
    }
    syncMasks(profile.peek());
    return cache.get(dataUrl) ?? data;
  };
  let decoding: Promise<MaskData | null>;
  try {
    decoding = codec.decode(dataUrl);
  } catch {
    decoding = Promise.resolve(null);
  }
  const done: Promise<MaskData | null> = decoding.then(finish, () => finish(null));
  pending.set(dataUrl, done);
  return done;
}

/** True while the given mask dataUrl is still being decoded. */
export function isMaskPending(dataUrl: string): boolean {
  return pending.has(dataUrl);
}

/**
 * Decoded data for every visible mask region of `p`, from that profile's own dataUrls (keyed by
 * region id). Uses the shared dataUrl cache and joins decodes already in flight, so it never
 * returns data that belongs to another profile or to an older version of a region. Regions whose
 * PNG cannot be decoded are left out. Use it for one-off renders (export, timeline).
 */
export async function decodeMasksFor(p: Profile): Promise<Map<string, MaskData>> {
  const out = new Map<string, MaskData>();
  const jobs: Promise<void>[] = [];
  for (const r of p.regions) {
    if (r.shape.type !== 'mask' || !r.visible) continue;
    const id = r.id;
    jobs.push(
      request(r.shape.dataUrl).then((data) => {
        if (data) out.set(id, data);
      }),
    );
  }
  await Promise.all(jobs);
  return out;
}

/** Resolves once no mask decode is in flight (each pass waits for the decodes started so far). */
export async function masksReady(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending.values()]);
}

function trimCache(used: ReadonlySet<string>): void {
  const spare: string[] = [];
  for (const key of cache.keys()) if (!used.has(key)) spare.push(key);
  for (let i = 0; i < spare.length - SPARE_CACHE_ENTRIES; i++) cache.delete(spare[i] as string);
}

function sameMaps(a: ReadonlyMap<string, MaskData>, b: ReadonlyMap<string, MaskData>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** Brings maskData in line with the profile: decode what is new, drop what is gone. */
export function syncMasks(p: Profile): void {
  const prev = maskData.peek();
  const next = new Map<string, MaskData>();
  const used = new Set<string>();
  for (const r of p.regions) {
    if (r.shape.type !== 'mask') continue;
    const url = r.shape.dataUrl;
    used.add(url);
    if (!r.visible) continue;
    const hit = cache.get(url);
    if (hit) {
      cache.delete(url); // refresh recency
      cache.set(url, hit);
      next.set(r.id, hit);
    } else {
      // Keep showing the previous data for this region until the new one has decoded.
      const old = prev.get(r.id);
      if (old) next.set(r.id, old);
      void request(url);
    }
  }
  trimCache(used);
  if (!sameMaps(prev, next)) maskData.value = next;
}

// Started once, on import. Anything that shows or edits masks imports this module.
effect(() => {
  syncMasks(profile.value);
});

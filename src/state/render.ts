// Live preview controller and render API (W2-1, revised in W5-2).
//
// Pixel spaces:
// - "working" pixels: image.value.width x height (the decoded photo, long side <= 2048). The store's
//   fixation signal is in these pixels. Effect maps are built for this frame (they are stored in
//   normalised coordinates, so they do not depend on the preview resolution).
// - "preview" pixels: the renderer source. Its long side follows what is actually displayed, in
//   device pixels (H3): min(PREVIEW_CAP_SIDE, working size, GPU limit, displayed size), stepped and
//   with hysteresis (./previewSize.ts). Views report their displayed size with
//   setPreviewDisplaySize(). `previewSource` publishes the source canvas so comparison views can
//   draw the "original" from exactly the pixels the simulation started from.
// - "full" pixels: the original file decoded for export (long side capped like the export). Params
//   are built in working pixels and converted with scaleRenderParams().
//
// The preview re-renders (coalesced with requestAnimationFrame) whenever the profile, fixation or
// brush masks change. Map builds run in a Web Worker (src/render/mapWorkerClient.ts) with
// latest-wins semantics. The first build after an image change is synchronous (so the first frame
// is never blank). While a rebuild is in flight a frame that would only redraw the old maps is
// skipped (M5): an edit renders once, when its maps arrive. Without a usable worker the builds stay
// synchronous.
//
// GPU timing (M5): the live path never waits for the GPU. Frames are timed only while the
// Performance readout is shown (lastRenderMs has a subscriber): with EXT_disjoint_timer_query_webgl2
// when available (non-blocking), else with a CPU timestamp around render + finish().
import { effect, signal, untracked } from '@preact/signals';
import { centredFrame } from '../model/coords';
import type { ImageFrame, Profile } from '../model/types';
import { createRenderer, isWebGL2Supported, scaleRenderParams, type WebGLRenderer } from '../render/createRenderer';
import { mapSizeFor } from '../render/effectMaps';
import { EXPORT_MAX_SIDE } from '../render/gl/math';
import { createMapBuilder, type MapBuilder } from '../render/mapWorkerClient';
import type { EffectMaps, RenderParams } from '../render/types';
import type { ProfileGlobals } from '../model/types';
import {
  EXPORT_MAP_MAX_SIDE,
  PREVIEW_MAP_MAX_SIDE,
  buildMapsForFrame,
  buildRenderParams,
  previewSizeFor,
  scaleFrame,
  type MapMemoInput,
} from '../ui/preview/math';
import { decodeMasksFor, maskData } from './masks';
import { choosePreviewLongSide } from './previewSize';
import { fixation, image, previewCanvas, profile, type PhotoState } from './store';

export type PreviewStatus = 'idle' | 'ready' | 'unsupported' | 'lost' | 'error';

/** State of the live WebGL preview. Anything but 'ready' means the original image is shown. */
export const previewStatus = signal<PreviewStatus>('idle');
/**
 * GPU time of the last measured live-preview render, ms. Frames are measured only while something
 * subscribes to this signal (the Performance readout), so the live path never syncs with the GPU.
 */
export const lastRenderMs = signal<number | null>(null, {
  watched: () => setTiming(true),
  unwatched: () => setTiming(false),
});
/** Last effect-map build time for the live preview, ms (only updated when maps are rebuilt). */
export const lastMapMs = signal<number | null>(null);
/** Increments after every live-preview render; subscribe to copy the simulated canvas (e.g. side-by-side view). */
export const renderTick = signal(0);
/**
 * The image the live preview renders from, at the preview's resolution (H3), or null without a
 * live preview. Comparison views draw the "original" from it, so original and simulated have the
 * same resolution. It has the working image's aspect ratio; stretch it to the working size.
 */
export const previewSource = signal<HTMLCanvasElement | null>(null);

export const WEBGL_UNSUPPORTED_MESSAGE =
  'This browser cannot run the simulation (WebGL2 is not available). Showing the original photo.';
export const WEBGL_LOST_MESSAGE =
  'The graphics processor was reset. Showing the original photo until the simulation recovers.';

/** Delay after the last displayed-size change before the preview is re-sized (pinch zoom settles). */
export const PREVIEW_RESIZE_DELAY_MS = 150;
/** The timeline's offscreen renderer is released after this long without use (L4). */
export const OFFSCREEN_IDLE_MS = 15_000;

interface PreviewSource {
  img: PhotoState;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

let renderer: WebGLRenderer | null = null;
let source: PreviewSource | null = null;
let rafId = 0;

// Effect-map state of the live preview.
let builder: MapBuilder | null = null;
/** Maps the renderer currently uses. */
let currentMaps: EffectMaps | null = null;
/** Input the current maps were built from. */
let currentInput: MapMemoInput | null = null;
/** Input of the newest map build requested (finished or in flight). */
let requested: MapMemoInput | null = null;
/** Bumped whenever the map state is reset, so results of builds started earlier are dropped. */
let mapGeneration = 0;
/** What the canvas shows now (to skip frames that would draw the same thing). */
let lastDrawn: { maps: EffectMaps; globals: ProfileGlobals; source: PreviewSource } | null = null;

// --- Helpers -------------------------------------------------------------------------------

function drawToCanvas(img: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

/** CanvasImageSource types WebGL can upload directly; anything else is drawn to a canvas first. */
function toTexSource(img: CanvasImageSource, width: number, height: number): TexImageSource {
  if (
    (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) ||
    (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) ||
    (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) ||
    (typeof HTMLVideoElement !== 'undefined' && img instanceof HTMLVideoElement) ||
    (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas)
  ) {
    return img;
  }
  return drawToCanvas(img, width, height);
}

function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  return drawToCanvas(src, src.width, src.height);
}

function ensureRenderer(): WebGLRenderer | null {
  if (renderer) return renderer;
  if (!isWebGL2Supported()) {
    previewStatus.value = 'unsupported';
    return null;
  }
  try {
    const r = createRenderer();
    // Registered after the renderer's own listeners, so on 'restored' its pipeline is rebuilt first.
    r.canvas.addEventListener('webglcontextlost', onContextLost, false);
    r.canvas.addEventListener('webglcontextrestored', onContextRestored, false);
    renderer = r;
    return r;
  } catch (err) {
    console.warn('[preview] Could not create the WebGL renderer.', err);
    previewStatus.value = 'unsupported';
    return null;
  }
}

function resetMaps(): void {
  mapGeneration++;
  currentMaps = null;
  currentInput = null;
  requested = null;
  lastDrawn = null;
}

function sameMapInput(a: MapMemoInput, b: MapMemoInput): boolean {
  return (
    a.regions === b.regions &&
    a.masks === b.masks &&
    a.fixation.x === b.fixation.x &&
    a.fixation.y === b.fixation.y &&
    a.frame.width === b.frame.width &&
    a.frame.height === b.frame.height
  );
}

/**
 * Maps to render with for `input`. Unchanged input: the current maps. Changed input: with a worker,
 * start a rebuild and return the previous maps (a render is scheduled when the new ones arrive);
 * otherwise (no previous maps, or no worker) build now.
 */
function mapsFor(input: MapMemoInput): EffectMaps {
  if (currentMaps && requested && sameMapInput(requested, input)) return currentMaps;
  const b = (builder ??= createMapBuilder());
  if (!currentMaps || !b.usesWorker) {
    const t0 = performance.now();
    const maps = buildMapsForFrame(input.regions, input.frame, input.masks, PREVIEW_MAP_MAX_SIDE);
    lastMapMs.value = performance.now() - t0;
    currentMaps = maps;
    currentInput = input;
    requested = input;
    return maps;
  }
  requested = input;
  const gen = mapGeneration;
  const size = mapSizeFor(input.frame.width, input.frame.height, PREVIEW_MAP_MAX_SIDE);
  b.build({
    regions: input.regions,
    frame: input.frame,
    mapWidth: size.width,
    mapHeight: size.height,
    masks: input.masks,
  }).then(
    (maps) => {
      if (!maps || gen !== mapGeneration) return; // superseded or stale
      currentMaps = maps;
      currentInput = input;
      if (b.lastMs !== null) lastMapMs.value = b.lastMs;
      scheduleRender();
    },
    (err) => {
      console.warn('[preview] Effect-map build failed.', err);
      if (gen === mapGeneration) {
        requested = null; // try again on the next render
        scheduleRender();
      }
    },
  );
  return currentMaps;
}

/** True while a map build for newer input than the current maps is in flight. */
function mapsPending(): boolean {
  return requested !== null && currentInput !== requested;
}

function onContextLost(): void {
  cancelFrame();
  resetMaps();
  previewStatus.value = 'lost';
  previewCanvas.value = null; // the viewport falls back to the plain image
  previewSource.value = null;
}

function onContextRestored(): void {
  if (!renderer || renderer.contextLost || !source) return;
  resetMaps();
  previewStatus.value = 'ready';
  renderFrame(true);
  previewSource.value = source.canvas;
  previewCanvas.value = renderer.canvas;
}

function cancelFrame(): void {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function scheduleRender(): void {
  if (rafId || !renderer || !source) return;
  rafId = requestAnimationFrame(() => renderFrame());
}

// --- GPU timing (only while the Performance readout is shown) -------------------------------

let timingOn = false;
let pollId = 0;

function setTiming(on: boolean): void {
  timingOn = on;
  if (on) scheduleRender(); // measure a fresh frame for the readout
  else if (pollId) {
    cancelAnimationFrame(pollId);
    pollId = 0;
  }
}

function pollGpuTime(): void {
  pollId = 0;
  const r = renderer;
  if (!r || r.contextLost) return;
  const ms = r.pollGpuTimeMs();
  if (ms !== null) lastRenderMs.value = ms;
  if (timingOn && r.gpuTimePending) pollId = requestAnimationFrame(pollGpuTime);
}

/**
 * Renders the current state into the preview canvas now. Unless `force`, a frame that would only
 * redraw the same maps while newer ones are being built is skipped (they schedule a render).
 */
function renderFrame(force = false): void {
  rafId = 0;
  const r = renderer;
  const src = source;
  if (!r || !src || r.contextLost) return;
  const img = src.img;
  const prof = profile.peek();
  const fix = fixation.peek();
  const workFrame: ImageFrame = { width: img.width, height: img.height, fixation: fix };
  const maps = mapsFor({ regions: prof.regions, fixation: fix, masks: maskData.peek(), frame: workFrame });
  if (
    !force &&
    mapsPending() &&
    lastDrawn !== null &&
    lastDrawn.maps === maps &&
    lastDrawn.globals === prof.globals &&
    lastDrawn.source === src
  ) {
    return;
  }
  const params = buildRenderParams(prof, scaleFrame(fix, img, src), maps);
  if (timingOn && r.gpuTimerSupported) {
    r.render(params, { timed: true });
    if (!pollId) pollId = requestAnimationFrame(pollGpuTime);
  } else if (timingOn) {
    const t1 = performance.now();
    r.render(params);
    r.finish(); // a CPU/GPU sync, only while the readout is open and there is no GPU timer
    lastRenderMs.value = performance.now() - t1;
  } else {
    r.render(params);
  }
  lastDrawn = { maps, globals: prof.globals, source: src };
  renderTick.value++;
}

// --- Preview resolution (H3) ----------------------------------------------------------------

const displayRequests = new Map<string, number>();
let resizeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * A view reports the long side, in device pixels, at which it currently shows the whole image
 * (e.g. working long side x zoom scale x devicePixelRatio), or null when it stops showing it. The
 * preview is re-sized to the largest report after a short settle delay.
 */
export function setPreviewDisplaySize(key: string, longSideDevicePx: number | null): void {
  const prev = displayRequests.get(key);
  if (longSideDevicePx === null || !Number.isFinite(longSideDevicePx) || longSideDevicePx <= 0) {
    if (prev === undefined) return;
    displayRequests.delete(key);
  } else {
    const v = Math.round(longSideDevicePx);
    if (prev === v) return;
    displayRequests.set(key, v);
  }
  if (resizeTimer !== null) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    applyPreviewSize();
  }, PREVIEW_RESIZE_DELAY_MS);
}

function wantedLongSide(): number | null {
  let max = 0;
  for (const v of displayRequests.values()) max = Math.max(max, v);
  return max > 0 ? max : null;
}

function longSideFor(img: PhotoState, r: WebGLRenderer, current: PreviewSource | null): number {
  return choosePreviewLongSide({
    wanted: wantedLongSide(),
    current: current && current.img === img ? Math.max(current.width, current.height) : null,
    imageLong: Math.max(img.width, img.height),
    gpuMax: r.maxSide,
  });
}

function applyPreviewSize(): void {
  const src = source;
  const r = renderer;
  if (!src || !r || r.contextLost || previewStatus.peek() !== 'ready') return;
  const long = longSideFor(src.img, r, src);
  if (long === Math.max(src.width, src.height)) return;
  uploadSource(src.img, r, long);
}

/** Prepares the preview source at `long` px, uploads it and draws a frame. False on failure. */
function uploadSource(img: PhotoState, r: WebGLRenderer, long: number): boolean {
  cancelFrame();
  const size = previewSizeFor(img.width, img.height, long);
  let canvas: HTMLCanvasElement;
  try {
    canvas = drawToCanvas(img.working, size.width, size.height);
  } catch (err) {
    console.warn('[preview] Could not prepare the preview image.', err);
    failSource('error');
    return false;
  }
  try {
    r.setSource(canvas, size.width, size.height);
  } catch (err) {
    console.warn('[preview] Could not upload the image to the GPU.', err);
    failSource('error');
    return false;
  }
  source = { img, canvas, ...size };
  if (r.contextLost) {
    failSource('lost');
    return false;
  }
  previewStatus.value = 'ready';
  renderFrame(true); // setSource cleared the canvas: draw before anything is composited
  previewSource.value = canvas;
  previewCanvas.value = r.canvas;
  return true;
}

function failSource(status: PreviewStatus): void {
  previewStatus.value = status;
  previewCanvas.value = null;
  previewSource.value = null;
}

function setImageSource(img: PhotoState | null): void {
  cancelFrame();
  resetMaps();
  if (!img) {
    source = null;
    previewCanvas.value = null;
    previewSource.value = null;
    return;
  }
  const r = ensureRenderer();
  if (!r) {
    source = null;
    previewCanvas.value = null;
    previewSource.value = null;
    return;
  }
  const prev = source;
  source = null;
  uploadSource(img, r, longSideFor(img, r, prev));
}

// --- Lifecycle -----------------------------------------------------------------------------

let stopEffects: (() => void) | null = null;

/** Starts the live preview (idempotent). Returns a function that stops it. */
export function initPreview(): () => void {
  if (stopEffects) return stopEffects;
  const stopImage = effect(() => {
    const img = image.value;
    untracked(() => setImageSource(img));
  });
  const stopParams = effect(() => {
    // Subscribe to everything a frame depends on; the frame itself reads with peek().
    void profile.value;
    void fixation.value;
    void maskData.value;
    untracked(scheduleRender);
  });
  stopEffects = () => {
    stopImage();
    stopParams();
    cancelFrame();
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizeTimer = null;
    if (pollId) cancelAnimationFrame(pollId);
    pollId = 0;
    resetMaps();
    builder?.dispose();
    builder = null;
    source = null;
    previewCanvas.value = null;
    previewSource.value = null;
    if (renderer) {
      renderer.canvas.removeEventListener('webglcontextlost', onContextLost, false);
      renderer.canvas.removeEventListener('webglcontextrestored', onContextRestored, false);
      renderer.dispose();
      renderer = null;
    }
    previewStatus.value = 'idle';
    stopEffects = null;
  };
  return stopEffects;
}

// --- API for export, compare and the timeline -----------------------------------------------

interface DecodedImage {
  source: TexImageSource;
  width: number;
  height: number;
  /** True when this is smaller than the original file (capped, or the working-image fallback). */
  reduced: boolean;
  close(): void;
}

/** Full (oriented) pixel size of original files decoded before, so later decodes can be capped. */
const fullSizes = new WeakMap<Blob, { width: number; height: number }>();

/** Long-side limit of exported images on this device (same rule as the simulated export). */
function exportLongSideCap(): number {
  const r = renderer;
  return Math.min(EXPORT_MAX_SIDE, r && r.maxSide > 0 ? r.maxSide : EXPORT_MAX_SIDE);
}

function bitmapImage(bmp: ImageBitmap, reduced: boolean): DecodedImage {
  return { source: bmp, width: bmp.width, height: bmp.height, reduced, close: () => bmp.close() };
}

/**
 * The current image for export: the original file when there is one (decoded straight to at most
 * `maxLongSide` when its size is known, L11), else the working image.
 */
async function decodeFullSize(img: PhotoState, maxLongSide = Number.POSITIVE_INFINITY): Promise<DecodedImage> {
  const file = img.original;
  if (file && typeof createImageBitmap === 'function') {
    const known = fullSizes.get(file);
    if (known) {
      const fit = previewSizeFor(known.width, known.height, maxLongSide);
      if (fit.width < known.width || fit.height < known.height) {
        try {
          const bmp = await createImageBitmap(file, {
            imageOrientation: 'from-image',
            resizeWidth: fit.width,
            resizeHeight: fit.height,
            resizeQuality: 'high',
          });
          if (bmp.width === fit.width && bmp.height === fit.height) return bitmapImage(bmp, true);
          bmp.close();
        } catch {
          // resize options unsupported: decode at full size below
        }
      }
    }
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      fullSizes.set(file, { width: bmp.width, height: bmp.height });
      return bitmapImage(bmp, false);
    } catch (err) {
      console.info('[render] Could not decode the original at full size; using the working image.', err);
      return {
        source: toTexSource(img.working, img.width, img.height),
        width: img.width,
        height: img.height,
        reduced: true,
        close: () => undefined,
      };
    }
  }
  return {
    source: toTexSource(img.working, img.width, img.height),
    width: img.width,
    height: img.height,
    reduced: false,
    close: () => undefined,
  };
}

export interface RenderFullSizeResult {
  blob: Blob;
  width: number;
  height: number;
  /** True when the device could not render the full size and a smaller image was produced. */
  downscaled: boolean;
}

export interface RenderFullSizeCanvasResult {
  /** The rendered simulation as a 2D canvas (no encoding). */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** True when the device could not render the full size and a smaller image was produced. */
  downscaled: boolean;
}

/** Shared export path: current state, own masks, capped decode; `run` does the GPU export. */
async function exportCurrent<T>(
  run: (r: WebGLRenderer, image: TexImageSource, width: number, height: number, params: RenderParams) => Promise<T>,
): Promise<{ result: T; width: number; height: number; downscaled: boolean }> {
  const img = image.peek();
  if (!img) throw new Error('No image is loaded.');
  const r = ensureRenderer();
  if (!r) throw new Error(WEBGL_UNSUPPORTED_MESSAGE);
  const prof = profile.peek();
  const workFrame: ImageFrame = { width: img.width, height: img.height, fixation: fixation.peek() };
  // The profile's own masks, waiting for any still decoding (L9).
  const masks = await decodeMasksFor(prof);
  const maps = buildMapsForFrame(prof.regions, workFrame, masks, EXPORT_MAP_MAX_SIDE);
  const workParams = buildRenderParams(prof, workFrame, maps);
  const full = await decodeFullSize(img, exportLongSideCap());
  try {
    const params = scaleRenderParams(workParams, full.width / img.width, full.height / img.height);
    const result = await run(r, full.source, full.width, full.height, params);
    const info = r.lastExport;
    return {
      result,
      width: info?.width ?? full.width,
      height: info?.height ?? full.height,
      downscaled: (info?.downscaled ?? false) || (full.reduced && !!img.original),
    };
  } finally {
    full.close();
  }
}

/** Renders the simulation on the full-size image and encodes it (PNG by default). */
export async function renderFullSize(
  opts: { type?: 'image/png' | 'image/jpeg'; quality?: number } = {},
): Promise<RenderFullSizeResult> {
  const { result, ...rest } = await exportCurrent((r, src, w, h, params) =>
    r.exportFullSize(src, w, h, params, opts.type, opts.quality),
  );
  return { blob: result, ...rest };
}

/**
 * Renders the simulation on the full-size image and returns it as a 2D canvas, for composing
 * (caption, side by side) without a PNG encode + decode round trip (M1).
 */
export async function renderFullSizeCanvas(): Promise<RenderFullSizeCanvasResult> {
  const { result, ...rest } = await exportCurrent((r, src, w, h, params) => r.exportFullSizeCanvas(src, w, h, params));
  return { canvas: result, ...rest };
}

/**
 * The untouched image, at most `maxLongSide` and never larger than the simulated export would be
 * on this device (L11: no full camera-resolution canvas).
 */
export async function getOriginalCanvas(maxLongSide?: number): Promise<HTMLCanvasElement> {
  const img = image.peek();
  if (!img) throw new Error('No image is loaded.');
  const cap = Math.min(maxLongSide ?? Number.POSITIVE_INFINITY, exportLongSideCap());
  const full = await decodeFullSize(img, cap);
  try {
    const size = previewSizeFor(full.width, full.height, cap);
    return drawToCanvas(full.source as CanvasImageSource, size.width, size.height);
  } finally {
    full.close();
  }
}

/** A 2D copy of the current simulated preview, or null when there is no live preview. */
export function snapshotPreview(): HTMLCanvasElement | null {
  if (!renderer || !source || renderer.contextLost || previewStatus.peek() !== 'ready') return null;
  if (rafId) {
    cancelFrame();
    renderFrame(); // flush a pending change so the copy is current
  }
  return copyCanvas(renderer.canvas);
}

let offscreen: WebGLRenderer | null = null;
let offscreenSource: { image: CanvasImageSource; width: number; height: number } | null = null;
let offscreenIdle: ReturnType<typeof setTimeout> | null = null;

function releaseOffscreen(): void {
  if (offscreenIdle !== null) clearTimeout(offscreenIdle);
  offscreenIdle = null;
  offscreen?.dispose();
  offscreen = null;
  offscreenSource = null;
}

/**
 * Renders any profile on any image, using a separate offscreen renderer (created on demand and
 * released after OFFSCREEN_IDLE_MS without use). For the timeline of dated profiles.
 * - Masks come from the profile's own dataUrls (H1), waiting for any still decoding (L9).
 * - When `src` is the current photo, the user's fixation is used (L10); otherwise the centre.
 */
export async function renderWithProfile(
  p: Profile,
  src: { image: CanvasImageSource; width: number; height: number },
): Promise<HTMLCanvasElement> {
  const masks = await decodeMasksFor(p);
  if (offscreen?.contextLost) releaseOffscreen();
  if (!offscreen) {
    if (!isWebGL2Supported()) throw new Error(WEBGL_UNSUPPORTED_MESSAGE);
    offscreen = createRenderer();
  }
  if (offscreenIdle !== null) clearTimeout(offscreenIdle);
  offscreenIdle = setTimeout(releaseOffscreen, OFFSCREEN_IDLE_MS);
  const same =
    offscreenSource !== null &&
    offscreenSource.image === src.image &&
    offscreenSource.width === src.width &&
    offscreenSource.height === src.height;
  if (!same) {
    offscreen.setSource(toTexSource(src.image, src.width, src.height), src.width, src.height);
    offscreenSource = { image: src.image, width: src.width, height: src.height };
  }
  const img = image.peek();
  const frame =
    img && src.image === img.working ? scaleFrame(fixation.peek(), img, src) : centredFrame(src.width, src.height);
  const maps = buildMapsForFrame(p.regions, frame, masks, EXPORT_MAP_MAX_SIDE);
  offscreen.render(buildRenderParams(p, frame, maps));
  return copyCanvas(offscreen.canvas);
}

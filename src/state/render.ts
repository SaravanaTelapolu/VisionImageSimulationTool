// Live preview controller and render API (W2-1).
//
// Pixel spaces:
// - "working" pixels: image.value.width x height (the decoded photo, long side <= 2048). The store's
//   fixation signal is in these pixels.
// - "preview" pixels: the renderer source, long side <= PREVIEW_MAX_SIDE (1024). The fixation is
//   scaled into this space for the live preview.
// - "full" pixels: the original file decoded at full size, for export. Params are built in working
//   pixels and converted with scaleRenderParams().
//
// The preview re-renders (coalesced with requestAnimationFrame) whenever the profile, fixation or
// brush masks change. Effect maps are rebuilt only when regions, fixation or masks change (by
// reference), and each rebuild makes new arrays so the renderer re-uploads them.
import { effect, signal, untracked } from '@preact/signals';
import { centredFrame } from '../model/coords';
import type { ImageFrame, Profile } from '../model/types';
import { createRenderer, isWebGL2Supported, scaleRenderParams, type WebGLRenderer } from '../render/createRenderer';
import {
  EXPORT_MAP_MAX_SIDE,
  PREVIEW_MAP_MAX_SIDE,
  buildMapsForFrame,
  buildRenderParams,
  createMapMemo,
  previewSizeFor,
  scaleFrame,
} from '../ui/preview/math';
import { maskData } from './masks';
import { fixation, image, previewCanvas, profile, type PhotoState } from './store';

export type PreviewStatus = 'idle' | 'ready' | 'unsupported' | 'lost' | 'error';

/** State of the live WebGL preview. Anything but 'ready' means the original image is shown. */
export const previewStatus = signal<PreviewStatus>('idle');
/** Last GPU render time of the live preview (render + finish), ms. */
export const lastRenderMs = signal<number | null>(null);
/** Last effect-map build time for the live preview, ms (only updated when maps are rebuilt). */
export const lastMapMs = signal<number | null>(null);
/** Increments after every live-preview render; subscribe to copy the simulated canvas (e.g. side-by-side view). */
export const renderTick = signal(0);

export const WEBGL_UNSUPPORTED_MESSAGE =
  'This browser cannot run the simulation (WebGL2 is not available). Showing the original photo.';
export const WEBGL_LOST_MESSAGE =
  'The graphics processor was reset. Showing the original photo until the simulation recovers.';

interface PreviewSource {
  img: PhotoState;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

let renderer: WebGLRenderer | null = null;
let source: PreviewSource | null = null;
let rafId = 0;
const memo = createMapMemo(PREVIEW_MAP_MAX_SIDE);

// --- Helpers -------------------------------------------------------------------------------

function drawToCanvas(img: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available.');
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

function onContextLost(): void {
  cancelFrame();
  memo.clear();
  previewStatus.value = 'lost';
  previewCanvas.value = null; // the viewport falls back to the plain image
}

function onContextRestored(): void {
  if (!renderer || renderer.contextLost || !source) return;
  memo.clear();
  previewStatus.value = 'ready';
  renderFrame();
  previewCanvas.value = renderer.canvas;
}

function cancelFrame(): void {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function scheduleRender(): void {
  if (rafId || !renderer || !source) return;
  rafId = requestAnimationFrame(renderFrame);
}

/** Renders the current state into the preview canvas now. */
function renderFrame(): void {
  rafId = 0;
  const r = renderer;
  const src = source;
  if (!r || !src || r.contextLost) return;
  const img = src.img;
  const prof = profile.peek();
  const fix = fixation.peek();
  const frame = scaleFrame(fix, img, src);
  const t0 = performance.now();
  const { maps, built } = memo.get({ regions: prof.regions, fixation: fix, masks: maskData.peek(), frame });
  const t1 = performance.now();
  if (built) lastMapMs.value = t1 - t0;
  r.render(buildRenderParams(prof, frame, maps));
  r.finish(); // wait for the GPU so the timing is real (the frame has to finish anyway)
  lastRenderMs.value = performance.now() - t1;
  renderTick.value++;
}

function setImageSource(img: PhotoState | null): void {
  cancelFrame();
  memo.clear();
  if (!img) {
    source = null;
    previewCanvas.value = null;
    return;
  }
  const size = previewSizeFor(img.width, img.height);
  let canvas: HTMLCanvasElement;
  try {
    canvas = drawToCanvas(img.working, size.width, size.height);
  } catch (err) {
    console.warn('[preview] Could not prepare the preview image.', err);
    source = null;
    previewCanvas.value = null;
    previewStatus.value = 'error';
    return;
  }
  source = { img, canvas, ...size };
  const r = ensureRenderer();
  if (!r) {
    previewCanvas.value = null;
    return;
  }
  try {
    r.setSource(canvas, size.width, size.height);
  } catch (err) {
    console.warn('[preview] Could not upload the image to the GPU.', err);
    previewStatus.value = 'error';
    previewCanvas.value = null;
    return;
  }
  if (r.contextLost) {
    previewStatus.value = 'lost';
    previewCanvas.value = null;
    return;
  }
  previewStatus.value = 'ready';
  renderFrame(); // draw before showing, so the canvas is never blank
  previewCanvas.value = r.canvas;
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
    stopEffects = null;
  };
  return stopEffects;
}

// --- API for export, compare and the timeline -----------------------------------------------

interface DecodedImage {
  source: TexImageSource;
  width: number;
  height: number;
  close(): void;
}

/** The current image at full size: the original file when there is one, else the working image. */
async function decodeFullSize(img: PhotoState): Promise<DecodedImage> {
  if (img.original && typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(img.original, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch (err) {
      console.info('[render] Could not decode the original at full size; using the working image.', err);
    }
  }
  return {
    source: toTexSource(img.working, img.width, img.height),
    width: img.width,
    height: img.height,
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

/** Renders the simulation on the full-size image and encodes it (PNG by default). */
export async function renderFullSize(
  opts: { type?: 'image/png' | 'image/jpeg'; quality?: number } = {},
): Promise<RenderFullSizeResult> {
  const img = image.peek();
  if (!img) throw new Error('No image is loaded.');
  const r = ensureRenderer();
  if (!r) throw new Error(WEBGL_UNSUPPORTED_MESSAGE);
  const prof = profile.peek();
  const workFrame: ImageFrame = { width: img.width, height: img.height, fixation: fixation.peek() };
  const maps = buildMapsForFrame(prof.regions, workFrame, maskData.peek(), EXPORT_MAP_MAX_SIDE);
  const workParams = buildRenderParams(prof, workFrame, maps);
  const full = await decodeFullSize(img);
  try {
    const params = scaleRenderParams(workParams, full.width / img.width, full.height / img.height);
    const blob = await r.exportFullSize(full.source, full.width, full.height, params, opts.type, opts.quality);
    const info = r.lastExport;
    return {
      blob,
      width: info?.width ?? full.width,
      height: info?.height ?? full.height,
      downscaled: info?.downscaled ?? false,
    };
  } finally {
    full.close();
  }
}

/** The untouched image (full size, or scaled down so its long side is at most maxLongSide). */
export async function getOriginalCanvas(maxLongSide?: number): Promise<HTMLCanvasElement> {
  const img = image.peek();
  if (!img) throw new Error('No image is loaded.');
  const full = await decodeFullSize(img);
  try {
    const size = previewSizeFor(full.width, full.height, maxLongSide ?? Number.POSITIVE_INFINITY);
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

/**
 * Renders any profile on any image with the fixation at the image centre, using a separate
 * offscreen renderer (created once and reused). For the timeline of dated profiles.
 */
export async function renderWithProfile(
  p: Profile,
  src: { image: CanvasImageSource; width: number; height: number },
): Promise<HTMLCanvasElement> {
  if (offscreen?.contextLost) {
    offscreen.dispose();
    offscreen = null;
    offscreenSource = null;
  }
  if (!offscreen) {
    if (!isWebGL2Supported()) throw new Error(WEBGL_UNSUPPORTED_MESSAGE);
    offscreen = createRenderer();
  }
  const same =
    offscreenSource !== null &&
    offscreenSource.image === src.image &&
    offscreenSource.width === src.width &&
    offscreenSource.height === src.height;
  if (!same) {
    offscreen.setSource(toTexSource(src.image, src.width, src.height), src.width, src.height);
    offscreenSource = { ...src };
  }
  const frame = centredFrame(src.width, src.height);
  const maps = buildMapsForFrame(p.regions, frame, maskData.peek(), EXPORT_MAP_MAX_SIDE);
  offscreen.render(buildRenderParams(p, frame, maps));
  return copyCanvas(offscreen.canvas);
}

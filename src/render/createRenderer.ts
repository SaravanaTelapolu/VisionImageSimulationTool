/**
 * WebGL2 renderer (implements `Renderer` from ./types).
 *
 * Design (W1-C):
 * - Orientation: every texture is stored top row first (source, effect maps, pyramid levels, fill),
 *   and image-space uv has v = 0 at the top. Only the final draw to the canvas flips y.
 * - Pixel scale = image shorter side / BLUR_REFERENCE_SHORT_SIDE (768). A blur of N "px" is a
 *   Gaussian with standard deviation N reference px (like CSS blur()), i.e. N * pixelScale real px.
 *   Ghost offset, distortion wavelength and amplitude are in shorter-side units, so preview and
 *   full-size export look the same.
 * - setSource(): uploads the source (RGBA8, LINEAR) and builds a blur pyramid with sigmas
 *   0, 2.5, 5, 10, 20, 40 reference px (gl/math.ts BLUR_LEVELS_REF). Each level is built from the
 *   previous one with separable Gaussian passes (incremental sigma, merged bilinear taps); levels
 *   whose sigma is large are stored at 1/2, 1/4, 1/8 ... resolution (sigma stays >= 4 texels).
 *   Targets are RGBA16F when EXT_color_buffer_float is available, else RGBA8.
 * - Effect maps are uploaded only when `maps.a` / `maps.b` / `maps.c` change by identity (treat EffectMaps as
 *   immutable: build new arrays to change them). LINEAR filtering, normalised coords, so the map
 *   resolution is independent of the image size.
 * - Missing area (fillIn): when maps change and any fillIn > 0, a low-res (128 texels on the short
 *   side) push-pull fill is built: colour premultiplied by validity (1 - fillIn)^4, normalised
 *   Gaussian blurs at 6, 20 and 64 reference px, composed finest-valid-first, falling back to the
 *   40 px pyramid level. The hole fills with surrounding colour/texture, never a dark patch.
 * - render(): ONE full-screen pass (the plan's 3 passes merged): warped sample coordinate
 *   (size-change lenses, then sine + value-noise distortion anchored at the fixation point,
 *   amplitude = mapA.g * distortMaxAmplitude) -> variable blur (two nearest pyramid levels mixed)
 *   -> fill-in mix -> double image (same blur, sampled at -ghostOffset, mixed by strength * 0.5)
 *   -> contrast loss (toward the 20 px level as local mean, x(1 - 0.85c), plus a 30% light veil)
 *   -> dimming (x(1 - 0.9d)) -> colour fade (toward Rec.709 luma) -> dark spot last
 *   (toward 0.5 * shade grey, opacity = strength; the shade is per region, read from map C). Effects work on sRGB values directly.
 * - Coordinates: `params.fixation` and `params.lenses` are in pixels of the image the call is
 *   about: the setSource() width/height for render(), the exportFullSize() width/height for
 *   export. If the image had to be downscaled to fit the GPU, they are rescaled internally.
 *   `scaleRenderParams()` (gl/math.ts) converts preview params to full-size params.
 * - Export: a separate offscreen canvas + WebGL2 context runs the same pipeline at full size
 *   (long side capped at min(MAX_TEXTURE_SIZE, renderbuffer/viewport limits, EXPORT_MAX_SIDE = 4096);
 *   larger images are downscaled to fit and this is logged and reported in `lastExport`), then
 *   canvas.toBlob(). The context is released afterwards.
 * - Full-resolution export (v0.2, Q5; `{ fullResolution: true }`): images larger than one tile
 *   (min(maxSide, 4096)) are rendered in tiles into a 2D canvas of the full size. Each tile renders
 *   its core from core + margin source pixels; the margin covers the furthest sample (lenses,
 *   distortion, ghost) plus 3 sigma of the widest blur level used, and tiles are aligned to the
 *   pyramid's largest downscale factor, so seams are invisible (see gl/tiles.ts). The missing-area
 *   fill is built once from a downscaled copy of the whole image and shared by every tile. If the
 *   full-size canvas cannot be allocated (phone canvas limits) or the margin is too large, the
 *   normal downscaled export runs instead and `lastExport.fallback` says why.
 * - Contexts are created with preserveDrawingBuffer: true so the canvas can be read back (drawImage
 *   for side-by-side export, toBlob) at any time; alpha: false (photos are opaque).
 * - webglcontextlost: render() becomes a no-op and a warning is logged; on webglcontextrestored the
 *   pipeline is rebuilt and the last source re-uploaded (if it is still readable).
 */
import type { RenderParams, Renderer } from './types';
import { GLPipeline, type SourceInfo } from './gl/pipeline';
import { EXPORT_MAX_SIDE, planPyramid } from './gl/math';
import { deleteTarget, type Target } from './gl/glUtils';
import { FILL_SOURCE_MAX_SIDE, canvasSizeAllowed, planTiles, pyramidAlign, tileReach, type Rect } from './gl/tiles';
import { createGpuTimer, type GpuTimer } from './gl/timer';

export { scaleRenderParams } from './gl/math';

const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
};

export interface ExportInfo {
  width: number;
  height: number;
  requestedWidth: number;
  requestedHeight: number;
  downscaled: boolean;
  /** Number of tiles of a tiled full-resolution export (0 when rendered in one piece). */
  tiles: number;
  /** Why a full-resolution export fell back to the downscaled one (undefined when it did not). */
  fallback?: string;
  /** Total time, and the setup (context + upload + pyramid), GPU render and encode parts. */
  ms: number;
  setupMs: number;
  renderMs: number;
  encodeMs: number;
}

export interface ExportOptions {
  /**
   * Keep the full size of images larger than one GPU pass (4096 px or the GPU limit) by rendering
   * in tiles. Falls back to the downscaled export when the device cannot hold the full image.
   */
  fullResolution?: boolean;
}

/** Reasons a full-resolution export fell back to the downscaled one (shown to the user). */
export const FALLBACK_CANVAS = 'This device could not hold an image that large.';
export const FALLBACK_MARGIN = 'The effects reach too far for the image to be rendered in pieces.';
export const FALLBACK_FAILED = 'Rendering the full-size image failed on this device.';

export interface RenderOptions {
  /** Time this render on the GPU (EXT_disjoint_timer_query_webgl2) when supported; see pollGpuTimeMs(). */
  timed?: boolean;
}

/** The contract plus a few extras useful to the app and the dev harness. */
export interface WebGLRenderer extends Renderer {
  render(params: RenderParams, opts?: RenderOptions): void;
  /** True while the WebGL context is lost (render() does nothing). */
  readonly contextLost: boolean;
  /** Size actually uploaded for the current source (may be smaller than declared). */
  readonly sourceInfo: SourceInfo | null;
  /** Largest image side this context can upload and draw (texture, renderbuffer and viewport limits). */
  readonly maxSide: number;
  /** Details of the last exportFullSize() / exportFullSizeCanvas() call. */
  readonly lastExport: ExportInfo | null;
  /**
   * Like exportFullSize(), but returns the rendered pixels as a 2D canvas instead of encoding them,
   * so callers that compose (caption, side by side) avoid a PNG encode + decode round trip.
   */
  exportFullSizeCanvas(
    image: TexImageSource,
    width: number,
    height: number,
    params: RenderParams,
    opts?: ExportOptions,
  ): Promise<HTMLCanvasElement>;
  /** exportFullSize() with options (full resolution by tiling). */
  exportFullSizeWith(
    image: TexImageSource,
    width: number,
    height: number,
    params: RenderParams,
    opts: ExportOptions & { type?: 'image/png' | 'image/jpeg'; quality?: number },
  ): Promise<Blob>;
  /** True when timed renders can be measured on the GPU without blocking. */
  readonly gpuTimerSupported: boolean;
  /** GPU time (ms) of the newest finished timed render, or null if none finished yet. Never blocks. */
  pollGpuTimeMs(): number | null;
  /** True while timed renders are waiting for their GPU results. */
  readonly gpuTimePending: boolean;
  /**
   * Blocks until the GPU has finished (a 1-pixel readback). Expensive: a CPU/GPU sync. Use only
   * for timing in the dev harness or when the performance readout is open and no GPU timer exists.
   */
  finish(): void;
}

let webgl2Support: boolean | undefined;

/** True if this browser can create a WebGL2 context. The probe context is released immediately. */
export function isWebGL2Supported(): boolean {
  if (webgl2Support !== undefined) return webgl2Support;
  try {
    if (typeof document === 'undefined') return (webgl2Support = false);
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    webgl2Support = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl2Support = false;
  }
  return webgl2Support;
}

function getContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
  if (!gl) throw new Error('WebGL2 is not available on this device.');
  return gl;
}

function releaseContext(gl: WebGL2RenderingContext): void {
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image.'))), type, quality);
  });
}

/**
 * Creates the renderer on `canvas` (or a new canvas). Throws if WebGL2 is unavailable; check
 * isWebGL2Supported() first.
 */
export function createRenderer(target?: HTMLCanvasElement): WebGLRenderer {
  const ownsCanvas = !target;
  const canvas = target ?? document.createElement('canvas');
  let pipeline: GLPipeline | null = new GLPipeline(getContext(canvas));
  let timer: GpuTimer | null = createGpuTimer(pipeline.gl);
  const maxTextureSize = pipeline.maxTextureSize;
  const maxSide = pipeline.maxSide;
  let lost = false;
  let disposed = false;
  let lastSource: { image: TexImageSource; width: number; height: number } | null = null;
  let lastExport: ExportInfo | null = null;
  let warnedNoSource = false;

  const onLost = (e: Event) => {
    e.preventDefault(); // allow restoration
    lost = true;
    pipeline = null; // its GL objects are gone with the context
    timer = null;
    console.warn('[renderer] WebGL context lost; rendering paused until it is restored.');
  };
  const onRestored = () => {
    if (disposed) return;
    try {
      pipeline = new GLPipeline(getContext(canvas));
      timer = createGpuTimer(pipeline.gl);
      lost = false;
      if (lastSource) pipeline.setSource(lastSource.image, lastSource.width, lastSource.height);
      console.warn('[renderer] WebGL context restored.');
    } catch (err) {
      console.warn('[renderer] Could not restore the WebGL context.', err);
    }
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  const renderer: WebGLRenderer = {
    canvas,
    maxTextureSize,
    get contextLost() {
      return lost;
    },
    get sourceInfo() {
      return pipeline?.sourceInfo ?? null;
    },
    maxSide,
    get lastExport() {
      return lastExport;
    },
    get gpuTimerSupported() {
      return !!timer?.supported;
    },
    get gpuTimePending() {
      return !!timer?.pending;
    },
    pollGpuTimeMs() {
      return timer && !lost ? timer.poll() : null;
    },

    setSource(image, width, height) {
      if (disposed) throw new Error('Renderer disposed.');
      lastSource = { image, width, height };
      if (lost || !pipeline) return;
      const info = pipeline.setSource(image, width, height);
      if (info.downscaled) {
        console.info(`[renderer] Source ${width}x${height} exceeds the GPU limit; using ${info.width}x${info.height}.`);
      }
    },

    render(params: RenderParams, opts?: RenderOptions) {
      if (disposed || lost || !pipeline) return;
      const timing = !!opts?.timed && !!timer?.begin();
      const drawn = pipeline.render(params);
      if (timing) timer?.end();
      if (!drawn && !warnedNoSource) {
        warnedNoSource = true;
        console.warn('[renderer] render() called before setSource(); nothing drawn.');
      }
    },

    exportFullSize(image, width, height, params, type = 'image/png', quality) {
      return runExport(image, width, height, params, (out) => canvasToBlob(out, type, quality));
    },

    exportFullSizeWith(image, width, height, params, opts) {
      const encode = (out: HTMLCanvasElement) => canvasToBlob(out, opts.type ?? 'image/png', opts.quality);
      return exportMaybeTiled(image, width, height, params, opts, encode, encode);
    },

    exportFullSizeCanvas(image, width, height, params, opts) {
      // A tiled export already is a 2D canvas; a single-pass one is copied out of its GL context.
      return exportMaybeTiled(image, width, height, params, opts ?? {}, async (out) => out, copyOut);
    },

    finish() {
      if (pipeline && !lost) pipeline.finish();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
      if (pipeline && !lost) {
        timer?.dispose();
        pipeline.dispose();
        // Only lose a context we own: a caller's canvas may get a new renderer later.
        if (ownsCanvas) releaseContext(pipeline.gl);
      }
      if (ownsCanvas) {
        // Free the drawing buffer now rather than when the canvas is garbage-collected.
        canvas.width = 1;
        canvas.height = 1;
      }
      timer = null;
      pipeline = null;
      lastSource = null;
    },
  };

  /**
   * Renders `params` on `image` at full size in a separate context, hands the drawn canvas to
   * `take` (encode or copy), records lastExport and releases the context.
   */
  async function runExport<T>(
    image: TexImageSource,
    width: number,
    height: number,
    params: RenderParams,
    take: (out: HTMLCanvasElement) => Promise<T>,
  ): Promise<T> {
    if (disposed) throw new Error('Renderer disposed.');
    const t0 = performance.now();
    const out = document.createElement('canvas');
    const gl = getContext(out);
    let pipe: GLPipeline | null = null;
    try {
      pipe = new GLPipeline(gl);
      const info = pipe.setSource(image, width, height, Math.min(pipe.maxSide, EXPORT_MAX_SIDE));
      if (info.downscaled) {
        console.info(
          `[renderer] Export ${width}x${height} is larger than this device can render; exported at ${info.width}x${info.height}.`,
        );
      }
      if (gl.drawingBufferWidth !== info.width || gl.drawingBufferHeight !== info.height) {
        throw new Error('The export canvas could not be allocated at the requested size.');
      }
      pipe.finish();
      const t1 = performance.now();
      pipe.render(params);
      pipe.finish();
      const t2 = performance.now();
      const result = await take(out);
      const t3 = performance.now();
      lastExport = {
        width: info.width,
        height: info.height,
        requestedWidth: width,
        requestedHeight: height,
        downscaled: info.downscaled,
        tiles: 0,
        ms: t3 - t0,
        setupMs: t1 - t0,
        renderMs: t2 - t1,
        encodeMs: t3 - t2,
      };
      return result;
    } finally {
      pipe?.dispose();
      releaseContext(gl);
      out.width = 1;
      out.height = 1;
    }
  }

  /**
   * Full-resolution export when asked for and needed (the image is larger than one GPU pass), else
   * the normal export. `takeTiled` receives the full-size 2D canvas of a tiled render, `take` the
   * GL canvas of a single pass. A tiled render that cannot be done falls back to the normal one.
   */
  async function exportMaybeTiled<T>(
    image: TexImageSource,
    width: number,
    height: number,
    params: RenderParams,
    opts: ExportOptions,
    takeTiled: (out: HTMLCanvasElement) => Promise<T>,
    take: (out: HTMLCanvasElement) => Promise<T>,
  ): Promise<T> {
    if (disposed) throw new Error('Renderer disposed.');
    const onePass = Math.min(maxSide, EXPORT_MAX_SIDE);
    if (!opts.fullResolution || Math.max(width, height) <= onePass) return runExport(image, width, height, params, take);
    let fallback: string;
    try {
      const tiled = await runTiledExport(image, width, height, params);
      if (typeof tiled !== 'string') {
        const t2 = performance.now();
        const result = await takeTiled(tiled.canvas);
        const info = tiled.info;
        const encodeMs = performance.now() - t2;
        lastExport = { ...info, encodeMs, ms: info.ms + encodeMs };
        return result;
      }
      fallback = tiled;
    } catch (err) {
      console.warn('[renderer] Tiled export failed; exporting downscaled instead.', err);
      fallback = FALLBACK_FAILED;
    }
    console.info(`[renderer] Full-resolution export of ${width}x${height} not possible: ${fallback}`);
    const result = await runExport(image, width, height, params, take);
    if (lastExport) lastExport = { ...lastExport, fallback };
    return result;
  }

  /**
   * Renders the image in tiles into a full-size 2D canvas (see gl/tiles.ts). Returns a fallback
   * reason instead when the canvas cannot be allocated or the tiles would be too small.
   */
  async function runTiledExport(
    image: TexImageSource,
    width: number,
    height: number,
    params: RenderParams,
  ): Promise<{ canvas: HTMLCanvasElement; info: ExportInfo } | string> {
    const t0 = performance.now();
    const W = Math.round(width);
    const H = Math.round(height);
    const glCanvas = document.createElement('canvas');
    const gl = getContext(glCanvas);
    const crop = document.createElement('canvas');
    let pipe: GLPipeline | null = null;
    let fill: Target | null = null;
    try {
      pipe = new GLPipeline(gl);
      const tileMax = Math.min(pipe.maxSide, EXPORT_MAX_SIDE);
      // Each tile's margin follows the effects over its own core (see gl/tiles.ts).
      const pyramid = planPyramid(W, H);
      const plan = planTiles(W, H, tileMax, (core) => tileReach(params, W, H, pyramid, core).marginPx, pyramidAlign(W, H));
      if (!plan) return FALLBACK_MARGIN;
      const out = allocateCanvas(W, H);
      if (!out) return FALLBACK_CANVAS;
      const ctx = out.getContext('2d');
      if (!ctx) return FALLBACK_CANVAS;

      // Missing-area fill: built once from a small copy of the whole image, shared by every tile.
      pipe.setSource(image, W, H, FILL_SOURCE_MAX_SIDE);
      fill = pipe.takeFill(params.maps);
      pipe.setExternalFill(fill?.tex ?? null);
      const t1 = performance.now();

      for (const tile of plan.tiles) {
        const src = tile.src;
        cropWithEdgeRepeat(crop, image, W, H, src);
        pipe.setSource(crop, src.width, src.height, tileMax, { x: src.x, y: src.y, fullWidth: W, fullHeight: H });
        if (gl.drawingBufferWidth !== src.width || gl.drawingBufferHeight !== src.height) {
          throw new Error('A tile canvas could not be allocated.');
        }
        pipe.render(params);
        const c = tile.core;
        ctx.drawImage(glCanvas, c.x - src.x, c.y - src.y, c.width, c.height, c.x, c.y, c.width, c.height);
        if (gl.isContextLost()) throw new Error('The WebGL context was lost during export.');
        await new Promise((r) => setTimeout(r, 0)); // keep the page responsive between tiles
      }
      const t2 = performance.now();
      console.info(
        `[renderer] Tiled export ${W}x${H}: ${plan.tiles.length} tiles, ` +
          `largest margin ${plan.margin} px, ${Math.round(t2 - t0)} ms.`,
      );
      return {
        canvas: out,
        info: {
          width: W,
          height: H,
          requestedWidth: width,
          requestedHeight: height,
          downscaled: false,
          tiles: plan.tiles.length,
          ms: t2 - t0,
          setupMs: t1 - t0,
          renderMs: t2 - t1,
          encodeMs: 0,
        },
      };
    } finally {
      pipe?.dispose();
      if (fill && !gl.isContextLost()) deleteTarget(gl, fill);
      releaseContext(gl);
      glCanvas.width = 1;
      glCanvas.height = 1;
      crop.width = 1;
      crop.height = 1;
    }
  }

  return renderer;
}

/** A copy of a (WebGL) canvas as a 2D canvas, so the GL context can be released. */
async function copyOut(out: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const copy = document.createElement('canvas');
  copy.width = out.width;
  copy.height = out.height;
  const ctx = copy.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available.');
  ctx.drawImage(out, 0, 0);
  return copy;
}

/**
 * A 2D canvas of width x height, or null when the browser cannot hold one that large. Browsers
 * fail silently past their limits, so a pixel in the far corner is written and read back.
 */
export function allocateCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (!canvasSizeAllowed(width, height)) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    if (canvas.width !== width || canvas.height !== height) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(width - 1, height - 1, 1, 1);
    const px = ctx.getImageData(width - 1, height - 1, 1, 1).data;
    if (px[3] !== 255 || px[0] !== 255) {
      canvas.width = 1;
      canvas.height = 1;
      return null;
    }
    return canvas;
  } catch {
    return null;
  }
}

/**
 * Copies `rect` of an image (width x height) into `canvas`. Parts of the rect past the right or
 * bottom edge repeat the last column / row, as every tile's padding must (see gl/tiles.ts).
 */
function cropWithEdgeRepeat(canvas: HTMLCanvasElement, image: TexImageSource, width: number, height: number, rect: Rect): void {
  if (canvas.width !== rect.width) canvas.width = rect.width;
  if (canvas.height !== rect.height) canvas.height = rect.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available.');
  const img = image as CanvasImageSource;
  ctx.imageSmoothingEnabled = false; // exact copies and exact edge repeats
  const w = Math.min(rect.width, width - rect.x);
  const h = Math.min(rect.height, height - rect.y);
  ctx.drawImage(img, rect.x, rect.y, w, h, 0, 0, w, h);
  const padW = rect.width - w;
  const padH = rect.height - h;
  if (padW > 0) ctx.drawImage(img, width - 1, rect.y, 1, h, w, 0, padW, h);
  if (padH > 0) ctx.drawImage(img, rect.x, height - 1, w, 1, 0, h, w, padH);
  if (padW > 0 && padH > 0) ctx.drawImage(img, width - 1, height - 1, 1, 1, w, h, padW, padH);
}

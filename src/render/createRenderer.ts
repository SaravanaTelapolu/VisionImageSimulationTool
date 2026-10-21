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
 * - Effect maps are uploaded only when `maps.a` / `maps.b` change by identity (treat EffectMaps as
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
 *   (toward 0.5 * shade grey, opacity = strength). Effects work on sRGB values directly.
 * - Coordinates: `params.fixation` and `params.lenses` are in pixels of the image the call is
 *   about: the setSource() width/height for render(), the exportFullSize() width/height for
 *   export. If the image had to be downscaled to fit the GPU, they are rescaled internally.
 *   `scaleRenderParams()` (gl/math.ts) converts preview params to full-size params.
 * - Export: a separate offscreen canvas + WebGL2 context runs the same pipeline at full size
 *   (long side capped at min(MAX_TEXTURE_SIZE, renderbuffer/viewport limits, EXPORT_MAX_SIDE = 4096);
 *   larger images are downscaled to fit and this is logged and reported in `lastExport`), then
 *   canvas.toBlob(). The context is released afterwards. No tiling.
 * - Contexts are created with preserveDrawingBuffer: true so the canvas can be read back (drawImage
 *   for side-by-side export, toBlob) at any time; alpha: false (photos are opaque).
 * - webglcontextlost: render() becomes a no-op and a warning is logged; on webglcontextrestored the
 *   pipeline is rebuilt and the last source re-uploaded (if it is still readable).
 */
import type { RenderParams, Renderer } from './types';
import { GLPipeline, type SourceInfo } from './gl/pipeline';
import { EXPORT_MAX_SIDE } from './gl/math';
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
  /** Total time, and the setup (context + upload + pyramid), GPU render and encode parts. */
  ms: number;
  setupMs: number;
  renderMs: number;
  encodeMs: number;
}

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
  exportFullSizeCanvas(image: TexImageSource, width: number, height: number, params: RenderParams): Promise<HTMLCanvasElement>;
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

    exportFullSizeCanvas(image, width, height, params) {
      return runExport(image, width, height, params, async (out) => {
        const copy = document.createElement('canvas');
        copy.width = out.width;
        copy.height = out.height;
        const ctx = copy.getContext('2d');
        if (!ctx) throw new Error('2D canvas is not available.');
        ctx.drawImage(out, 0, 0);
        return copy;
      });
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

  return renderer;
}

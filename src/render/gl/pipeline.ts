// One WebGL2 context's worth of rendering: source + blur pyramid (per source), effect maps and
// missing-area fill (per maps change), and the single effects pass (per render).
import { MAX_SIZE_CHANGE, MAX_SIZE_CHANGE_LENSES } from '../../model/types';
import type { EffectMaps, RenderParams } from '../types';
import { BLUR_FRAG, FILL_COMPOSE_FRAG, FILL_WEIGHT_FRAG, FULLSCREEN_VERT } from '../shaders/common';
import { EFFECTS_FRAG, PYRAMID_LEVEL_COUNT } from '../shaders/effects';
import { BLUR_LEVELS_REF, FILL_BASE_LEVEL, FILL_TOP_LEVEL } from './math';
import {
  GLProgram,
  chooseTargetFormat,
  createTarget,
  createTexture,
  deleteTarget,
  intrinsicSize,
  resampleToCanvas,
  type Target,
  type TargetFormat,
} from './glUtils';
import {
  FILL_SHORT_SIDE_TEXELS,
  FILL_SIGMAS_REF,
  MAX_KERNEL_PAIRS,
  channelHasAny,
  directionVector,
  fitToMaxSide,
  incrementalSigma,
  linearKernel,
  pixelScale,
  planPyramid,
} from './math';

/** Texture unit layout of the effects pass. */
const UNIT_FILL = PYRAMID_LEVEL_COUNT;
const UNIT_MAP_A = PYRAMID_LEVEL_COUNT + 1;
const UNIT_MAP_B = PYRAMID_LEVEL_COUNT + 2;
const UNIT_MAP_C = PYRAMID_LEVEL_COUNT + 3;

export interface SourceInfo {
  /** Size of the uploaded texture (and of the canvas). */
  width: number;
  height: number;
  /** Size the caller declared; pixel coordinates in RenderParams refer to it. */
  declaredWidth: number;
  declaredHeight: number;
  downscaled: boolean;
}

/**
 * Where an uploaded source sits in a larger image (tiled export): its top-left corner (x, y) in
 * the full image's pixels and the full image's size. Effect maps, the fixation point, lenses and
 * the shared fill are all addressed in full-image coordinates; blur sigmas follow the full image.
 */
export interface TileFrame {
  x: number;
  y: number;
  fullWidth: number;
  fullHeight: number;
}

interface FillTargets {
  weight: Target; // also receives the composed result
  temp: Target;
  f: [Target, Target, Target];
}

export class GLPipeline {
  readonly maxTextureSize: number;
  /** Largest side this context can upload and draw (texture, renderbuffer and viewport limits). */
  readonly maxSide: number;
  readonly format: TargetFormat;

  private readonly blurProg: GLProgram;
  private readonly fillWeightProg: GLProgram;
  private readonly fillComposeProg: GLProgram;
  private readonly fxProg: GLProgram;
  private readonly vao: WebGLVertexArrayObject | null;
  private readonly tapBuffer = new Float32Array(MAX_KERNEL_PAIRS * 2);
  private readonly lensA = new Float32Array(MAX_SIZE_CHANGE_LENSES * 4);
  private readonly lensB = new Float32Array(MAX_SIZE_CHANGE_LENSES * 4);
  private readonly pixel = new Uint8Array(4);

  private source: Target | null = null; // texture only; fbo unused but harmless
  private levels: Target[] = [];
  private info: SourceInfo | null = null;
  private tile: TileFrame | null = null;
  /** Missing-area fill built elsewhere (whole image, tiled export); used instead of our own. */
  private externalFill: WebGLTexture | null = null;
  /** Pyramid levels from `from` up, built elsewhere for the whole image (tiled export). */
  private sharedLevels: { from: number; tex: WebGLTexture[] } | null = null;

  private mapA: WebGLTexture;
  private mapB: WebGLTexture;
  private mapC: WebGLTexture;
  private lastMaps: { a: Uint8Array; b: Uint8Array; c: Uint8Array; w: number; h: number } | null = null;
  private hasFillIn = false;
  private fill: FillTargets | null = null;
  private fillDirty = true;

  constructor(readonly gl: WebGL2RenderingContext) {
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const maxRb = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    this.maxTextureSize = maxTex || 4096;
    this.maxSide = Math.min(this.maxTextureSize, maxRb || this.maxTextureSize, vp?.[0] ?? maxTex, vp?.[1] ?? maxTex);
    this.format = chooseTargetFormat(gl);

    this.blurProg = new GLProgram(gl, FULLSCREEN_VERT, BLUR_FRAG, 'blur');
    this.fillWeightProg = new GLProgram(gl, FULLSCREEN_VERT, FILL_WEIGHT_FRAG, 'fillWeight');
    this.fillComposeProg = new GLProgram(gl, FULLSCREEN_VERT, FILL_COMPOSE_FRAG, 'fillCompose');
    this.fxProg = new GLProgram(gl, FULLSCREEN_VERT, EFFECTS_FRAG, 'effects');
    this.vao = gl.createVertexArray();

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    this.mapA = createTexture(gl);
    this.mapB = createTexture(gl);
    this.mapC = createTexture(gl);
    this.uploadMap(this.mapA, 1, 1, new Uint8Array(4));
    this.uploadMap(this.mapB, 1, 1, new Uint8Array(4));
    this.uploadMap(this.mapC, 1, 1, new Uint8Array(4));
  }

  get sourceInfo(): SourceInfo | null {
    return this.info;
  }

  /**
   * Uploads the source (downscaling through a 2D canvas when it exceeds `maxSide`) and rebuilds
   * the blur pyramid. Resizes the context's canvas to the texture size.
   */
  setSource(image: TexImageSource, width: number, height: number, maxSide = this.maxSide, tile?: TileFrame): SourceInfo {
    const gl = this.gl;
    const fit = fitToMaxSide(width, height, Math.min(maxSide, this.maxSide));
    if (tile && fit.downscaled) throw new Error('A tile must fit the GPU without downscaling.');
    const natural = intrinsicSize(image);
    const direct = !fit.downscaled && natural?.width === width && natural.height === height;
    const upload: TexImageSource = direct ? image : resampleToCanvas(image, fit.width, fit.height);

    this.freeSource();
    const tex = createTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, upload);
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('Could not create framebuffer');
    this.source = { tex, fbo, width: fit.width, height: fit.height };
    this.info = {
      width: fit.width,
      height: fit.height,
      declaredWidth: width,
      declaredHeight: height,
      downscaled: fit.width !== width || fit.height !== height,
    };

    const canvas = gl.canvas;
    if (canvas.width !== fit.width) canvas.width = fit.width;
    if (canvas.height !== fit.height) canvas.height = fit.height;

    this.tile = tile ? { ...tile } : null;
    this.buildPyramid();
    this.fillDirty = true;
    return this.info;
  }

  private buildPyramid(): void {
    const src = this.source;
    if (!src) return;
    const t = this.tile;
    const plan = planPyramid(src.width, src.height, BLUR_LEVELS_REF, t ? { width: t.fullWidth, height: t.fullHeight } : undefined);
    this.levels = [src];
    // With shared whole-image levels, only the finer levels are built for this source.
    const count = this.sharedLevels ? Math.min(plan.length, this.sharedLevels.from) : plan.length;
    for (let k = 1; k < count; k++) {
      const p = plan[k];
      const prevPlan = plan[k - 1];
      const input = this.levels[k - 1];
      if (!p || !prevPlan || !input) break;
      const level = createTarget(this.gl, p.width, p.height, this.format);
      this.separableBlur(input, level, p.incrementPx / prevPlan.factor);
      this.levels.push(level);
    }
  }

  /** Two-pass Gaussian from `input` into `output` (sigma in input texels); output may be smaller. */
  private separableBlur(input: Target, output: Target, sigmaTexels: number, temp?: Target): void {
    const gl = this.gl;
    const ownTemp = !temp;
    const t = temp ?? createTarget(gl, output.width, input.height, this.format);
    const k = linearKernel(sigmaTexels);
    const taps = this.tapBuffer;
    taps.fill(0);
    k.offsets.forEach((o, i) => {
      taps[i * 2] = o;
      taps[i * 2 + 1] = k.weights[i] ?? 0;
    });
    const prog = this.blurProg;
    prog.use();
    gl.bindVertexArray(this.vao);
    prog.set1i('uSrc', 0);
    prog.set1f('uCentre', k.centre);
    prog.set1i('uCount', k.offsets.length);
    prog.set4fv('uTaps', taps);
    gl.activeTexture(gl.TEXTURE0);

    // Horizontal: input (w_in x h_in) -> temp (w_out x h_in)
    gl.bindTexture(gl.TEXTURE_2D, input.tex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.width, t.height);
    prog.set2f('uOutSize', t.width, t.height);
    prog.set2f('uStep', 1 / input.width, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Vertical: temp (w_out x h_in) -> output (w_out x h_out)
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, output.fbo);
    gl.viewport(0, 0, output.width, output.height);
    prog.set2f('uOutSize', output.width, output.height);
    prog.set2f('uStep', 0, 1 / t.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (ownTemp) deleteTarget(gl, t);
  }

  private uploadMap(tex: WebGLTexture, w: number, h: number, data: Uint8Array): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  /** Uploads effect maps when the arrays (by identity) or the size changed. */
  private updateMaps(maps: EffectMaps): void {
    const last = this.lastMaps;
    if (
      last &&
      last.a === maps.a &&
      last.b === maps.b &&
      last.c === maps.c &&
      last.w === maps.width &&
      last.h === maps.height
    ) {
      return;
    }
    const n = maps.width * maps.height * 4;
    const valid =
      maps.width > 0 && maps.height > 0 && maps.a.length >= n && maps.b.length >= n && maps.c?.length >= n;
    if (valid) {
      this.uploadMap(this.mapA, maps.width, maps.height, maps.a.subarray(0, n));
      this.uploadMap(this.mapB, maps.width, maps.height, maps.b.subarray(0, n));
      this.uploadMap(this.mapC, maps.width, maps.height, maps.c.subarray(0, n));
      this.hasFillIn = channelHasAny(maps.b.subarray(0, n), 1);
    } else {
      console.warn('[renderer] Invalid effect maps; rendering without effects.', maps.width, maps.height);
      this.uploadMap(this.mapA, 1, 1, new Uint8Array(4));
      this.uploadMap(this.mapB, 1, 1, new Uint8Array(4));
      this.uploadMap(this.mapC, 1, 1, new Uint8Array(4));
      this.hasFillIn = false;
    }
    this.lastMaps = { a: maps.a, b: maps.b, c: maps.c, w: maps.width, h: maps.height };
    this.fillDirty = true;
  }

  /**
   * Uses `tex` (a fill built by takeFill() on the whole image, in the same context) instead of
   * building one from this source. Pass null to go back to building our own.
   */
  setExternalFill(tex: WebGLTexture | null): void {
    this.externalFill = tex;
  }

  /**
   * Uses `textures` (levels from..from + n - 1, built by takeLevels() on the whole image in the same
   * context) instead of building those levels; they are read in whole-image coordinates. Takes
   * effect from the next setSource(). Pass null to build every level again.
   */
  setSharedLevels(from: number, textures: WebGLTexture[] | null): void {
    this.sharedLevels = textures && from < PYRAMID_LEVEL_COUNT ? { from: Math.max(1, from), tex: textures } : null;
  }

  /**
   * Hands over pyramid levels `from` and up of the current source: the caller owns the returned
   * targets (deleteTarget). Build the fill (takeFill) first; it reads these levels.
   */
  takeLevels(from: number): Target[] {
    const k = Math.max(1, from);
    if (k >= this.levels.length) return [];
    const taken = this.levels.slice(k);
    this.levels = this.levels.slice(0, k);
    return taken;
  }

  /**
   * Builds the missing-area fill for `maps` on the current source and hands it over: the caller
   * owns the returned target (deleteTarget) and may use it after this pipeline is disposed.
   * Null when the maps have no missing area.
   */
  takeFill(maps: EffectMaps): Target | null {
    this.updateMaps(maps);
    this.fillDirty = true;
    this.updateFill();
    const fill = this.fill;
    if (!fill || !this.hasFillIn) return null;
    for (const t of [fill.temp, ...fill.f]) deleteTarget(this.gl, t);
    this.fill = null;
    this.fillDirty = true;
    return fill.weight;
  }

  /** Builds the missing-area fill texture (low resolution) from the pyramid and map B. */
  private updateFill(): void {
    if (!this.fillDirty || this.externalFill) return;
    this.fillDirty = false;
    const src = this.source;
    if (!src || !this.hasFillIn) return;
    const gl = this.gl;
    const short = Math.min(src.width, src.height);
    const factor = Math.max(1, short / FILL_SHORT_SIDE_TEXELS);
    const fw = Math.max(1, Math.round(src.width / factor));
    const fh = Math.max(1, Math.round(src.height / factor));
    if (!this.fill || this.fill.weight.width !== fw || this.fill.weight.height !== fh) {
      this.freeFill();
      const mk = () => createTarget(gl, fw, fh, this.format);
      this.fill = { weight: mk(), temp: mk(), f: [mk(), mk(), mk()] };
    }
    const fill = this.fill;
    const base = this.levels[Math.min(FILL_BASE_LEVEL, this.levels.length - 1)] ?? src;
    const top = this.levels[Math.min(FILL_TOP_LEVEL, this.levels.length - 1)] ?? src;

    // Premultiplied colour * validity weight.
    const wp = this.fillWeightProg;
    wp.use();
    gl.bindVertexArray(this.vao);
    wp.set1i('uSrc', 0);
    wp.set1i('uMapB', 1);
    wp.set2f('uOutSize', fw, fh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, base.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.mapB);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fill.weight.fbo);
    gl.viewport(0, 0, fw, fh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Normalised blurs at three growing scales (each built on the previous one).
    const texelPerRef = pixelScale(src.width, src.height) / factor;
    let prevSigma = 0;
    let input = fill.weight;
    FILL_SIGMAS_REF.forEach((ref, i) => {
      const sigma = ref * texelPerRef;
      const out = fill.f[i];
      if (!out) return;
      this.separableBlur(input, out, incrementalSigma(prevSigma, sigma), fill.temp);
      prevSigma = sigma;
      input = out;
    });

    // Compose into fill.weight (no longer needed as input).
    const cp = this.fillComposeProg;
    cp.use();
    gl.bindVertexArray(this.vao);
    cp.set2f('uOutSize', fw, fh);
    const inputs: [string, WebGLTexture][] = [
      ['uF0', fill.f[0].tex],
      ['uF1', fill.f[1].tex],
      ['uF2', fill.f[2].tex],
      ['uBase', top.tex],
    ];
    inputs.forEach(([name, tex], unit) => {
      cp.set1i(name, unit);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, fill.weight.fbo);
    gl.viewport(0, 0, fw, fh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Runs the effects pass into the canvas (default framebuffer). No-op before setSource. */
  render(params: RenderParams): boolean {
    const src = this.source;
    const info = this.info;
    if (!src || !info) return false;
    const gl = this.gl;
    if (!params.bypass) {
      this.updateMaps(params.maps);
      this.updateFill();
    }

    const W = src.width;
    const H = src.height;
    const t = this.tile;
    const fullW = t ? t.fullWidth : W;
    const fullH = t ? t.fullHeight : H;
    const short = Math.min(fullW, fullH);
    const sx = W / info.declaredWidth;
    const sy = H / info.declaredHeight;
    const g = params.globals;

    const p = this.fxProg;
    p.use();
    gl.bindVertexArray(this.vao);
    const shared = this.sharedLevels;
    for (let i = 0; i < PYRAMID_LEVEL_COUNT; i++) {
      const own = this.levels[i];
      const tex = own?.tex ?? (shared ? shared.tex[i - shared.from] : undefined) ?? this.levels[this.levels.length - 1]?.tex ?? src.tex;
      p.set1i(`uL${i}`, i);
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
    }
    p.set1i('uSharedFrom', shared ? shared.from : PYRAMID_LEVEL_COUNT);
    const fillTex = this.externalFill ?? this.fill?.weight.tex ?? null;
    const hasFill = !params.bypass && this.hasFillIn && !!fillTex;
    p.set1i('uFill', UNIT_FILL);
    gl.activeTexture(gl.TEXTURE0 + UNIT_FILL);
    gl.bindTexture(gl.TEXTURE_2D, hasFill && fillTex ? fillTex : src.tex);
    p.set1i('uMapA', UNIT_MAP_A);
    gl.activeTexture(gl.TEXTURE0 + UNIT_MAP_A);
    gl.bindTexture(gl.TEXTURE_2D, this.mapA);
    p.set1i('uMapB', UNIT_MAP_B);
    gl.activeTexture(gl.TEXTURE0 + UNIT_MAP_B);
    gl.bindTexture(gl.TEXTURE_2D, this.mapB);
    p.set1i('uMapC', UNIT_MAP_C);
    gl.activeTexture(gl.TEXTURE0 + UNIT_MAP_C);
    gl.bindTexture(gl.TEXTURE_2D, this.mapC);

    p.set2f('uSize', W, H);
    p.set2f('uOrigin', t ? t.x : 0, t ? t.y : 0);
    p.set2f('uFull', fullW, fullH);
    p.set1i('uFlipY', 1);
    p.set1i('uBypass', params.bypass ? 1 : 0);
    p.set1i('uHasFill', hasFill ? 1 : 0);
    p.set2f('uFix', params.fixation.x * sx, params.fixation.y * sy);
    const [dx, dy] = directionVector(finite(g.distortAngle, 0));
    p.set2f('uWaveDir', dx, dy);
    p.set1f('uWaveLen', Math.max(finite(g.distortWaveSize, 0.05), 1e-4) * short);
    p.set1f('uDistAmp', Math.max(0, finite(g.distortMaxAmplitude, 0)) * short);
    p.set2f('uGhost', finite(g.ghostOffset[0], 0) * short, finite(g.ghostOffset[1], 0) * short);

    let count = 0;
    const sr = Math.sqrt(sx * sy);
    for (const l of params.lenses) {
      if (count >= MAX_SIZE_CHANGE_LENSES) break;
      const amount = Math.min(Math.max(finite(l.amount, 0), -MAX_SIZE_CHANGE), MAX_SIZE_CHANGE);
      if (amount === 0 || !(l.rx > 0) || !(l.ry > 0)) continue;
      const rot = finite(l.rotation, 0);
      this.lensA.set([l.cx * sx, l.cy * sy, 1 / (l.rx * sr), 1 / (l.ry * sr)], count * 4);
      this.lensB.set([Math.cos(rot), Math.sin(rot), amount, Math.min(Math.max(finite(l.feather, 0), 0), 1)], count * 4);
      count++;
    }
    p.set1i('uLensCount', count);
    p.set4fv('uLensA', this.lensA);
    p.set4fv('uLensB', this.lensB);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  /** Blocks until the GPU is done (a 1-pixel readback of the default framebuffer). */
  finish(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel);
  }

  private freeFill(): void {
    const f = this.fill;
    if (!f) return;
    for (const t of [f.weight, f.temp, ...f.f]) deleteTarget(this.gl, t);
    this.fill = null;
  }

  private freeSource(): void {
    const gl = this.gl;
    for (let i = 1; i < this.levels.length; i++) deleteTarget(gl, this.levels[i]);
    this.levels = [];
    deleteTarget(gl, this.source);
    this.source = null;
    this.info = null;
    this.tile = null;
    this.freeFill();
  }

  dispose(): void {
    const gl = this.gl;
    this.freeSource();
    gl.deleteTexture(this.mapA);
    gl.deleteTexture(this.mapB);
    gl.deleteTexture(this.mapC);
    this.blurProg.dispose();
    this.fillWeightProg.dispose();
    this.fillComposeProg.dispose();
    this.fxProg.dispose();
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.lastMaps = null;
  }
}

function finite(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

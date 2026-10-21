// Rendering contract shared by the effect-map builder, the WebGL renderer, the UI and export.
import type { ProfileGlobals } from '../model/types';

/**
 * Three RGBA8 maps of the same size, row-major, top row first. A and B hold effect strengths
 * (layout: EFFECT_MAP_A / EFFECT_MAP_B in model/types; overlaps combine with max). C holds values
 * that are not strengths (v0.2): C.r = dark-spot shade of the strongest dark spot (0 black ..
 * 255 mid grey); C.g, C.b, C.a are reserved and zero.
 */
export interface EffectMaps {
  width: number;
  height: number;
  a: Uint8Array;
  b: Uint8Array;
  c: Uint8Array;
}

/** A size-change lens derived from an ellipse region, in output-image pixels. */
export interface SizeChangeLens {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Radians, clockwise on screen. */
  rotation: number;
  /** -0.3..0.3; negative shrinks, positive enlarges. */
  amount: number;
  /** 0..1 fraction of the ellipse size. */
  feather: number;
}

export interface RenderParams {
  maps: EffectMaps;
  globals: ProfileGlobals;
  lenses: SizeChangeLens[];
  /** Fixation point in source pixels (distortion field is anchored here). */
  fixation: { x: number; y: number };
  /** When true, draw the untouched source (used by flip / compare). */
  bypass?: boolean;
}

export interface Renderer {
  /** The canvas the renderer draws into; sized to the current source. */
  readonly canvas: HTMLCanvasElement;
  /** Uploads a new source image and rebuilds the blur pyramid. */
  setSource(image: TexImageSource, width: number, height: number): void;
  /** Runs the passes and draws the result into `canvas`. Must be fast (< 50 ms at 1024 px). */
  render(params: RenderParams): void;
  /** Renders the full-size original through the same passes with radii scaled; returns a PNG/JPEG blob. */
  exportFullSize(
    image: TexImageSource,
    width: number,
    height: number,
    params: RenderParams,
    type?: 'image/png' | 'image/jpeg',
    quality?: number,
  ): Promise<Blob>;
  /** Largest texture side this device supports. */
  readonly maxTextureSize: number;
  dispose(): void;
}

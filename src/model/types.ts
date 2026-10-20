// Shared data model (contract). Every module builds on these types, so change them
// only from the orchestrator and record the change in docs/development-coding-progress.md.
//
// Coordinates in a profile are relative to the fixation point and measured in units of
// the image's shorter side; +x is right and +y is down (screen convention).

export const PROFILE_VERSION = 1;

/** Blur strengths are stored in pixels at this reference shorter side and scaled at render time. */
export const BLUR_REFERENCE_SHORT_SIDE = 768;
export const MAX_BLUR_PX = 40;
export const MAX_SIZE_CHANGE = 0.3;
/** Size change is applied per ellipse as a shader uniform, so only this many are honoured. */
export const MAX_SIZE_CHANGE_LENSES = 8;
export const UNDO_LIMIT = 100;

export type Eye = 'left' | 'right';

export interface Vec2 {
  x: number;
  y: number;
}

/** Per-region effect strengths. All start at zero; a region only shows effects that are non-zero. */
export interface Effects {
  /** 0..MAX_BLUR_PX, in pixels at BLUR_REFERENCE_SHORT_SIDE. */
  blur: number;
  /** Dark patch opacity 0..1 (shade comes from globals.darkSpotShade). */
  darkSpot: number;
  /** "Missing area": surrounding texture smeared across, 0..1. */
  fillIn: number;
  /** Distortion (metamorphopsia) amplitude 0..1, scaled by globals.distortMaxAmplitude. */
  distortion: number;
  /** -MAX_SIZE_CHANGE..+MAX_SIZE_CHANGE; negative shrinks, positive enlarges. Ellipses only. */
  sizeChange: number;
  contrastLoss: number;
  dimming: number;
  colourFade: number;
  /** Ghost image opacity 0..1 (offset comes from globals.ghostOffset). */
  doubleImage: number;
}

export type EffectKey = keyof Effects;

export interface EllipseShape {
  type: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Degrees, clockwise on screen. */
  rotation: number;
}

/** Closed freehand outline. */
export interface PathShape {
  type: 'path';
  points: [number, number][];
}

/** Painted mask: a greyscale PNG (white = full strength) placed over a rectangle. */
export interface MaskShape {
  type: 'mask';
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FullShape {
  type: 'full';
}

export type Shape = EllipseShape | PathShape | MaskShape | FullShape;
export type ShapeType = Shape['type'];

export interface Region {
  id: string;
  name: string;
  visible: boolean;
  shape: Shape;
  /** Soft edge, 0..1 as a fraction of the region's size. */
  feather: number;
  effects: Effects;
}

/** Profile-wide settings that keep the shaders simple; regions only control strength. */
export interface ProfileGlobals {
  /** Wavelength of the distortion field, in shorter-side units. */
  distortWaveSize: number;
  /** Direction of the distortion waves, degrees. */
  distortAngle: number;
  /** Displacement at distortion = 1, in shorter-side units. */
  distortMaxAmplitude: number;
  /** Ghost offset in shorter-side units. */
  ghostOffset: [number, number];
  /** Dark spot colour: 0 = black, 1 = mid grey. */
  darkSpotShade: number;
}

export interface Profile {
  version: number;
  id: string;
  name: string;
  eye: Eye;
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
  viewingDistanceCm: number;
  note: string;
  globals: ProfileGlobals;
  regions: Region[];
}

/** Where the profile is applied: an image plus the fixation point in that image's pixels. */
export interface ImageFrame {
  width: number;
  height: number;
  fixation: Vec2;
}

/**
 * Effect-map channel layout (RGBA8, 0..255 = strength 0..1, overlaps combine with max).
 * blur is stored as blur / MAX_BLUR_PX. sizeChange is not in the maps (uniforms instead).
 */
export const EFFECT_MAP_A: readonly EffectKey[] = ['blur', 'distortion', 'contrastLoss', 'dimming'];
export const EFFECT_MAP_B: readonly EffectKey[] = ['darkSpot', 'fillIn', 'colourFade', 'doubleImage'];

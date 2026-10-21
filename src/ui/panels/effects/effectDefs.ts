// Pure description of the effect sliders (ranges, units, help text) and which ones apply to a
// region shape. Ranges follow the comments in src/model/types.ts and F4 of the plan.

import { MAX_BLUR_PX, MAX_SIZE_CHANGE, type EffectKey, type ProfileGlobals, type ShapeType } from '../../../model/types';

export interface SliderDef {
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** Multiplier from stored value to displayed value. */
  scale: number;
  signed?: boolean;
  help: string;
}

export interface EffectDef extends SliderDef {
  key: EffectKey;
}

const PERCENT = { min: 0, max: 1, step: 0.01, unit: '%', scale: 100 } as const;

export const EFFECT_DEFS: Record<EffectKey, EffectDef> = {
  blur: {
    key: 'blur',
    label: 'Blur',
    min: 0,
    max: MAX_BLUR_PX,
    step: 0.5,
    unit: 'px',
    scale: 1,
    help: 'Things look out of focus, like a smudged lens.',
  },
  doubleImage: {
    key: 'doubleImage',
    label: 'Double image',
    ...PERCENT,
    help: 'A faint ghost copy next to the real picture. Set the offset under Profile settings.',
  },
  darkSpot: {
    key: 'darkSpot',
    label: 'Dark spot',
    ...PERCENT,
    help: 'A dark patch where nothing can be seen.',
  },
  fillIn: {
    key: 'fillIn',
    label: 'Missing area',
    ...PERCENT,
    help: 'A gap your brain fills in with the surroundings, so no dark patch shows.',
  },
  distortion: {
    key: 'distortion',
    label: 'Distortion',
    ...PERCENT,
    help: 'Straight lines look wavy or bent.',
  },
  sizeChange: {
    key: 'sizeChange',
    label: 'Size change',
    min: -MAX_SIZE_CHANGE,
    max: MAX_SIZE_CHANGE,
    step: 0.01,
    unit: '%',
    scale: 100,
    signed: true,
    help: 'Objects look smaller (minus) or bigger (plus) inside the spot.',
  },
  contrastLoss: {
    key: 'contrastLoss',
    label: 'Contrast loss',
    ...PERCENT,
    help: 'Washed-out, foggy look.',
  },
  dimming: {
    key: 'dimming',
    label: 'Dimming',
    ...PERCENT,
    help: 'Everything looks darker.',
  },
  colourFade: {
    key: 'colourFade',
    label: 'Colour fade',
    ...PERCENT,
    help: 'Colours look weaker and greyer.',
  },
};

export interface EffectGroup {
  id: 'sharpness' | 'spots' | 'shape' | 'tone';
  title: string;
  keys: readonly EffectKey[];
}

export const EFFECT_GROUPS: readonly EffectGroup[] = [
  { id: 'sharpness', title: 'Sharpness', keys: ['blur', 'doubleImage'] },
  { id: 'spots', title: 'Spots', keys: ['darkSpot', 'fillIn'] },
  { id: 'shape', title: 'Shape', keys: ['distortion', 'sizeChange'] },
  { id: 'tone', title: 'Tone', keys: ['contrastLoss', 'dimming', 'colourFade'] },
];

/** Every effect key, in group order. */
export const EFFECT_ORDER: readonly EffectKey[] = EFFECT_GROUPS.flatMap((g) => g.keys);

/** Size change is applied per ellipse (a lens in the shader), so only ellipses support it. */
export function isEffectEnabled(key: EffectKey, shape: ShapeType): boolean {
  if (key === 'sizeChange') return shape === 'ellipse';
  return true;
}

/** A whole-image region has no edge, so feathering means nothing there. */
export function isFeatherEnabled(shape: ShapeType): boolean {
  return shape !== 'full' && shape !== 'mask';
}

export const SIZE_CHANGE_NOTE = 'Size change works on spots (ellipses) only.';
export const FEATHER_FULL_NOTE = 'A whole-image region has no edge to soften.';
export const FEATHER_MASK_NOTE = 'A brush region is softened with the brush softness setting, not here.';

/** Why the feather slider is off for this shape. */
export const featherNote = (shape: ShapeType): string => (shape === 'mask' ? FEATHER_MASK_NOTE : FEATHER_FULL_NOTE);

export const FEATHER_DEF: SliderDef = {
  label: 'Soft edge (feather)',
  min: 0,
  max: 1,
  step: 0.01,
  unit: '%',
  scale: 100,
  help: '0% is a sharp edge; 100% fades out smoothly across the whole region.',
};

export type NumericGlobalKey = Exclude<keyof ProfileGlobals, 'ghostOffset'>;

export const GLOBAL_DEFS: Record<NumericGlobalKey, SliderDef> = {
  distortWaveSize: {
    label: 'Distortion wave size',
    min: 0.01,
    max: 0.2,
    step: 0.005,
    unit: '%',
    scale: 100,
    help: 'Distance between ripples, as a share of the picture’s shorter side.',
  },
  distortAngle: {
    label: 'Wave direction',
    min: 0,
    max: 180,
    step: 1,
    unit: '°',
    scale: 1,
    help: 'Which way the ripples run.',
  },
  distortMaxAmplitude: {
    label: 'Max distortion',
    min: 0,
    max: 0.05,
    step: 0.001,
    unit: '%',
    scale: 100,
    help: 'How far lines bend when Distortion is at 100%.',
  },
  darkSpotShade: {
    label: 'Dark spot shade',
    min: 0,
    max: 1,
    step: 0.01,
    unit: '%',
    scale: 100,
    help: '0% is black; higher is a greyer patch.',
  },
};

export const GHOST_DEF: SliderDef = {
  label: 'Ghost offset',
  min: -0.05,
  max: 0.05,
  step: 0.001,
  unit: '%',
  scale: 100,
  signed: true,
  help: 'Where the double image sits, as a share of the picture’s shorter side.',
};

export const VIEWING_DISTANCE_DEF: SliderDef = {
  label: 'Viewing distance',
  min: 10,
  max: 600,
  step: 1,
  unit: 'cm',
  scale: 1,
  help: 'How far your eye is from the screen. Sizes depend on it.',
};

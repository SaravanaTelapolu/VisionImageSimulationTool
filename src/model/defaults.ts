import { DEFAULT_VIEWING_DISTANCE_CM } from './distance';
import { PROFILE_VERSION, type Effects, type Profile, type ProfileGlobals, type Region, type Shape } from './types';

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export function emptyEffects(): Effects {
  return {
    blur: 0,
    darkSpot: 0,
    fillIn: 0,
    distortion: 0,
    sizeChange: 0,
    contrastLoss: 0,
    dimming: 0,
    colourFade: 0,
    doubleImage: 0,
  };
}

export function defaultGlobals(): ProfileGlobals {
  return {
    distortWaveSize: 0.05,
    distortAngle: 30,
    distortMaxAmplitude: 0.008,
    ghostOffset: [0.01, 0],
    darkSpotShade: 0,
  };
}

export function newRegion(shape: Shape, name = 'Region'): Region {
  return { id: newId('r'), name, visible: true, shape, feather: 0.3, effects: emptyEffects() };
}

export function defaultEllipse(): Shape {
  return { type: 'ellipse', cx: 0, cy: 0, rx: 0.12, ry: 0.09, rotation: 0 };
}

export function newProfile(
  name = 'Right eye',
  now = new Date(),
  viewingDistanceCm = DEFAULT_VIEWING_DISTANCE_CM,
): Profile {
  const iso = now.toISOString();
  return {
    version: PROFILE_VERSION,
    id: newId('p'),
    name,
    eye: 'right',
    createdAt: iso,
    updatedAt: iso,
    viewingDistanceCm,
    note: '',
    globals: defaultGlobals(),
    regions: [],
  };
}

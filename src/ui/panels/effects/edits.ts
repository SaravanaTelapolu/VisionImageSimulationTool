// Pure profile edits used by the Effects panel. Each returns the same Profile object when the
// edit would change nothing, so applyEdit() records no undo step for a no-op.

import { withEye } from '../../../model/eye';
import { updateEffects, updateGlobals, updateRegion, findRegion } from '../../../model/ops';
import type { EffectKey, Eye, Profile } from '../../../model/types';
import { clamp } from '../../controls/format';
import { EFFECT_DEFS, FEATHER_DEF, GHOST_DEF, GLOBAL_DEFS, VIEWING_DISTANCE_DEF, type NumericGlobalKey } from './effectDefs';

export function setEffect(profile: Profile, regionId: string, key: EffectKey, value: number): Profile {
  const region = findRegion(profile, regionId);
  if (!region) return profile;
  const def = EFFECT_DEFS[key];
  const v = clamp(value, def.min, def.max);
  if (region.effects[key] === v) return profile;
  return updateEffects(profile, regionId, { [key]: v });
}

export function setFeather(profile: Profile, regionId: string, value: number): Profile {
  const region = findRegion(profile, regionId);
  if (!region) return profile;
  const v = clamp(value, FEATHER_DEF.min, FEATHER_DEF.max);
  if (region.feather === v) return profile;
  return updateRegion(profile, regionId, { feather: v });
}

export function setGlobal(profile: Profile, key: NumericGlobalKey, value: number): Profile {
  const def = GLOBAL_DEFS[key];
  const v = clamp(value, def.min, def.max);
  if (profile.globals[key] === v) return profile;
  return updateGlobals(profile, { [key]: v });
}

export function setGhostOffset(profile: Profile, axis: 0 | 1, value: number): Profile {
  const v = clamp(value, GHOST_DEF.min, GHOST_DEF.max);
  const cur = profile.globals.ghostOffset;
  if (cur[axis] === v) return profile;
  const next: [number, number] = [cur[0], cur[1]];
  next[axis] = v;
  return updateGlobals(profile, { ghostOffset: next });
}

export function setViewingDistance(profile: Profile, cm: number): Profile {
  const v = clamp(Math.round(cm), VIEWING_DISTANCE_DEF.min, VIEWING_DISTANCE_DEF.max);
  return profile.viewingDistanceCm === v ? profile : { ...profile, viewingDistanceCm: v };
}

export function setEye(profile: Profile, eye: Eye): Profile {
  return withEye(profile, eye); // an automatic name ("Left eye") follows the eye
}

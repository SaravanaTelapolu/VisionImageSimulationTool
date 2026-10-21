import type { Eye } from '../../model/types';
import { STEP_COUNT } from './calibrationSteps';

/** All eye names in the guide come from here; never hard-code "left"/"right" elsewhere. */

export function otherEye(eye: Eye): Eye {
  return eye === 'right' ? 'left' : 'right';
}

/** "right eye" / "left eye". */
export function eyeName(eye: Eye): string {
  return `${eye} eye`;
}

/** "Right eye" / "Left eye", for sentence starts. */
export function eyeNameCapitalised(eye: Eye): string {
  const name = eyeName(eye);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The eye to cover while looking with the affected one. */
export function goodEyeName(affected: Eye): string {
  return eyeName(otherEye(affected));
}

export function stepIndicator(stepIndex: number): string {
  const n = Math.min(STEP_COUNT, Math.max(1, Math.trunc(stepIndex) + 1));
  return `Step ${n} of ${STEP_COUNT}`;
}

export const MIN_DISTANCE_CM = 10;
export const MAX_DISTANCE_CM = 600;
export const DEFAULT_DISTANCE_CM = 40;

/** Parse a distance typed by the user; null when not a usable number. */
export function parseDistanceCm(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  if (value < MIN_DISTANCE_CM || value > MAX_DISTANCE_CM) return null;
  return Math.round(value * 10) / 10;
}

export const SYMPTOMS = [
  'blurred',
  'dark',
  'missing',
  'wavy',
  'smaller or larger',
  'faded',
  'doubled',
] as const;

export const APPROXIMATION_NOTE =
  'This is your own approximation, not a clinical measurement. It helps you show what you see; it does not diagnose anything.';

export const DISTANCE_TIP =
  'To measure: hold a string or tape measure from the phone screen to your eye, or measure from the screen to your cheekbone and add about 2 cm.';

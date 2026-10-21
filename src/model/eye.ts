import type { Eye, Profile } from './types';

/**
 * The technical fallback eye, used only where nothing was chosen yet (the very first blank profile
 * before the user answers, and files that lack the field). The real default comes from the
 * `defaultEye` setting in state/profiles.ts.
 */
export const FALLBACK_EYE: Eye = 'right';

export const EYES: readonly Eye[] = ['left', 'right'];

export function isEye(v: unknown): v is Eye {
  return v === 'left' || v === 'right';
}

/** "Left eye" / "Right eye". */
export function eyeLabel(eye: Eye): string {
  return eye === 'left' ? 'Left eye' : 'Right eye';
}

/** The automatic profile name for an eye: "Left eye" / "Right eye". */
export function autoProfileName(eye: Eye): string {
  return eyeLabel(eye);
}

/** A check-up copy's date suffix, as added by storage duplicateAsCheckup(): " — yyyy-mm-dd". */
const CHECKUP_SUFFIX = /^ — \d{4}-\d{2}-\d{2}$/;

/**
 * True when `name` is the automatic name for `eye` ("Right eye"), optionally with a check-up date
 * suffix ("Right eye — 2026-10-20"). A name the user typed (anything else) is false.
 */
export function isAutoProfileName(name: string, eye: Eye): boolean {
  const auto = autoProfileName(eye);
  if (!name.startsWith(auto)) return false;
  const rest = name.slice(auto.length);
  return rest === '' || CHECKUP_SUFFIX.test(rest);
}

/**
 * The name after the eye changes from `from` to `to`: the automatic name for `from` becomes the one
 * for `to` (a check-up date suffix is kept); any other name is kept as typed.
 */
export function renameAutoForEye(name: string, from: Eye, to: Eye): string {
  if (from === to || !isAutoProfileName(name, from)) return name;
  return autoProfileName(to) + name.slice(autoProfileName(from).length);
}

/** The profile with another affected eye; an automatic name follows the eye, a typed name never changes. */
export function withEye(profile: Profile, eye: Eye): Profile {
  if (profile.eye === eye) return profile;
  return { ...profile, eye, name: renameAutoForEye(profile.name, profile.eye, eye) };
}

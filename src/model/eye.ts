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

/** Matches an automatic name: "Left eye" / "Right eye", optionally followed by a check-up date " — yyyy-mm-dd". */
const AUTO_NAME = /^(Left|Right) eye( — \d{4}-\d{2}-\d{2})?$/;

/** True when the name is one the app made (not typed by the user). */
export function isAutoProfileName(name: string): boolean {
  return AUTO_NAME.test(name);
}

/** The same automatic name for another eye ("Right eye — 2026-10-20" becomes "Left eye — 2026-10-20"); other names are kept. */
export function renameAutoForEye(name: string, eye: Eye): string {
  const m = AUTO_NAME.exec(name);
  return m ? `${eyeLabel(eye)}${m[2] ?? ''}` : name;
}

/** The profile with another affected eye; an automatic name follows the eye, a typed name never changes. */
export function withEye(profile: Profile, eye: Eye): Profile {
  if (profile.eye === eye) return profile;
  return { ...profile, eye, name: renameAutoForEye(profile.name, eye) };
}

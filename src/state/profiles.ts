// Saved-profile state and actions: signals plus functions over the storage module.
// The store (state/store.ts) owns the *current* profile; this module saves, opens, duplicates,
// deletes, exports and imports profiles, and tracks whether the current one has unsaved changes.
import { computed, signal } from '@preact/signals';
import { newProfile as makeNewProfile } from '../model/defaults';
import { DEFAULT_VIEWING_DISTANCE_CM, sanitizeDefaultDistance } from '../model/distance';
import { FALLBACK_EYE, isEye, renameAutoForEye, withEye } from '../model/eye';
import type { Eye, Profile } from '../model/types';
import { shareOrDownload } from '../export/share';
import {
  ProfileNotFoundError,
  StorageUnavailableError,
  deleteProfile,
  duplicateAsCheckup,
  getPhoto,
  getProfile,
  getSetting,
  importProfilesFromFile,
  listProfiles,
  profileToJsonBlob,
  profilesToBundleBlob,
  requestPersistentStorage,
  savePhoto,
  saveProfile,
  setSetting,
  type ProfileSummary,
} from '../storage';
import { activityCount, applyEdit, endEdit, image, loadPhoto, profile, resetProfile } from './store';

export const LAST_PROFILE_KEY = 'lastProfileId';
export const DEFAULT_DISTANCE_KEY = 'defaultViewingDistanceCm';
export const DEFAULT_EYE_KEY = 'defaultEye';

// --- Signals ------------------------------------------------------------------------------

/** Saved profiles, newest first. Call refreshList() to update. */
export const profileList = signal<ProfileSummary[]>([]);
/** Friendly message when storage failed (for example private browsing); '' when all is well. */
export const storageError = signal('');
/** Short success/info message for the last action ("Saved", "Imported 2 profiles."); '' when none. */
export const notice = signal('');
/** True while a storage action is running (the UI disables its buttons). */
export const busy = signal(false);
/** Whether the current profile has a photo saved with it. */
export const currentPhotoSaved = signal(false);

/**
 * Whether the browser agreed to keep saved profiles (persistent storage): null until asked, which
 * happens once, after the first successful save. The UI may show "Saved on this device — export a
 * backup file" either way; when false, a backup export is the only protection against eviction.
 */
export const persistentStorage = signal<boolean | null>(null);
let persistAsked = false;

/**
 * Viewing distance (cm) given to new profiles: the saved setting, 40 until it has loaded. Changed
 * with setDefaultDistance(); loaded from storage by loadDefaultDistance() (restoreLastProfile does it).
 */
export const defaultDistanceCm = signal<number>(DEFAULT_VIEWING_DISTANCE_CM);

/**
 * The affected eye given to new profiles: the saved setting, FALLBACK_EYE ('right') until one is
 * known. Changed with setDefaultEye() (the first setCurrentEye() also sets it); loaded from storage by
 * loadDefaultEye() (restoreLastProfile does it).
 */
export const defaultEye = signal<Eye>(FALLBACK_EYE);
/**
 * Whether an eye is known for this user: a saved default, a restored profile, or a choice made this
 * session. While false the first-run empty state asks "Which eye do you want to simulate?".
 */
export const eyeChosen = signal(false);

/**
 * Fingerprint of the current profile as last saved/opened/created (updatedAt ignored), or null when
 * there is nothing to compare with (for example right after its saved copy was deleted).
 */
const baseline = signal<string | null>(profileFingerprint(profile.peek()));

/** Everything about a profile except updatedAt, so edits and undo back to the saved state compare equal. */
export function profileFingerprint(p: Profile): string {
  return JSON.stringify({ ...p, updatedAt: '' });
}

/** The current profile differs from its last saved/opened state. */
export const dirty = computed(() => baseline.value === null || baseline.value !== profileFingerprint(profile.value));

/** The current profile exists in storage (per the last refreshList). */
export const currentIsSaved = computed(() => profileList.value.some((s) => s.id === profile.value.id));

// --- Helpers ------------------------------------------------------------------------------

export function describeError(e: unknown): string {
  if (e instanceof StorageUnavailableError || e instanceof ProfileNotFoundError) return e.message;
  return 'Something went wrong. Your work on screen is unaffected; try again or export it to a file.';
}

function fail(e: unknown): void {
  storageError.value = describeError(e);
  notice.value = '';
}

function ok(message = ''): void {
  storageError.value = '';
  notice.value = message;
}

/** Runs a storage action with the busy flag; failures become storageError and `fallback`. */
async function guarded<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
  busy.value = true;
  try {
    return await fn();
  } catch (e) {
    fail(e);
    return fallback;
  } finally {
    busy.value = false;
  }
}

async function rememberLast(id: string): Promise<void> {
  try {
    await setSetting(LAST_PROFILE_KEY, id);
  } catch {
    // remembering the last profile is a convenience only
  }
}

/** Asks the browser once per session to keep this origin's storage, after a profile was saved. */
function askPersistOnce(): void {
  if (persistAsked) return;
  persistAsked = true;
  void requestPersistentStorage().then(
    (granted) => {
      persistentStorage.value = granted;
    },
    () => {
      persistentStorage.value = false;
    },
  );
}

async function readList(): Promise<void> {
  profileList.value = await listProfiles();
}

// --- Actions ------------------------------------------------------------------------------

/** Reloads the list of saved profiles. Returns false (and sets storageError) on failure. */
export async function refreshList(): Promise<boolean> {
  return guarded(false, async () => {
    await readList();
    storageError.value = '';
    return true;
  });
}

/** All saved profiles in full (for the timeline). Empty list (and storageError) on failure. */
export async function loadAllProfiles(): Promise<Profile[]> {
  return guarded<Profile[]>([], async () => {
    const found = await Promise.all((await listProfiles()).map((s) => getProfile(s.id)));
    return found.filter((p): p is Profile => p !== undefined);
  });
}

/** Saves the current profile and remembers it as the last one. Returns the stored profile or null. */
export async function saveCurrent(): Promise<Profile | null> {
  return guarded<Profile | null>(null, async () => {
    const snapshot = profile.value;
    const stored = await saveProfile(snapshot);
    askPersistOnce();
    baseline.value = profileFingerprint(snapshot);
    await rememberLast(stored.id);
    await readList();
    ok('Saved.');
    return stored;
  });
}

/**
 * Loads a saved profile into the editor (undo history is cleared) plus its saved photo, if any.
 * With `ifUntouchedSince` (an activityCount() value) it gives up, changing nothing, when the user
 * edited or loaded anything after that moment.
 */
export async function openProfile(id: string, opts: { ifUntouchedSince?: number } = {}): Promise<boolean> {
  const opened = await guarded<{ p: Profile; hasPhoto: boolean; photo: File | null } | null>(null, async () => {
    const p = await getProfile(id);
    if (!p) {
      await readList();
      throw new ProfileNotFoundError(id);
    }
    let photo: File | null = null;
    let hasPhoto = false;
    try {
      const rec = await getPhoto(id);
      if (rec) {
        hasPhoto = true;
        photo = new File([rec.blob], rec.name, { type: rec.type });
      }
    } catch {
      // the profile itself opened; a missing photo is not fatal
    }
    return { p, hasPhoto, photo };
  });
  if (!opened) return false;
  if (opts.ifUntouchedSince !== undefined && activityCount() !== opts.ifUntouchedSince) return false;
  resetProfile(opened.p);
  baseline.value = profileFingerprint(opened.p);
  currentPhotoSaved.value = opened.hasPhoto;
  ok(`Opened "${opened.p.name}".`);
  void rememberLast(opened.p.id);
  if (opened.photo) await loadPhoto(opened.photo);
  return true;
}

/** Reads the default viewing distance setting into defaultDistanceCm (40 when unset or unreadable). */
export async function loadDefaultDistance(): Promise<number> {
  const v = sanitizeDefaultDistance(await getSetting<unknown>(DEFAULT_DISTANCE_KEY, DEFAULT_VIEWING_DISTANCE_CM));
  defaultDistanceCm.value = v;
  return v;
}

/** Sets and stores the default viewing distance for new profiles (rounded, clamped to 10-600 cm). */
export async function setDefaultDistance(cm: number): Promise<number> {
  const v = sanitizeDefaultDistance(cm);
  defaultDistanceCm.value = v;
  try {
    await setSetting(DEFAULT_DISTANCE_KEY, v);
  } catch (e) {
    fail(e);
  }
  return v;
}

/** Reads the default eye setting into defaultEye / eyeChosen. Returns the saved eye, or null when none was saved. */
export async function loadDefaultEye(): Promise<Eye | null> {
  const v = await getSetting<unknown>(DEFAULT_EYE_KEY, null);
  if (!isEye(v)) return null;
  if (eyeChosen.peek()) return defaultEye.peek(); // the user chose meanwhile; their choice wins
  defaultEye.value = v;
  eyeChosen.value = true;
  return v;
}

/** Sets and stores the eye new profiles start with. Does not touch the current profile. */
export async function setDefaultEye(eye: Eye): Promise<void> {
  defaultEye.value = eye;
  eyeChosen.value = true;
  try {
    await setSetting(DEFAULT_EYE_KEY, eye);
  } catch (e) {
    fail(e);
  }
}

/**
 * Sets the affected eye of the current profile (one undo step). An automatic name ("Right eye")
 * follows the eye; a name the user typed is kept. The very first choice (no default eye known yet)
 * also becomes the default for new profiles; after that the default changes only in Settings.
 */
export function setCurrentEye(eye: Eye): void {
  const first = !eyeChosen.peek();
  if (profile.peek().eye !== eye) {
    const untouchedBlank = !dirty.peek() && !currentIsSaved.peek();
    endEdit();
    applyEdit((p) => withEye(p, eye));
    endEdit();
    // A blank, never-saved profile is not "unsaved work": choosing the eye should not make it so.
    if (untouchedBlank) baseline.value = profileFingerprint(profile.peek());
  }
  if (first) void setDefaultEye(eye);
}

/** Starts an empty profile at the default viewing distance and eye (the current photo stays). Unsaved changes are discarded. */
export function newProfile(name?: string): Profile {
  const p = makeNewProfile(name, new Date(), defaultDistanceCm.peek(), defaultEye.peek());
  resetProfile(p);
  baseline.value = profileFingerprint(p);
  currentPhotoSaved.value = false;
  ok();
  return p;
}

/** Saves the current profile, then opens a dated copy of it for a new check-up. */
export async function duplicateCurrentAsCheckup(): Promise<Profile | null> {
  const saved = await saveCurrent();
  if (!saved) return null;
  return guarded<Profile | null>(null, async () => {
    const copy = await duplicateAsCheckup(saved.id, new Date());
    resetProfile(copy);
    baseline.value = profileFingerprint(copy);
    currentPhotoSaved.value = false;
    await rememberLast(copy.id);
    await readList();
    ok(`Created "${copy.name}".`);
    return copy;
  });
}

/** Duplicates a saved profile (not the one on screen) as a new check-up, without opening it. */
export async function duplicateProfileById(id: string): Promise<Profile | null> {
  return guarded<Profile | null>(null, async () => {
    const copy = await duplicateAsCheckup(id, new Date());
    await readList();
    ok(`Created "${copy.name}".`);
    return copy;
  });
}

/** Renames the current profile (an undoable edit). Blank names are ignored. */
export function renameCurrent(name: string): boolean {
  const next = name.trim();
  if (next === '') return false;
  // One rename is one undo step: never coalesce, and end any run so the next rename starts fresh.
  endEdit();
  applyEdit((p) => (p.name === next ? p : { ...p, name: next }));
  endEdit();
  return true;
}

/**
 * Deletes a saved profile and its photo. If it is the one on screen, it stays in the editor as an
 * unsaved profile.
 */
export async function deleteProfileById(id: string): Promise<boolean> {
  return guarded(false, async () => {
    await deleteProfile(id);
    if (id === profile.peek().id) {
      baseline.value = null;
      currentPhotoSaved.value = false;
    }
    try {
      if ((await getSetting<string | null>(LAST_PROFILE_KEY, null)) === id) await setSetting(LAST_PROFILE_KEY, '');
    } catch {
      // convenience only
    }
    await readList();
    ok('Deleted.');
    return true;
  });
}

export type ExportOutcome = 'shared' | 'downloaded' | 'cancelled' | 'empty' | 'error';

async function shareFile(file: { blob: Blob; filename: string }, title: string): Promise<ExportOutcome> {
  try {
    const r = await shareOrDownload([{ blob: file.blob, name: file.filename }], title);
    if (r === 'cancelled') ok();
    else ok(r === 'shared' ? 'Shared.' : `Downloaded ${file.filename}.`);
    return r;
  } catch (e) {
    fail(e);
    return 'error';
  }
}

/** Exports the profile on screen (including unsaved edits) as a JSON file. */
export async function exportCurrentJson(): Promise<ExportOutcome> {
  return shareFile(profileToJsonBlob(profile.value), `Eye map: ${profile.value.name}`);
}

/** Exports one saved profile as a JSON file. */
export async function exportProfileById(id: string): Promise<ExportOutcome> {
  return guarded<ExportOutcome>('error', async () => {
    const p = await getProfile(id);
    if (!p) throw new ProfileNotFoundError(id);
    return shareFile(profileToJsonBlob(p), `Eye map: ${p.name}`);
  });
}

/** Exports every saved profile as one bundle JSON file. */
export async function exportAllJson(): Promise<ExportOutcome> {
  return guarded<ExportOutcome>('error', async () => {
    const all = await Promise.all((await listProfiles()).map((s) => getProfile(s.id)));
    const profiles = all.filter((p): p is Profile => p !== undefined);
    if (profiles.length === 0) {
      ok();
      notice.value = 'There are no saved profiles to export yet.';
      return 'empty';
    }
    return shareFile(profilesToBundleBlob(profiles), 'Eye maps');
  });
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Imports profiles from a chosen JSON file, saves them, and returns a message for the user. */
export async function importJsonFile(file: Blob): Promise<string> {
  let message = '';
  await guarded(undefined, async () => {
    const existing = new Set((await listProfiles()).map((s) => s.id));
    const result = await importProfilesFromFile(file, existing);
    for (const p of result.imported) {
      const when = new Date(p.updatedAt); // keep the file's updatedAt
      await saveProfile(p, Number.isNaN(when.getTime()) ? new Date() : when);
    }
    await readList();

    const n = result.imported.length;
    const problems = result.errors.slice(0, 3).join(' ');
    const warn = result.warnings.slice(0, 2).join(' ');
    if (n === 0) {
      message = `Nothing was imported. ${problems || 'The file has no profiles.'}`.trim();
      storageError.value = '';
      notice.value = message;
      return;
    }
    message = `Imported ${plural(n, 'profile', 'profiles')}.`;
    if (result.errors.length > 0) message += ` Some profiles were skipped: ${problems}`;
    if (warn) message += ` ${warn}`;
    ok(message);
  });
  return message || storageError.value;
}

/** Saves the photo on screen with the current profile (saving the profile first). */
export async function savePhotoWithCurrent(): Promise<boolean> {
  const photo = image.peek();
  if (!photo?.original) {
    storageError.value = '';
    notice.value = 'Only photos you opened from a file can be saved with a profile.';
    return false;
  }
  const saved = await saveCurrent();
  if (!saved) return false;
  return guarded(false, async () => {
    await savePhoto(saved.id, photo.original as File, photo.name);
    currentPhotoSaved.value = true;
    ok('Saved with its photo.');
    return true;
  });
}

/** Call once on startup: refreshes the list and re-opens the profile used last time, if it still exists. */
export async function restoreLastProfile(): Promise<boolean> {
  // The storage reads below are slow on a cold start; if the user edits or loads anything meanwhile,
  // the restore is dropped rather than overwriting their work.
  const since = activityCount();
  const cm = await loadDefaultDistance(); // also keeps new profiles on the setting when one is restored
  const eye = await loadDefaultEye();
  const restored = await restoreSaved(since);
  if (restored) {
    // Someone with a saved profile has already chosen an eye; new profiles follow the last one used.
    if (eye === null && !eyeChosen.peek()) {
      defaultEye.value = profile.peek().eye;
      eyeChosen.value = true;
    }
  } else {
    applyDefaultsIfPristine(cm, eye, since);
  }
  return restored;
}

/**
 * When nothing was restored and the user has not touched anything since the restore began (activityCount() === since), the blank starting
 * profile takes the default viewing distance and eye settings (which have only just loaded).
 */
function applyDefaultsIfPristine(cm: number, eye: Eye | null, since: number): void {
  if (activityCount() !== since) return;
  const cur = profile.peek();
  const nextEye = eye ?? cur.eye;
  if (cur.viewingDistanceCm === cm && cur.eye === nextEye) return;
  const p = { ...withEye(cur, nextEye), viewingDistanceCm: cm };
  resetProfile(p);
  baseline.value = profileFingerprint(p);
}

async function restoreSaved(since: number): Promise<boolean> {
  const listed = await refreshList();
  if (!listed) return false;
  const id = await getSetting<string | null>(LAST_PROFILE_KEY, null);
  if (!id || !profileList.value.some((s) => s.id === id)) return false;
  if (activityCount() !== since) return false;
  return openProfile(id, { ifUntouchedSince: since });
}

/** Test helper: resets this module's state (the store and storage are reset by the caller). */
export function _resetProfilesStateForTests(): void {
  profileList.value = [];
  storageError.value = '';
  notice.value = '';
  busy.value = false;
  currentPhotoSaved.value = false;
  baseline.value = profileFingerprint(profile.peek());
  persistentStorage.value = null;
  persistAsked = false;
  defaultDistanceCm.value = DEFAULT_VIEWING_DISTANCE_CM;
  defaultEye.value = FALLBACK_EYE;
  eyeChosen.value = false;
}

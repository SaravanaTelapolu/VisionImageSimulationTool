// Saved-profile state and actions: signals plus functions over the storage module.
// The store (state/store.ts) owns the *current* profile; this module saves, opens, duplicates,
// deletes, exports and imports profiles, and tracks whether the current one has unsaved changes.
import { computed, signal } from '@preact/signals';
import { newProfile as makeNewProfile } from '../model/defaults';
import type { Profile } from '../model/types';
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
  savePhoto,
  saveProfile,
  setSetting,
  type ProfileSummary,
} from '../storage';
import { applyEdit, image, loadPhoto, profile, resetProfile } from './store';

export const LAST_PROFILE_KEY = 'lastProfileId';

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
    baseline.value = profileFingerprint(snapshot);
    await rememberLast(stored.id);
    await readList();
    ok('Saved.');
    return stored;
  });
}

/** Loads a saved profile into the editor (undo history is cleared) plus its saved photo, if any. */
export async function openProfile(id: string): Promise<boolean> {
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
  resetProfile(opened.p);
  baseline.value = profileFingerprint(opened.p);
  currentPhotoSaved.value = opened.hasPhoto;
  ok(`Opened "${opened.p.name}".`);
  void rememberLast(opened.p.id);
  if (opened.photo) await loadPhoto(opened.photo);
  return true;
}

/** Starts an empty profile (the current photo stays). Unsaved changes are discarded. */
export function newProfile(name = 'Right eye'): Profile {
  const p = makeNewProfile(name);
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
  applyEdit((p) => (p.name === next ? p : { ...p, name: next }), 'rename');
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
  const listed = await refreshList();
  if (!listed) return false;
  const id = await getSetting<string | null>(LAST_PROFILE_KEY, null);
  if (!id || !profileList.value.some((s) => s.id === id)) return false;
  return openProfile(id);
}

/** Test helper: resets this module's state (the store and storage are reset by the caller). */
export function _resetProfilesStateForTests(): void {
  profileList.value = [];
  storageError.value = '';
  notice.value = '';
  busy.value = false;
  currentPhotoSaved.value = false;
  baseline.value = profileFingerprint(profile.peek());
}

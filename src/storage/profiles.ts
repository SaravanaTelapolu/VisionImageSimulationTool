// Saved profiles ("eye maps") in IndexedDB.

import { duplicateProfile } from '../model/ops';
import { upgradeStoredProfile } from '../model/validate';
import type { Eye, Profile } from '../model/types';
import { withDb } from './db';
import { ProfileNotFoundError } from './errors';
import { formatLocalDate } from './names';

export interface ProfileSummary {
  id: string;
  name: string;
  eye: Eye;
  createdAt: string;
  updatedAt: string;
  note: string;
  regionCount: number;
}

export function summarizeProfile(p: Profile): ProfileSummary {
  return {
    id: p.id,
    name: p.name,
    eye: p.eye,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    note: p.note,
    regionCount: p.regions.length,
  };
}

/** All saved profiles, newest createdAt first. */
export async function listProfiles(): Promise<ProfileSummary[]> {
  const all = await withDb((db) => db.getAllFromIndex('profiles', 'createdAt'));
  return all.map(summarizeProfile).reverse();
}

export async function getProfile(id: string): Promise<Profile | undefined> {
  const p = await withDb((db) => db.get('profiles', id));
  return p && upgradeStoredProfile(p);
}

/** Saves (insert or replace) a profile with updatedAt set to `now`. Returns what was stored. */
export async function saveProfile(profile: Profile, now: Date = new Date()): Promise<Profile> {
  const stored: Profile = { ...profile, updatedAt: now.toISOString() };
  await withDb((db) => db.put('profiles', stored));
  return stored;
}

/** Deletes a profile and its saved photo (if any) in one transaction. Unknown ids are ignored. */
export async function deleteProfile(id: string): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(['profiles', 'photos'], 'readwrite');
    await Promise.all([tx.objectStore('profiles').delete(id), tx.objectStore('photos').delete(id), tx.done]);
  });
}

/**
 * Copies a profile as a new check-up (new ids, createdAt/updatedAt = now), saves it and returns it.
 * Default name is "<name> — yyyy-mm-dd" (local date). The photo is not copied.
 */
export async function duplicateAsCheckup(id: string, now: Date, name?: string): Promise<Profile> {
  const original = await getProfile(id);
  if (!original) throw new ProfileNotFoundError(id);
  const copy = duplicateProfile(original, now, name ?? `${original.name} — ${formatLocalDate(now)}`);
  await withDb((db) => db.put('profiles', copy));
  return copy;
}

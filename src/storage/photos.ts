// Optional photo saved with a profile (key = profile id). Photos are stored only when the user chooses.

import { withDb, type PhotoRecord } from './db';

export type { PhotoRecord };

export async function savePhoto(profileId: string, blob: Blob, name: string, now: Date = new Date()): Promise<PhotoRecord> {
  const record: PhotoRecord = { profileId, blob, name, type: blob.type, savedAt: now.toISOString() };
  await withDb((db) => db.put('photos', record));
  return record;
}

export async function getPhoto(profileId: string): Promise<PhotoRecord | undefined> {
  return withDb((db) => db.get('photos', profileId));
}

export async function deletePhoto(profileId: string): Promise<void> {
  await withDb((db) => db.delete('photos', profileId));
}

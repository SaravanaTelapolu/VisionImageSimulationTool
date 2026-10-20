// Tiny key/value store for app settings (for example 'lastProfileId').

import { withDb } from './db';

/** Reads a setting. Fails soft: if storage is unavailable or the key is unset, returns `fallback`. */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await withDb((db) => db.get('settings', key));
    return v === undefined ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

/** Writes a setting. Throws StorageUnavailableError when storage is unavailable (callers may ignore it). */
export async function setSetting<T>(key: string, value: T): Promise<void> {
  await withDb((db) => db.put('settings', value, key));
}

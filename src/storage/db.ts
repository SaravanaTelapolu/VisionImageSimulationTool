// IndexedDB access via idb. One lazily created connection is shared by the whole app.

import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Profile } from '../model/types';
import { StorageUnavailableError, toStorageError } from './errors';

export const DB_NAME = 'vision-simulator';
export const DB_VERSION = 1;

/** A photo saved alongside a profile, keyed by the profile's id. */
export interface PhotoRecord {
  profileId: string;
  blob: Blob;
  name: string;
  type: string;
  /** ISO 8601. */
  savedAt: string;
}

export interface VisionDbSchema extends DBSchema {
  profiles: {
    key: string;
    value: Profile;
    indexes: { createdAt: string };
  };
  photos: {
    key: string;
    value: PhotoRecord;
  };
  settings: {
    key: string;
    value: unknown;
  };
}

export type VisionDb = IDBPDatabase<VisionDbSchema>;

let singleton: Promise<VisionDb> | undefined;

async function closeSingleton(): Promise<void> {
  const p = singleton;
  singleton = undefined;
  if (p) {
    try {
      (await p).close();
    } catch {
      /* never opened */
    }
  }
}

/** Opens (and on first use creates) the database. Throws StorageUnavailableError on any failure. */
export async function openVisionDb(name: string = DB_NAME): Promise<VisionDb> {
  if (typeof indexedDB === 'undefined' || indexedDB === null) throw new StorageUnavailableError('unavailable');
  try {
    return await openDB<VisionDbSchema>(name, DB_VERSION, {
      upgrade(db) {
        const profiles = db.createObjectStore('profiles', { keyPath: 'id' });
        profiles.createIndex('createdAt', 'createdAt');
        db.createObjectStore('photos', { keyPath: 'profileId' });
        db.createObjectStore('settings');
      },
      blocking() {
        // Another tab wants to upgrade: let go so it can proceed.
        void closeSingleton();
      },
      terminated() {
        singleton = undefined;
      },
    });
  } catch (e) {
    throw toStorageError(e);
  }
}

/** The shared connection. A failed open is not cached, so a later call can try again. */
export function getDb(): Promise<VisionDb> {
  if (!singleton) {
    const p = openVisionDb();
    singleton = p;
    p.catch(() => {
      if (singleton === p) singleton = undefined;
    });
  }
  return singleton;
}

/** Runs `fn` against the shared database, converting every failure to a StorageUnavailableError. */
export async function withDb<T>(fn: (db: VisionDb) => Promise<T>): Promise<T> {
  const db = await getDb();
  try {
    return await fn(db);
  } catch (e) {
    throw toStorageError(e);
  }
}

/** Test helper: closes the shared connection, deletes the default database and forgets the singleton. */
export async function _resetForTests(): Promise<void> {
  await closeSingleton();
  try {
    await deleteDB(DB_NAME);
  } catch {
    /* nothing to delete */
  }
}

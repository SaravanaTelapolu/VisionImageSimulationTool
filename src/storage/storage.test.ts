import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultEllipse, newProfile, newRegion } from '../model/defaults';
import type { Profile } from '../model/types';
import { _resetForTests } from './db';
import { StorageUnavailableError, ProfileNotFoundError } from './errors';
import {
  deletePhoto,
  deleteProfile,
  duplicateAsCheckup,
  getPhoto,
  getProfile,
  getSetting,
  importProfilesFromFile,
  importProfilesFromText,
  listProfiles,
  profilesToBundleBlob,
  profileToJsonBlob,
  requestPersistentStorage,
  savePhoto,
  saveProfile,
  setSetting,
} from './index';
import { slugify } from './names';

function makeProfile(name: string, createdAt: string, id?: string): Profile {
  const p = newProfile(name, new Date(createdAt));
  p.regions = [newRegion(defaultEllipse(), 'Blur'), newRegion(defaultEllipse(), 'Spot')];
  return id ? { ...p, id } : p;
}

beforeEach(async () => {
  await _resetForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('profiles', () => {
  it('saves, gets and overwrites a profile, stamping updatedAt', async () => {
    const p = makeProfile('Right eye', '2026-01-01T00:00:00.000Z');
    const now = new Date('2026-02-02T10:00:00.000Z');
    const saved = await saveProfile(p, now);
    expect(saved.updatedAt).toBe(now.toISOString());
    expect(saved.createdAt).toBe(p.createdAt);

    expect(await getProfile(p.id)).toEqual(saved);

    const renamed = { ...saved, name: 'Renamed' };
    await saveProfile(renamed, new Date('2026-03-03T00:00:00.000Z'));
    const again = await getProfile(p.id);
    expect(again?.name).toBe('Renamed');
    expect(again?.updatedAt).toBe('2026-03-03T00:00:00.000Z');
    expect(await listProfiles()).toHaveLength(1);
  });

  it('returns undefined for an unknown id', async () => {
    expect(await getProfile('nope')).toBeUndefined();
  });

  it('lists summaries newest createdAt first', async () => {
    const a = makeProfile('A', '2026-01-01T00:00:00.000Z');
    const b = makeProfile('B', '2026-03-01T00:00:00.000Z');
    const c = makeProfile('C', '2026-02-01T00:00:00.000Z');
    b.note = 'hello';
    b.eye = 'left';
    await saveProfile(a);
    await saveProfile(b);
    await saveProfile(c);
    const list = await listProfiles();
    expect(list.map((s) => s.name)).toEqual(['B', 'C', 'A']);
    expect(list[0]).toMatchObject({ id: b.id, eye: 'left', note: 'hello', regionCount: 2, createdAt: b.createdAt });
    expect(Object.keys(list[0]!).sort()).toEqual(['createdAt', 'eye', 'id', 'name', 'note', 'regionCount', 'updatedAt']);
  });

  it('lists nothing when empty', async () => {
    expect(await listProfiles()).toEqual([]);
  });

  it('deletes a profile and its photo, leaving others alone', async () => {
    const a = makeProfile('A', '2026-01-01T00:00:00.000Z');
    const b = makeProfile('B', '2026-01-02T00:00:00.000Z');
    await saveProfile(a);
    await saveProfile(b);
    await savePhoto(a.id, new Blob(['aaa'], { type: 'image/jpeg' }), 'a.jpg');
    await savePhoto(b.id, new Blob(['bbb'], { type: 'image/jpeg' }), 'b.jpg');

    await deleteProfile(a.id);
    expect(await getProfile(a.id)).toBeUndefined();
    expect(await getPhoto(a.id)).toBeUndefined();
    expect(await getProfile(b.id)).toBeDefined();
    expect((await getPhoto(b.id))?.name).toBe('b.jpg');

    await expect(deleteProfile('missing')).resolves.toBeUndefined();
  });

  it('duplicateAsCheckup saves a new profile with a dated default name', async () => {
    const p = makeProfile('Right eye', '2026-01-01T00:00:00.000Z');
    await saveProfile(p);
    const now = new Date(2026, 4, 3, 12, 0, 0); // local 3 May 2026
    const copy = await duplicateAsCheckup(p.id, now);
    expect(copy.id).not.toBe(p.id);
    expect(copy.name).toBe('Right eye — 2026-05-03');
    expect(copy.createdAt).toBe(now.toISOString());
    expect(copy.updatedAt).toBe(now.toISOString());
    expect(copy.regions.map((r) => r.id)).not.toEqual(p.regions.map((r) => r.id));
    expect(copy.regions).toHaveLength(2);
    expect(await getProfile(copy.id)).toEqual(copy);
    expect(await listProfiles()).toHaveLength(2);

    const named = await duplicateAsCheckup(p.id, now, 'Follow-up');
    expect(named.name).toBe('Follow-up');
  });

  it('duplicateAsCheckup throws ProfileNotFoundError for an unknown id', async () => {
    await expect(duplicateAsCheckup('nope', new Date())).rejects.toBeInstanceOf(ProfileNotFoundError);
  });
});

describe('photos', () => {
  it('saves, reads and deletes a photo', async () => {
    const blob = new Blob(['photo-bytes'], { type: 'image/png' });
    const rec = await savePhoto('p1', blob, 'scene.png', new Date('2026-01-01T00:00:00.000Z'));
    expect(rec).toMatchObject({ profileId: 'p1', name: 'scene.png', type: 'image/png', savedAt: '2026-01-01T00:00:00.000Z' });

    const got = await getPhoto('p1');
    expect(got?.name).toBe('scene.png');
    expect(got?.type).toBe('image/png');
    expect(got?.blob.size).toBe(blob.size);

    await deletePhoto('p1');
    expect(await getPhoto('p1')).toBeUndefined();
    await expect(deletePhoto('p1')).resolves.toBeUndefined();
  });

  it('replaces an existing photo for the same profile', async () => {
    await savePhoto('p1', new Blob(['one'], { type: 'image/png' }), 'one.png');
    await savePhoto('p1', new Blob(['three'], { type: 'image/jpeg' }), 'two.jpg');
    const got = await getPhoto('p1');
    expect(got?.name).toBe('two.jpg');
    expect(got?.blob.size).toBe(5);
  });
});

describe('settings', () => {
  it('returns the fallback until set, then the stored value', async () => {
    expect(await getSetting('lastProfileId', null as string | null)).toBeNull();
    await setSetting('lastProfileId', 'p-123');
    expect(await getSetting<string | null>('lastProfileId', null)).toBe('p-123');
    await setSetting('lastProfileId', 'p-456');
    expect(await getSetting<string | null>('lastProfileId', null)).toBe('p-456');
  });

  it('stores structured values', async () => {
    await setSetting('prefs', { textScale: 1.25, flags: [true, false] });
    expect(await getSetting('prefs', {})).toEqual({ textScale: 1.25, flags: [true, false] });
  });
});

describe('unavailable storage', () => {
  it('throws StorageUnavailableError from data calls, but getSetting falls back', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(listProfiles()).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(saveProfile(makeProfile('A', '2026-01-01T00:00:00.000Z'))).rejects.toMatchObject({
      name: 'StorageUnavailableError',
      reason: 'unavailable',
    });
    await expect(setSetting('k', 1)).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(await getSetting('k', 'fallback')).toBe('fallback');
  });

  it('recovers once storage is available again', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(listProfiles()).rejects.toBeInstanceOf(StorageUnavailableError);
    vi.unstubAllGlobals();
    expect(await listProfiles()).toEqual([]);
  });
});

describe('export', () => {
  it('builds a single-profile JSON blob and filename', async () => {
    const p = makeProfile('Right eye — check-up', '2026-01-01T00:00:00.000Z');
    const { blob, filename } = profileToJsonBlob(p, new Date(2026, 4, 3, 9));
    expect(filename).toBe('eye-map_right-eye-check-up_2026-05-03.json');
    expect(blob.type).toBe('application/json');
    expect(JSON.parse(await blob.text())).toEqual(p);
  });

  it('builds a bundle', async () => {
    const a = makeProfile('A', '2026-01-01T00:00:00.000Z');
    const b = makeProfile('B', '2026-01-02T00:00:00.000Z');
    const now = new Date(2026, 4, 3, 9);
    const { blob, filename } = profilesToBundleBlob([a, b], now);
    expect(filename).toBe('eye-maps_2026-05-03.json');
    const parsed = JSON.parse(await blob.text());
    expect(parsed).toMatchObject({ kind: 'vision-simulator-profiles', version: 1, exportedAt: now.toISOString() });
    expect(parsed.profiles).toHaveLength(2);
  });

  it('slugifies awkward names', () => {
    expect(slugify('  Café / Œil!! ')).toBe('cafe-il');
    expect(slugify('???')).toBe('profile');
    expect(slugify('')).toBe('profile');
  });
});

describe('import', () => {
  it('imports a single profile and round-trips an export', async () => {
    const p = makeProfile('A', '2026-01-01T00:00:00.000Z');
    const { blob } = profileToJsonBlob(p);
    const res = await importProfilesFromFile(blob, new Set());
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.imported).toEqual([p]);
  });

  it('imports a bundle of several profiles', async () => {
    const a = makeProfile('A', '2026-01-01T00:00:00.000Z');
    const b = makeProfile('B', '2026-01-02T00:00:00.000Z');
    const { blob } = profilesToBundleBlob([a, b]);
    const res = importProfilesFromText(await blob.text(), new Set());
    expect(res.errors).toEqual([]);
    expect(res.imported.map((x) => x.id)).toEqual([a.id, b.id]);
  });

  it('gives a clashing id a new one and warns', () => {
    const a = makeProfile('A', '2026-01-01T00:00:00.000Z');
    const text = JSON.stringify(a);
    const res = importProfilesFromText(text, new Set([a.id]));
    expect(res.errors).toEqual([]);
    expect(res.imported).toHaveLength(1);
    expect(res.imported[0]!.id).not.toBe(a.id);
    expect(res.imported[0]!.name).toBe('A');
    expect(res.warnings.some((w) => w.includes('same id'))).toBe(true);
  });

  it('handles clashes against earlier profiles in the same bundle', async () => {
    const a = makeProfile('A', '2026-01-01T00:00:00.000Z', 'same');
    const b = makeProfile('B', '2026-01-02T00:00:00.000Z', 'same');
    const { blob } = profilesToBundleBlob([a, b]);
    const res = importProfilesFromText(await blob.text(), new Set());
    expect(res.imported.map((x) => x.id)[0]).toBe('same');
    expect(res.imported[1]!.id).not.toBe('same');
    expect(res.warnings).toHaveLength(1);
  });

  it('reports invalid JSON', () => {
    const res = importProfilesFromText('{ not json', new Set());
    expect(res.imported).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatch(/not valid JSON/);
  });

  it('reports an invalid profile and keeps good ones in a bundle', async () => {
    const good = makeProfile('Good', '2026-01-01T00:00:00.000Z');
    const bad = { ...makeProfile('Bad', '2026-01-02T00:00:00.000Z'), regions: 'oops' };
    const text = JSON.stringify({ kind: 'vision-simulator-profiles', version: 1, exportedAt: 'x', profiles: [good, bad] });
    const res = importProfilesFromText(text, new Set());
    expect(res.imported.map((p) => p.name)).toEqual(['Good']);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatch(/Profile 2 \("Bad"\)/);
  });

  it('rejects a single invalid profile, an empty bundle, and a newer bundle version', () => {
    expect(importProfilesFromText('{"hello":1}', new Set()).errors.length).toBeGreaterThan(0);
    expect(importProfilesFromText('[1,2]', new Set()).errors.length).toBeGreaterThan(0);
    expect(
      importProfilesFromText('{"kind":"vision-simulator-profiles","version":1,"profiles":[]}', new Set()).errors[0],
    ).toMatch(/no profiles/);
    expect(
      importProfilesFromText('{"kind":"vision-simulator-profiles","version":99,"profiles":[]}', new Set()).errors[0],
    ).toMatch(/version 99/);
    expect(importProfilesFromText('{"kind":"vision-simulator-profiles","version":1}', new Set()).errors[0]).toMatch(/profiles/);
  });

  it('tolerates a UTF-8 byte-order mark', () => {
    const p = makeProfile('A', '2026-01-01T00:00:00.000Z');
    const res = importProfilesFromText('﻿' + JSON.stringify(p), new Set());
    expect(res.errors).toEqual([]);
    expect(res.imported).toHaveLength(1);
  });

  it('reports an unreadable file', async () => {
    const broken = { text: () => Promise.reject(new Error('boom')) } as unknown as Blob;
    const res = await importProfilesFromFile(broken);
    expect(res.errors).toEqual(['Could not read that file.']);
  });
});

describe('requestPersistentStorage', () => {
  it('returns the browser answer', async () => {
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.resolve(true) } });
    expect(await requestPersistentStorage()).toBe(true);
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.resolve(false) } });
    expect(await requestPersistentStorage()).toBe(false);
  });

  it('returns false when unsupported or throwing', async () => {
    vi.stubGlobal('navigator', {});
    expect(await requestPersistentStorage()).toBe(false);
    vi.stubGlobal('navigator', {
      storage: {
        persist: () => {
          throw new Error('no');
        },
      },
    });
    expect(await requestPersistentStorage()).toBe(false);
  });
});

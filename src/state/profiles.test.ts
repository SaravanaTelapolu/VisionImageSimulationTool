import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultEllipse, newRegion } from '../model/defaults';
import { _resetForTests } from '../storage/db';
import { getPhoto, getProfile, getSetting, profilesToBundleBlob, profileToJsonBlob, saveProfile } from '../storage';
import * as share from '../export/share';
import {
  DEFAULT_DISTANCE_KEY,
  DEFAULT_EYE_KEY,
  LAST_PROFILE_KEY,
  _resetProfilesStateForTests,
  currentIsSaved,
  currentPhotoSaved,
  defaultDistanceCm,
  defaultEye,
  deleteProfileById,
  dirty,
  duplicateCurrentAsCheckup,
  eyeChosen,
  duplicateProfileById,
  exportAllJson,
  exportCurrentJson,
  exportProfileById,
  importJsonFile,
  loadAllProfiles,
  loadDefaultDistance,
  loadDefaultEye,
  newProfile,
  notice,
  persistentStorage,
  openProfile,
  profileFingerprint,
  profileList,
  refreshList,
  renameCurrent,
  restoreLastProfile,
  setCurrentEye,
  setDefaultDistance,
  setDefaultEye,
  saveCurrent,
  savePhotoWithCurrent,
  storageError,
} from './profiles';
import { applyEdit, canUndo, image, profile, resetProfile, undo } from './store';

vi.mock('../export/share', () => ({
  shareOrDownload: vi.fn(async () => 'downloaded'),
  exportFileName: vi.fn(),
  slugify: vi.fn(),
}));

function addRegion(): void {
  applyEdit((p) => ({ ...p, regions: [...p.regions, newRegion(defaultEllipse(), 'Spot')] }));
}

beforeEach(async () => {
  await _resetForTests();
  resetProfile();
  image.value = null;
  _resetProfilesStateForTests();
  vi.mocked(share.shareOrDownload).mockClear();
  vi.mocked(share.shareOrDownload).mockResolvedValue('downloaded');
});

describe('dirty flag', () => {
  it('starts clean, turns dirty on an edit, clean again on undo and after save', async () => {
    expect(dirty.value).toBe(false);
    addRegion();
    expect(dirty.value).toBe(true);
    undo();
    expect(dirty.value).toBe(false);
    addRegion();
    await saveCurrent();
    expect(dirty.value).toBe(false);
    addRegion();
    expect(dirty.value).toBe(true);
  });

  it('ignores updatedAt in the fingerprint', () => {
    const p = profile.value;
    expect(profileFingerprint(p)).toBe(profileFingerprint({ ...p, updatedAt: '2000-01-01T00:00:00.000Z' }));
    expect(profileFingerprint(p)).not.toBe(profileFingerprint({ ...p, name: 'Other' }));
  });
});

describe('save, list, open', () => {
  it('saves the current profile, lists it and remembers it as the last one', async () => {
    addRegion();
    const stored = await saveCurrent();
    expect(stored?.id).toBe(profile.value.id);
    expect(profileList.value.map((s) => s.id)).toEqual([profile.value.id]);
    expect(profileList.value[0]?.regionCount).toBe(1);
    expect(currentIsSaved.value).toBe(true);
    expect(await getSetting(LAST_PROFILE_KEY, '')).toBe(profile.value.id);
    expect(storageError.value).toBe('');
    expect(notice.value).toBe('Saved.');
  });

  it('opens a saved profile, replaces the editor profile and clears undo', async () => {
    const savedId = profile.value.id;
    addRegion();
    await saveCurrent();
    newProfile('Left check');
    expect(profile.value.id).not.toBe(savedId);
    addRegion();

    expect(await openProfile(savedId)).toBe(true);
    expect(profile.value.id).toBe(savedId);
    expect(profile.value.regions).toHaveLength(1);
    expect(dirty.value).toBe(false);
    undo(); // no history after opening
    expect(profile.value.regions).toHaveLength(1);
  });

  it('reports a missing profile', async () => {
    expect(await openProfile('nope')).toBe(false);
    expect(storageError.value).toMatch(/nope/);
  });

  it('newProfile starts clean with a fresh id', () => {
    const before = profile.value.id;
    addRegion();
    const p = newProfile();
    expect(p.id).not.toBe(before);
    expect(profile.value.regions).toEqual([]);
    expect(dirty.value).toBe(false);
    expect(currentIsSaved.value).toBe(false);
  });

  it('restoreLastProfile reopens the last saved profile, and does nothing when there is none', async () => {
    expect(await restoreLastProfile()).toBe(false);
    addRegion();
    await saveCurrent();
    const id = profile.value.id;
    newProfile();
    expect(await restoreLastProfile()).toBe(true);
    expect(profile.value.id).toBe(id);
    expect(profileList.value).toHaveLength(1);
  });
});

describe('startup restore never overwrites the user (M2)', () => {
  it('is skipped when the user edits while the restore is still reading storage', async () => {
    addRegion();
    await saveCurrent();
    const savedId = profile.value.id;
    newProfile('Fresh');
    const freshId = profile.value.id;
    const restoring = restoreLastProfile();
    addRegion(); // the user acts before the storage reads finish
    expect(await restoring).toBe(false);
    expect(profile.value.id).toBe(freshId);
    expect(profile.value.id).not.toBe(savedId);
    expect(profile.value.regions).toHaveLength(1);
    expect(canUndo.value).toBe(true);
  });

  it('is skipped when the user opened another profile meanwhile', async () => {
    addRegion();
    await saveCurrent();
    const restoring = restoreLastProfile();
    newProfile('Mine');
    expect(await restoring).toBe(false);
    expect(profile.value.name).toBe('Mine');
  });

  it('still restores into a pristine state', async () => {
    addRegion();
    await saveCurrent();
    const id = profile.value.id;
    newProfile();
    expect(await restoreLastProfile()).toBe(true);
    expect(profile.value.id).toBe(id);
  });
});

describe('persistent storage (M4)', () => {
  it('is requested once, after the first successful save, and the answer is remembered', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal('navigator', { storage: { persist } });
    try {
      expect(persist).not.toHaveBeenCalled();
      expect(persistentStorage.value).toBeNull();
      await refreshList();
      await restoreLastProfile();
      expect(persist).not.toHaveBeenCalled(); // not on startup
      addRegion();
      await saveCurrent();
      await vi.waitFor(() => expect(persistentStorage.value).toBe(true));
      addRegion();
      await saveCurrent();
      await saveCurrent();
      expect(persist).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('is not requested when the save fails', async () => {
    const persist = vi.fn(() => Promise.resolve(false));
    vi.stubGlobal('navigator', { storage: { persist } });
    try {
      vi.stubGlobal('indexedDB', undefined);
      await _resetForTests();
      expect(await saveCurrent()).toBeNull();
      expect(persist).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('rename', () => {
  it('two consecutive renames are two undo steps (L1)', () => {
    renameCurrent('First');
    renameCurrent('Second');
    expect(profile.value.name).toBe('Second');
    undo();
    expect(profile.value.name).toBe('First');
    undo();
    expect(profile.value.name).toBe('Right eye');
    expect(canUndo.value).toBe(false);
  });

  it('renames through applyEdit (undoable, marks dirty) and ignores blank names', () => {
    expect(renameCurrent('  Follow-up  ')).toBe(true);
    expect(profile.value.name).toBe('Follow-up');
    expect(dirty.value).toBe(true);
    expect(renameCurrent('   ')).toBe(false);
    expect(profile.value.name).toBe('Follow-up');
    undo();
    expect(profile.value.name).toBe('Right eye');
  });
});

describe('duplicate as check-up', () => {
  it('saves the current profile first, then opens a dated copy', async () => {
    addRegion(); // unsaved
    const originalId = profile.value.id;
    const copy = await duplicateCurrentAsCheckup();
    expect(copy).not.toBeNull();
    expect(copy?.id).not.toBe(originalId);
    expect(profile.value.id).toBe(copy?.id);
    expect(profile.value.name).toMatch(/^Right eye — \d{4}-\d{2}-\d{2}$/);
    expect(profile.value.regions).toHaveLength(1);
    expect(dirty.value).toBe(false);
    expect(profileList.value).toHaveLength(2);
    expect((await getProfile(originalId))?.regions).toHaveLength(1);
    expect(await getSetting(LAST_PROFILE_KEY, '')).toBe(copy?.id);
  });

  it('duplicateProfileById copies a saved profile without opening it', async () => {
    await saveCurrent();
    const id = profile.value.id;
    const copy = await duplicateProfileById(id);
    expect(copy?.id).not.toBe(id);
    expect(profile.value.id).toBe(id);
    expect(profileList.value).toHaveLength(2);
  });
});

describe('delete', () => {
  it('deletes a saved profile and its photo; deleting the current one leaves it unsaved and dirty', async () => {
    await saveCurrent();
    const id = profile.value.id;
    expect(await deleteProfileById(id)).toBe(true);
    expect(profileList.value).toEqual([]);
    expect(await getProfile(id)).toBeUndefined();
    expect(await getPhoto(id)).toBeUndefined();
    expect(currentIsSaved.value).toBe(false);
    expect(dirty.value).toBe(true);
    expect(await getSetting(LAST_PROFILE_KEY, 'x')).toBe('');
    expect(await restoreLastProfile()).toBe(false);
  });
});

describe('photo', () => {
  it('refuses when there is no original file', async () => {
    expect(await savePhotoWithCurrent()).toBe(false);
    expect(notice.value).toMatch(/opened from a file/);
  });

  it('saves the original file with the profile', async () => {
    const file = new Blob(['abc'], { type: 'image/jpeg' }) as File;
    Object.defineProperty(file, 'name', { value: 'eye.jpg' });
    image.value = { original: file, working: {} as CanvasImageSource, width: 10, height: 10, name: 'eye.jpg' };
    expect(await savePhotoWithCurrent()).toBe(true);
    expect(currentPhotoSaved.value).toBe(true);
    const rec = await getPhoto(profile.value.id);
    expect(rec?.name).toBe('eye.jpg');
    expect(rec?.blob.size).toBe(3);
  });
});

describe('export', () => {
  it('exports the current profile as one JSON file', async () => {
    expect(await exportCurrentJson()).toBe('downloaded');
    const [files] = vi.mocked(share.shareOrDownload).mock.calls[0] ?? [];
    expect(files).toHaveLength(1);
    expect(files?.[0]?.name).toMatch(/^eye-map_right-eye_\d{4}-\d{2}-\d{2}\.json$/);
    expect(notice.value).toMatch(/Downloaded/);
  });

  it('exports a saved profile by id, and reports an unknown one', async () => {
    await saveCurrent();
    expect(await exportProfileById(profile.value.id)).toBe('downloaded');
    expect(await exportProfileById('missing')).toBe('error');
    expect(storageError.value).toMatch(/missing/);
  });

  it('exports all saved profiles as a bundle, or says there are none', async () => {
    expect(await exportAllJson()).toBe('empty');
    expect(share.shareOrDownload).not.toHaveBeenCalled();
    await saveCurrent();
    await duplicateCurrentAsCheckup();
    expect(await exportAllJson()).toBe('downloaded');
    const [files] = vi.mocked(share.shareOrDownload).mock.calls[0] ?? [];
    expect(files?.[0]?.name).toMatch(/^eye-maps_/);
    const bundle = JSON.parse(await (files?.[0]?.blob as Blob).text());
    expect(bundle.profiles).toHaveLength(2);
  });

  it('passes a cancelled share through without an error', async () => {
    vi.mocked(share.shareOrDownload).mockResolvedValue('cancelled');
    expect(await exportCurrentJson()).toBe('cancelled');
    expect(storageError.value).toBe('');
  });
});

describe('import', () => {
  it('imports a single profile file and saves it', async () => {
    const other = { ...profile.value, id: 'p-import-1', name: 'From phone' };
    const msg = await importJsonFile(profileToJsonBlob(other).blob);
    expect(msg).toMatch(/^Imported 1 profile\./);
    expect(profileList.value.map((s) => s.id)).toContain('p-import-1');
    expect((await getProfile('p-import-1'))?.name).toBe('From phone');
  });

  it('gives imported profiles with a clashing id a new id', async () => {
    await saveCurrent();
    const msg = await importJsonFile(profileToJsonBlob(profile.value).blob);
    expect(msg).toMatch(/Imported 1 profile/);
    expect(msg).toMatch(/same id/);
    expect(profileList.value).toHaveLength(2);
  });

  it('imports a bundle and reports bad profiles without losing the good ones', async () => {
    const a = { ...profile.value, id: 'p-a', name: 'A', createdAt: '2026-01-01T00:00:00.000Z' };
    const b = { ...profile.value, id: 'p-b', name: 'B', createdAt: '2026-02-01T00:00:00.000Z' };
    const bundle = JSON.parse(await profilesToBundleBlob([a, b]).blob.text());
    bundle.profiles.push({ nonsense: true });
    const msg = await importJsonFile(new Blob([JSON.stringify(bundle)]));
    expect(msg).toMatch(/Imported 2 profiles\./);
    expect(msg).toMatch(/Some profiles were skipped/);
    expect(profileList.value.map((s) => s.id).slice(0, 2)).toEqual(['p-b', 'p-a']); // newest first
  });

  it('explains a file that is not a profile', async () => {
    const msg = await importJsonFile(new Blob(['not json']));
    expect(msg).toMatch(/^Nothing was imported\./);
    expect(msg).toMatch(/not valid JSON/);
    expect(profileList.value).toEqual([]);
  });
});

describe('list order and full load', () => {
  it('lists newest first and loadAllProfiles returns full profiles', async () => {
    const old = { ...profile.value, id: 'p-old', createdAt: '2025-01-01T00:00:00.000Z' };
    const recent = { ...profile.value, id: 'p-new', createdAt: '2026-06-01T00:00:00.000Z' };
    await saveProfile(old);
    await saveProfile(recent);
    await refreshList();
    expect(profileList.value.map((s) => s.id)).toEqual(['p-new', 'p-old']);
    const all = await loadAllProfiles();
    expect(all.map((p) => p.id)).toEqual(['p-new', 'p-old']);
  });
});

describe('storage unavailable', () => {
  it('shows a clear message and leaves the editor profile alone', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true, writable: true });
    try {
      await _resetForTests().catch(() => undefined);
      addRegion();
      expect(await saveCurrent()).toBeNull();
      expect(storageError.value).toMatch(/not available/);
      expect(profile.value.regions).toHaveLength(1);
      expect(dirty.value).toBe(true);
      expect(await refreshList()).toBe(false);
      expect(await restoreLastProfile()).toBe(false);
      expect(await exportCurrentJson()).toBe('downloaded'); // export does not need storage
      expect(storageError.value).toBe('');
    } finally {
      if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    }
  });
});

describe('default viewing distance (v0.2 Q3)', () => {
  it('is 40 cm until set, and new profiles use it', () => {
    expect(defaultDistanceCm.value).toBe(40);
    expect(newProfile().viewingDistanceCm).toBe(40);
  });

  it('persists the setting and new profiles use it', async () => {
    expect(await setDefaultDistance(300)).toBe(300);
    expect(await getSetting<number>(DEFAULT_DISTANCE_KEY, -1)).toBe(300);
    expect(newProfile().viewingDistanceCm).toBe(300);
    expect(profile.value.viewingDistanceCm).toBe(300);
    expect(dirty.value).toBe(false);

    defaultDistanceCm.value = 40; // a fresh start: the signal is back to its default
    expect(await loadDefaultDistance()).toBe(300);
    expect(defaultDistanceCm.value).toBe(300);
  });

  it('clamps stored values and ignores garbage', async () => {
    expect(await setDefaultDistance(9999)).toBe(600);
    expect(await getSetting<number>(DEFAULT_DISTANCE_KEY, -1)).toBe(600);
    const { setSetting } = await import('../storage');
    await setSetting(DEFAULT_DISTANCE_KEY, 'far');
    expect(await loadDefaultDistance()).toBe(40);
  });

  it('the initial profile takes the setting on startup when nothing was touched', async () => {
    await setDefaultDistance(70);
    defaultDistanceCm.value = 40;
    resetProfile(); // the initial blank profile, at 40 cm
    _resetProfilesStateForTests();
    expect(profile.value.viewingDistanceCm).toBe(40);
    expect(await restoreLastProfile()).toBe(false);
    expect(profile.value.viewingDistanceCm).toBe(70);
    expect(dirty.value).toBe(false);
    expect(canUndo.value).toBe(false);
  });

  it('does not change the initial profile when the user edited meanwhile', async () => {
    await setDefaultDistance(70);
    defaultDistanceCm.value = 40;
    resetProfile();
    _resetProfilesStateForTests();
    const restoring = restoreLastProfile();
    addRegion(); // the user acts before the storage reads finish
    expect(await restoring).toBe(false);
    expect(profile.value.viewingDistanceCm).toBe(40);
    expect(profile.value.regions).toHaveLength(1);
  });

  it('does not touch a restored profile, but still loads the setting', async () => {
    addRegion();
    await saveCurrent();
    const id = profile.value.id;
    await setDefaultDistance(300);
    defaultDistanceCm.value = 40;
    resetProfile();
    expect(await restoreLastProfile()).toBe(true);
    expect(profile.value.id).toBe(id);
    expect(profile.value.viewingDistanceCm).toBe(40);
    expect(defaultDistanceCm.value).toBe(300);
  });

  it('listed profiles carry their distance', async () => {
    await setDefaultDistance(300);
    newProfile();
    await saveCurrent();
    expect(profileList.value[0]?.viewingDistanceCm).toBe(300);
  });
});

describe('eye choice and default eye (v0.2)', () => {
  it('is right until set, unchosen, and new profiles use it', () => {
    expect(defaultEye.value).toBe('right');
    expect(eyeChosen.value).toBe(false);
    expect(newProfile()).toMatchObject({ eye: 'right', name: 'Right eye' });
  });

  it('persists the default eye; new profiles take it and its automatic name', async () => {
    await setDefaultEye('left');
    expect(eyeChosen.value).toBe(true);
    expect(await getSetting<string>(DEFAULT_EYE_KEY, '')).toBe('left');
    expect(newProfile()).toMatchObject({ eye: 'left', name: 'Left eye' });
    expect(profile.value.eye).toBe('left');
    expect(dirty.value).toBe(false);

    defaultEye.value = 'right'; // a fresh start
    eyeChosen.value = false;
    expect(await loadDefaultEye()).toBe('left');
    expect(defaultEye.value).toBe('left');
    expect(eyeChosen.value).toBe(true);
  });

  it('ignores a missing or garbage stored eye', async () => {
    expect(await loadDefaultEye()).toBeNull();
    const { setSetting } = await import('../storage');
    await setSetting(DEFAULT_EYE_KEY, 'both');
    expect(await loadDefaultEye()).toBeNull();
    expect(defaultEye.value).toBe('right');
    expect(eyeChosen.value).toBe(false);
  });

  it('setCurrentEye: an automatic name follows the eye, one undo step, blank profile stays clean', () => {
    setCurrentEye('left');
    expect(profile.value).toMatchObject({ eye: 'left', name: 'Left eye' });
    expect(dirty.value).toBe(false);
    expect(canUndo.value).toBe(true);
    undo();
    expect(profile.value).toMatchObject({ eye: 'right', name: 'Right eye' });
  });

  it('setCurrentEye keeps a name the user typed', () => {
    renameCurrent('Before surgery');
    setCurrentEye('left');
    expect(profile.value).toMatchObject({ eye: 'left', name: 'Before surgery' });
    expect(dirty.value).toBe(true);
  });

  it('setCurrentEye also renames a dated check-up copy', async () => {
    await saveCurrent();
    await duplicateCurrentAsCheckup();
    expect(profile.value.name).toMatch(/^Right eye — \d{4}-\d{2}-\d{2}$/);
    setCurrentEye('left');
    expect(profile.value.name).toMatch(/^Left eye — \d{4}-\d{2}-\d{2}$/);
  });

  it('the first eye choice becomes the default; later ones change only the open profile', async () => {
    setCurrentEye('left');
    expect(defaultEye.value).toBe('left');
    expect(eyeChosen.value).toBe(true);
    await Promise.resolve();
    setCurrentEye('right');
    expect(profile.value.eye).toBe('right');
    expect(defaultEye.value).toBe('left');
    expect(await getSetting<string>(DEFAULT_EYE_KEY, '')).toBe('left');
  });

  it('choosing the eye the profile already has still records the first choice as the default', () => {
    setCurrentEye('right');
    expect(canUndo.value).toBe(false);
    expect(eyeChosen.value).toBe(true);
    expect(defaultEye.value).toBe('right');
  });

  it('the initial profile takes the saved default eye on startup when nothing was touched', async () => {
    await setDefaultEye('left');
    resetProfile();
    _resetProfilesStateForTests();
    expect(profile.value.eye).toBe('right');
    expect(await restoreLastProfile()).toBe(false);
    expect(profile.value).toMatchObject({ eye: 'left', name: 'Left eye' });
    expect(dirty.value).toBe(false);
    expect(canUndo.value).toBe(false);
  });

  it('a restored profile keeps its eye; with no saved default, new profiles follow it', async () => {
    resetProfile(newProfile());
    setCurrentEye('left');
    await saveCurrent();
    const { setSetting } = await import('../storage');
    await setSetting(DEFAULT_EYE_KEY, null); // as before v0.2: no default eye stored
    resetProfile();
    _resetProfilesStateForTests();
    expect(await restoreLastProfile()).toBe(true);
    expect(profile.value.eye).toBe('left');
    expect(defaultEye.value).toBe('left');
    expect(eyeChosen.value).toBe(true);
  });
});

// Moving profiles between devices as small JSON files: single-profile and bundle export, and import.

import { newId } from '../model/defaults';
import type { Profile } from '../model/types';
import { serializeProfile, validateProfile } from '../model/validate';
import { formatLocalDate, slugify } from './names';

export const BUNDLE_KIND = 'vision-simulator-profiles';
export const BUNDLE_VERSION = 1;
const JSON_MIME = 'application/json';

export interface ProfileBundle {
  kind: typeof BUNDLE_KIND;
  version: number;
  /** ISO 8601. */
  exportedAt: string;
  profiles: Profile[];
}

export interface ExportFile {
  blob: Blob;
  filename: string;
}

export interface ImportResult {
  imported: Profile[];
  warnings: string[];
  errors: string[];
}

/** One profile as a JSON file named like "eye-map_right-eye_2026-05-03.json". */
export function profileToJsonBlob(profile: Profile, now: Date = new Date()): ExportFile {
  return {
    blob: new Blob([serializeProfile(profile)], { type: JSON_MIME }),
    filename: `eye-map_${slugify(profile.name)}_${formatLocalDate(now)}.json`,
  };
}

export function makeBundle(profiles: Profile[], now: Date = new Date()): ProfileBundle {
  return { kind: BUNDLE_KIND, version: BUNDLE_VERSION, exportedAt: now.toISOString(), profiles };
}

/** Several profiles in one JSON file, named like "eye-maps_2026-05-03.json". */
export function profilesToBundleBlob(profiles: Profile[], now: Date = new Date()): ExportFile {
  return {
    blob: new Blob([JSON.stringify(makeBundle(profiles, now), null, 2)], { type: JSON_MIME }),
    filename: `eye-maps_${formatLocalDate(now)}.json`,
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function itemName(item: unknown): string {
  return isObj(item) && typeof item['name'] === 'string' ? ` ("${item['name']}")` : '';
}

function newUnusedId(taken: Set<string>): string {
  let id = newId('p');
  while (taken.has(id)) id = newId('p');
  return id;
}

/**
 * Reads a single profile or a bundle. Each profile goes through validateProfile; a bundle with some
 * bad profiles still imports the good ones and reports the rest in `errors`. A profile whose id is in
 * `existingIds` (or repeats earlier in the same file) gets a fresh id, with a warning.
 */
export function importProfilesFromText(text: string, existingIds: Set<string>): ImportResult {
  const result: ImportResult = { imported: [], warnings: [], errors: [] };

  let data: unknown;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    result.errors.push('This file is not valid JSON, so it cannot be a profile. Choose a profile file exported from this app.');
    return result;
  }

  const taken = new Set(existingIds);
  const isBundle = isObj(data) && data['kind'] === BUNDLE_KIND;

  let items: unknown[];
  if (isBundle) {
    const bundle = data as Record<string, unknown>;
    const version = bundle['version'];
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      result.errors.push(`Bundle version must be a positive whole number (got ${JSON.stringify(version)}).`);
      return result;
    }
    if (version > BUNDLE_VERSION) {
      result.errors.push(
        `This bundle is version ${version}, but this app only understands up to version ${BUNDLE_VERSION}. Update the app to open it.`,
      );
      return result;
    }
    const list = bundle['profiles'];
    if (!Array.isArray(list)) {
      result.errors.push('The bundle has no "profiles" list.');
      return result;
    }
    if (list.length === 0) {
      result.errors.push('The bundle contains no profiles.');
      return result;
    }
    items = list;
  } else {
    items = [data];
  }

  items.forEach((item, i) => {
    const label = isBundle ? `Profile ${i + 1}${itemName(item)}: ` : '';
    const v = validateProfile(item);
    if (!v.ok) {
      for (const e of v.errors) result.errors.push(`${label}${e}`);
      return;
    }
    let profile = v.profile;
    for (const w of v.warnings) result.warnings.push(`${label}${w}`);
    if (taken.has(profile.id)) {
      const fresh = newUnusedId(taken);
      result.warnings.push(
        `${label}"${profile.name}" has the same id as a profile already here, so it was imported as a new copy (id ${fresh}).`,
      );
      profile = { ...profile, id: fresh };
    }
    taken.add(profile.id);
    result.imported.push(profile);
  });

  return result;
}

/** Reads a chosen file as text and imports it. A file that cannot be read becomes an error entry. */
export async function importProfilesFromFile(file: Blob, existingIds: Set<string> = new Set()): Promise<ImportResult> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { imported: [], warnings: [], errors: ['Could not read that file.'] };
  }
  return importProfilesFromText(text, existingIds);
}

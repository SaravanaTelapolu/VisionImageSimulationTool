// Profile validation, clamping, migration and JSON (de)serialisation.
//
// validateProfile never throws and never mutates its input. It returns a fresh, fully populated
// Profile (unknown keys stripped, missing optional fields filled from defaults) or a list of errors.
// Anything that can be repaired safely is repaired and reported in `warnings`.

import {
  PROFILE_VERSION,
  MAX_BLUR_PX,
  MAX_SIZE_CHANGE,
  type EffectKey,
  type Effects,
  type Eye,
  type Profile,
  type ProfileGlobals,
  type Region,
  type Shape,
} from './types';
import { defaultGlobals, emptyEffects, newId } from './defaults';

export type ValidationResult =
  | { ok: true; profile: Profile; warnings: string[] }
  | { ok: false; errors: string[] };

/** Smallest accepted ellipse radius / mask size, in shorter-side units. */
export const MIN_SHAPE_SIZE = 0.001;
export const MIN_PATH_POINTS = 3;
/** Import size bounds: a corrupted or hostile file must not be able to freeze the app. */
export const MAX_REGIONS_PER_PROFILE = 200;
export const MAX_PATH_POINTS = 5000;
/** Maximum length, in characters, of a brush-mask data URL (about 2 MB). */
export const MAX_MASK_DATA_URL_LENGTH = 2 * 1024 * 1024;
import { DEFAULT_VIEWING_DISTANCE_CM, MAX_VIEWING_DISTANCE_CM, MIN_VIEWING_DISTANCE_CM } from './distance';
export { MAX_VIEWING_DISTANCE_CM, MIN_VIEWING_DISTANCE_CM };
export const MAX_NAME_LENGTH = 200;
export const MAX_NOTE_LENGTH = 10000;
const DEFAULT_NAME = 'Untitled profile';
const DEFAULT_REGION_NAME = 'Region';
const DEFAULT_FEATHER = 0.3;

const EFFECT_RANGES: Record<EffectKey, [number, number]> = {
  blur: [0, MAX_BLUR_PX],
  darkSpot: [0, 1],
  fillIn: [0, 1],
  distortion: [0, 1],
  sizeChange: [-MAX_SIZE_CHANGE, MAX_SIZE_CHANGE],
  contrastLoss: [0, 1],
  dimming: [0, 1],
  colourFade: [0, 1],
  doubleImage: [0, 1],
};
const EFFECT_KEYS = Object.keys(EFFECT_RANGES) as EffectKey[];

interface Ctx {
  errors: string[];
  warnings: string[];
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function round(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

/** Clamps `v` into [lo, hi], warning when it had to move. */
function clamp(ctx: Ctx, v: number, lo: number, hi: number, label: string): number {
  if (v < lo || v > hi) {
    const c = Math.min(hi, Math.max(lo, v));
    ctx.warnings.push(`${label}: ${round(v)} is outside ${lo}..${hi}; clamped to ${round(c)}.`);
    return c;
  }
  return v;
}

/** Truncates over-long text, warning when it had to. */
function cap(ctx: Ctx, v: string, max: number, label: string): string {
  if (v.length <= max) return v;
  ctx.warnings.push(`${label}: ${v.length} characters is too long; cut to ${max}.`);
  return v.slice(0, max);
}

/** Optional number with a default; wrong type falls back to the default with a warning. */
function optNum(
  ctx: Ctx,
  o: Obj,
  key: string,
  fallback: number,
  lo: number,
  hi: number,
  label: string,
): number {
  const v = o[key];
  if (v === undefined) {
    ctx.warnings.push(`${label}: missing; using ${fallback}.`);
    return fallback;
  }
  if (!isNum(v)) {
    ctx.warnings.push(`${label}: not a finite number; using ${fallback}.`);
    return fallback;
  }
  return clamp(ctx, v, lo, hi, label);
}

/** Required number; wrong type is an error. Returns undefined when invalid. */
function reqNum(ctx: Ctx, o: Obj, key: string, label: string): number | undefined {
  const v = o[key];
  if (!isNum(v)) {
    ctx.errors.push(`${label}: must be a finite number.`);
    return undefined;
  }
  return v;
}

// ---------------------------------------------------------------------------------------------
// Migration

export type MigrationResult =
  | { ok: true; data: Obj; warnings: string[] }
  | { ok: false; errors: string[] };

/**
 * Brings an unvalidated profile object up to PROFILE_VERSION. Only v1 exists today; this is the
 * place to add `if (version < 2) { ...; version = 2 }` steps later. A missing version is treated
 * as v1 (with a warning); a newer version than this app understands is an error.
 */
export function migrateProfile(input: unknown): MigrationResult {
  if (!isObj(input)) return { ok: false, errors: ['Profile must be a JSON object.'] };
  const warnings: string[] = [];
  let version: unknown = input['version'];
  if (version === undefined) {
    warnings.push('version: missing; assuming 1.');
    version = 1;
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, errors: [`version: must be a positive whole number (got ${JSON.stringify(version)}).`] };
  }
  if (version > PROFILE_VERSION) {
    return {
      ok: false,
      errors: [`This profile is version ${version}, but this app only understands up to version ${PROFILE_VERSION}. Update the app to open it.`],
    };
  }
  const data: Obj = { ...input, version };
  // Future: if (version < 2) { ...upgrade fields...; data.version = version = 2; }
  data['version'] = PROFILE_VERSION;
  return { ok: true, data, warnings };
}

// ---------------------------------------------------------------------------------------------
// Pieces

function validateEffects(ctx: Ctx, raw: unknown, label: string): Effects {
  const out = emptyEffects();
  if (raw === undefined) {
    ctx.warnings.push(`${label}: missing; all effects set to 0.`);
    return out;
  }
  if (!isObj(raw)) {
    ctx.warnings.push(`${label}: not an object; all effects set to 0.`);
    return out;
  }
  for (const key of EFFECT_KEYS) {
    const v = raw[key];
    const [lo, hi] = EFFECT_RANGES[key];
    if (v === undefined) {
      ctx.warnings.push(`${label}.${key}: missing; using 0.`);
    } else if (!isNum(v)) {
      ctx.warnings.push(`${label}.${key}: not a finite number; using 0.`);
    } else {
      out[key] = clamp(ctx, v, lo, hi, `${label}.${key}`);
    }
  }
  return out;
}

function validateShape(ctx: Ctx, raw: unknown, label: string): Shape | undefined {
  if (!isObj(raw)) {
    ctx.errors.push(`${label}: missing or not an object.`);
    return undefined;
  }
  const type = raw['type'];
  switch (type) {
    case 'full':
      return { type: 'full' };
    case 'ellipse': {
      const cx = reqNum(ctx, raw, 'cx', `${label}.cx`);
      const cy = reqNum(ctx, raw, 'cy', `${label}.cy`);
      const rxIn = reqNum(ctx, raw, 'rx', `${label}.rx`);
      const ryIn = reqNum(ctx, raw, 'ry', `${label}.ry`);
      const rotation = optNum(ctx, raw, 'rotation', 0, -Infinity, Infinity, `${label}.rotation`);
      if (cx === undefined || cy === undefined || rxIn === undefined || ryIn === undefined) return undefined;
      return {
        type: 'ellipse',
        cx,
        cy,
        rx: rxIn > 0 ? rxIn : (ctx.warnings.push(`${label}.rx: ${round(rxIn)} must be > 0; set to ${MIN_SHAPE_SIZE}.`), MIN_SHAPE_SIZE),
        ry: ryIn > 0 ? ryIn : (ctx.warnings.push(`${label}.ry: ${round(ryIn)} must be > 0; set to ${MIN_SHAPE_SIZE}.`), MIN_SHAPE_SIZE),
        rotation,
      };
    }
    case 'path': {
      const pts = raw['points'];
      if (!Array.isArray(pts)) {
        ctx.errors.push(`${label}.points: must be an array of [x, y] pairs.`);
        return undefined;
      }
      if (pts.length > MAX_PATH_POINTS) {
        ctx.errors.push(
          `${label}.points: this outline has ${pts.length} points, more than the limit of ${MAX_PATH_POINTS}. The file may be damaged.`,
        );
        return undefined;
      }
      const points: [number, number][] = [];
      let bad = false;
      pts.forEach((p, i) => {
        if (Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1])) {
          points.push([p[0], p[1]]);
        } else {
          bad = true;
          ctx.errors.push(`${label}.points[${i}]: must be [x, y] with finite numbers.`);
        }
      });
      if (bad) return undefined;
      if (points.length < MIN_PATH_POINTS) {
        ctx.errors.push(`${label}.points: a path needs at least ${MIN_PATH_POINTS} points (got ${points.length}).`);
        return undefined;
      }
      return { type: 'path', points };
    }
    case 'mask': {
      const dataUrl = raw['dataUrl'];
      let ok = true;
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        ctx.errors.push(`${label}.dataUrl: must be an image data URL ("data:image/...").`);
        ok = false;
      } else if (dataUrl.length > MAX_MASK_DATA_URL_LENGTH) {
        ctx.errors.push(
          `${label}.dataUrl: this brush mask is ${(dataUrl.length / 1048576).toFixed(1)} MB, more than the limit of ${MAX_MASK_DATA_URL_LENGTH / 1048576} MB. The file may be damaged.`,
        );
        ok = false;
      }
      const x = reqNum(ctx, raw, 'x', `${label}.x`);
      const y = reqNum(ctx, raw, 'y', `${label}.y`);
      const wIn = reqNum(ctx, raw, 'width', `${label}.width`);
      const hIn = reqNum(ctx, raw, 'height', `${label}.height`);
      if (!ok || x === undefined || y === undefined || wIn === undefined || hIn === undefined) return undefined;
      const width = wIn > 0 ? wIn : (ctx.warnings.push(`${label}.width: ${round(wIn)} must be > 0; set to ${MIN_SHAPE_SIZE}.`), MIN_SHAPE_SIZE);
      const height = hIn > 0 ? hIn : (ctx.warnings.push(`${label}.height: ${round(hIn)} must be > 0; set to ${MIN_SHAPE_SIZE}.`), MIN_SHAPE_SIZE);
      return { type: 'mask', dataUrl: dataUrl as string, x, y, width, height };
    }
    default:
      ctx.errors.push(`${label}.type: unknown shape type ${JSON.stringify(type)} (expected ellipse, path, mask or full).`);
      return undefined;
  }
}

/**
 * A region's dark-spot shade (D05, v0.2). Regions saved before it existed have none: they take the
 * profile's old profile-wide globals.darkSpotShade, so they look exactly as before (no warning:
 * this is the normal upgrade path, not damage).
 */
function regionShade(ctx: Ctx, raw: Obj, fallback: number, label: string): number {
  const v = raw['darkSpotShade'];
  if (v === undefined) return fallback;
  if (!isNum(v)) {
    ctx.warnings.push(`${label}.darkSpotShade: not a finite number; using ${round(fallback)}.`);
    return fallback;
  }
  return clamp(ctx, v, 0, 1, `${label}.darkSpotShade`);
}

function validateRegion(
  ctx: Ctx,
  raw: unknown,
  index: number,
  seenIds: Set<string>,
  fallbackShade: number,
): Region | undefined {
  const label = `regions[${index}]`;
  if (!isObj(raw)) {
    ctx.errors.push(`${label}: must be an object.`);
    return undefined;
  }
  let id: string | undefined;
  const rawId = raw['id'];
  if (typeof rawId !== 'string' || rawId === '') {
    ctx.errors.push(`${label}.id: missing or not a non-empty string.`);
  } else if (seenIds.has(rawId)) {
    id = newId('r');
    ctx.warnings.push(`${label}.id: "${rawId}" is used twice; gave this region a new id.`);
  } else {
    id = rawId;
  }
  if (id !== undefined) seenIds.add(id);

  let name = DEFAULT_REGION_NAME;
  if (typeof raw['name'] === 'string') name = cap(ctx, raw['name'], MAX_NAME_LENGTH, `${label}.name`);
  else ctx.warnings.push(`${label}.name: missing; using "${DEFAULT_REGION_NAME}".`);

  let visible = true;
  if (typeof raw['visible'] === 'boolean') visible = raw['visible'];
  else ctx.warnings.push(`${label}.visible: missing; using true.`);

  const feather = optNum(ctx, raw, 'feather', DEFAULT_FEATHER, 0, 1, `${label}.feather`);
  const shape = validateShape(ctx, raw['shape'], `${label}.shape`);
  const effects = validateEffects(ctx, raw['effects'], `${label}.effects`);
  const darkSpotShade = regionShade(ctx, raw, fallbackShade, label);

  if (id === undefined || shape === undefined) return undefined;
  return { id, name, visible, shape, feather, effects, darkSpotShade };
}

function validateGlobals(ctx: Ctx, raw: unknown): ProfileGlobals {
  const d = defaultGlobals();
  if (raw === undefined) {
    ctx.warnings.push('globals: missing; using defaults.');
    return d;
  }
  if (!isObj(raw)) {
    ctx.warnings.push('globals: not an object; using defaults.');
    return d;
  }
  const ghost = raw['ghostOffset'];
  let ghostOffset = d.ghostOffset;
  if (ghost === undefined) {
    ctx.warnings.push('globals.ghostOffset: missing; using default.');
  } else if (Array.isArray(ghost) && ghost.length === 2 && isNum(ghost[0]) && isNum(ghost[1])) {
    ghostOffset = [
      clamp(ctx, ghost[0], -1, 1, 'globals.ghostOffset[0]'),
      clamp(ctx, ghost[1], -1, 1, 'globals.ghostOffset[1]'),
    ];
  } else {
    ctx.warnings.push('globals.ghostOffset: must be [x, y] numbers; using default.');
  }
  return {
    distortWaveSize: optNum(ctx, raw, 'distortWaveSize', d.distortWaveSize, 0.005, 1, 'globals.distortWaveSize'),
    distortAngle: optNum(ctx, raw, 'distortAngle', d.distortAngle, -Infinity, Infinity, 'globals.distortAngle'),
    distortMaxAmplitude: optNum(ctx, raw, 'distortMaxAmplitude', d.distortMaxAmplitude, 0, 1, 'globals.distortMaxAmplitude'),
    ghostOffset,
    darkSpotShade: optNum(ctx, raw, 'darkSpotShade', d.darkSpotShade, 0, 1, 'globals.darkSpotShade'),
  };
}

function validIso(v: unknown): v is string {
  return typeof v === 'string' && v !== '' && !Number.isNaN(Date.parse(v));
}

// ---------------------------------------------------------------------------------------------
// Public API

/**
 * Validates untrusted input (for example imported JSON) and returns a clean Profile.
 * Errors are collected rather than stopping at the first one.
 */
export function validateProfile(input: unknown): ValidationResult {
  const migrated = migrateProfile(input);
  if (!migrated.ok) return migrated;
  const raw = migrated.data;
  const ctx: Ctx = { errors: [], warnings: [...migrated.warnings] };

  const id = raw['id'];
  if (typeof id !== 'string' || id === '') ctx.errors.push('id: missing or not a non-empty string.');

  let name = DEFAULT_NAME;
  if (typeof raw['name'] === 'string') name = cap(ctx, raw['name'], MAX_NAME_LENGTH, 'name');
  else ctx.warnings.push(`name: missing; using "${DEFAULT_NAME}".`);

  let eye: Eye = 'right';
  if (raw['eye'] === 'left' || raw['eye'] === 'right') eye = raw['eye'];
  else ctx.warnings.push('eye: missing or invalid; using "right".');

  let createdAt: string;
  if (validIso(raw['createdAt'])) {
    createdAt = raw['createdAt'];
  } else {
    createdAt = validIso(raw['updatedAt']) ? raw['updatedAt'] : new Date().toISOString();
    ctx.warnings.push('createdAt: missing or not a valid date; filled in.');
  }
  let updatedAt: string;
  if (validIso(raw['updatedAt'])) {
    updatedAt = raw['updatedAt'];
  } else {
    updatedAt = createdAt;
    ctx.warnings.push('updatedAt: missing or not a valid date; using createdAt.');
  }

  let viewingDistanceCm = DEFAULT_VIEWING_DISTANCE_CM;
  const vd = raw['viewingDistanceCm'];
  if (isNum(vd) && vd > 0) {
    viewingDistanceCm = clamp(ctx, vd, MIN_VIEWING_DISTANCE_CM, MAX_VIEWING_DISTANCE_CM, 'viewingDistanceCm');
  } else {
    ctx.warnings.push(`viewingDistanceCm: missing or not a positive number; using ${DEFAULT_VIEWING_DISTANCE_CM}.`);
  }

  let note = '';
  if (typeof raw['note'] === 'string') note = cap(ctx, raw['note'], MAX_NOTE_LENGTH, 'note');
  else ctx.warnings.push('note: missing; using empty note.');

  const globals = validateGlobals(ctx, raw['globals']);

  const regions: Region[] = [];
  const rawRegions = raw['regions'];
  if (!Array.isArray(rawRegions)) {
    ctx.errors.push('regions: missing or not an array.');
  } else if (rawRegions.length > MAX_REGIONS_PER_PROFILE) {
    ctx.errors.push(
      `regions: this profile has ${rawRegions.length} regions, more than the limit of ${MAX_REGIONS_PER_PROFILE}. The file may be damaged.`,
    );
  } else {
    const seen = new Set<string>();
    rawRegions.forEach((r, i) => {
      const region = validateRegion(ctx, r, i, seen, globals.darkSpotShade);
      if (region) regions.push(region);
    });
  }

  if (ctx.errors.length > 0) return { ok: false, errors: ctx.errors };
  return {
    ok: true,
    warnings: ctx.warnings,
    profile: {
      version: PROFILE_VERSION,
      id: id as string,
      name,
      eye,
      createdAt,
      updatedAt,
      viewingDistanceCm,
      note,
      globals,
      regions,
    },
  };
}

/**
 * Fills fields added after a profile was saved (trusted data from this app's own storage, so no
 * full validation): today only Region.darkSpotShade (D05), taken from the deprecated
 * globals.darkSpotShade. Returns the same object when nothing is missing.
 */
export function upgradeStoredProfile(profile: Profile): Profile {
  const regions = profile.regions;
  if (!Array.isArray(regions) || regions.every((r) => isNum(r.darkSpotShade))) return profile;
  const g = profile.globals?.darkSpotShade;
  const fallback = isNum(g) ? Math.min(1, Math.max(0, g)) : 0;
  return {
    ...profile,
    regions: regions.map((r) => (isNum(r.darkSpotShade) ? r : { ...r, darkSpotShade: fallback })),
  };
}

/** JSON.parse + validateProfile, with a friendly message for text that is not JSON. */
export function parseProfileJson(text: string): ValidationResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['This file is not valid JSON, so it cannot be a profile. Choose a profile file exported from this app.'] };
  }
  return validateProfile(data);
}

/** Pretty-printed JSON for export and backup. */
export function serializeProfile(profile: Profile): string {
  return JSON.stringify(profile, null, 2);
}

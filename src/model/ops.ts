// Pure, immutable profile edits. Every function returns a new Profile (sharing untouched parts)
// and never mutates its input. None of them touch timestamps; the store decides when to stamp
// updatedAt. An unknown region id returns the same profile object unchanged.

import type { Effects, Profile, ProfileGlobals, Region, Shape } from './types';
import { newId } from './defaults';

/** Offset applied to a duplicated region so the copy is visibly separate from the original. */
export const DUPLICATE_OFFSET = 0.02;

function indexOfRegion(profile: Profile, id: string): number {
  return profile.regions.findIndex((r) => r.id === id);
}

function withRegions(profile: Profile, regions: Region[]): Profile {
  return { ...profile, regions };
}

function cloneShape(shape: Shape): Shape {
  switch (shape.type) {
    case 'path':
      return { type: 'path', points: shape.points.map(([x, y]) => [x, y] as [number, number]) };
    default:
      return { ...shape };
  }
}

function cloneRegion(region: Region): Region {
  return { ...region, shape: cloneShape(region.shape), effects: { ...region.effects } };
}

function offsetShape(shape: Shape, d: number): Shape {
  switch (shape.type) {
    case 'ellipse':
      return { ...shape, cx: shape.cx + d, cy: shape.cy + d };
    case 'mask':
      return { ...shape, x: shape.x + d, y: shape.y + d };
    case 'path':
      return { type: 'path', points: shape.points.map(([x, y]) => [x + d, y + d] as [number, number]) };
    case 'full':
      return { type: 'full' };
  }
}

export function findRegion(profile: Profile, id: string): Region | undefined {
  return profile.regions.find((r) => r.id === id);
}

/** Inserts `region` at `index` (clamped to 0..length); appends when omitted. */
export function addRegion(profile: Profile, region: Region, index?: number): Profile {
  const at = index === undefined || !Number.isFinite(index) ? profile.regions.length : Math.min(profile.regions.length, Math.max(0, Math.trunc(index)));
  const regions = profile.regions.slice();
  regions.splice(at, 0, region);
  return withRegions(profile, regions);
}

export function removeRegion(profile: Profile, id: string): Profile {
  if (indexOfRegion(profile, id) < 0) return profile;
  return withRegions(profile, profile.regions.filter((r) => r.id !== id));
}

export function updateRegion(profile: Profile, id: string, patch: Partial<Omit<Region, 'id'>>): Profile {
  const i = indexOfRegion(profile, id);
  if (i < 0) return profile;
  const regions = profile.regions.slice();
  // An `id` smuggled in at runtime must not change the region's identity.
  const { id: _ignored, ...safe } = patch as Partial<Region>;
  regions[i] = { ...(profile.regions[i] as Region), ...safe };
  return withRegions(profile, regions);
}

export function updateEffects(profile: Profile, id: string, effects: Partial<Effects>): Profile {
  const region = findRegion(profile, id);
  if (!region) return profile;
  return updateRegion(profile, id, { effects: { ...region.effects, ...effects } });
}

export function updateShape(profile: Profile, id: string, shape: Shape): Profile {
  return updateRegion(profile, id, { shape });
}

export function setRegionVisible(profile: Profile, id: string, visible: boolean): Profile {
  return updateRegion(profile, id, { visible });
}

/** Copies a region just after the original, offset slightly, with a new id and " copy" in the name. */
export function duplicateRegion(profile: Profile, id: string): { profile: Profile; newId: string | undefined } {
  const i = indexOfRegion(profile, id);
  if (i < 0) return { profile, newId: undefined };
  const original = profile.regions[i] as Region;
  const copyId = newId('r');
  const copy: Region = {
    ...cloneRegion(original),
    id: copyId,
    name: `${original.name} copy`,
    shape: offsetShape(original.shape, DUPLICATE_OFFSET),
  };
  return { profile: addRegion(profile, copy, i + 1), newId: copyId };
}

/** Moves a region to `toIndex` (clamped to the valid range) in the draw order. */
export function moveRegion(profile: Profile, id: string, toIndex: number): Profile {
  const from = indexOfRegion(profile, id);
  if (from < 0 || !Number.isFinite(toIndex)) return profile;
  const to = Math.min(profile.regions.length - 1, Math.max(0, Math.trunc(toIndex)));
  if (to === from) return profile;
  const regions = profile.regions.slice();
  const [moved] = regions.splice(from, 1);
  regions.splice(to, 0, moved as Region);
  return withRegions(profile, regions);
}

export function renameProfile(profile: Profile, name: string): Profile {
  return { ...profile, name };
}

export function updateGlobals(profile: Profile, partial: Partial<ProfileGlobals>): Profile {
  return { ...profile, globals: { ...profile.globals, ...partial } };
}

/** Deep copy with a new profile id, new region ids, and createdAt/updatedAt set to `now`. */
export function duplicateProfile(profile: Profile, now: Date, name?: string): Profile {
  const iso = now.toISOString();
  return {
    ...profile,
    id: newId('p'),
    name: name ?? `${profile.name} copy`,
    createdAt: iso,
    updatedAt: iso,
    globals: { ...profile.globals, ghostOffset: [...profile.globals.ghostOffset] as [number, number] },
    regions: profile.regions.map((r) => ({ ...cloneRegion(r), id: newId('r') })),
  };
}

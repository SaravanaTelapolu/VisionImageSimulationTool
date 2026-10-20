import { beforeEach, describe, expect, it } from 'vitest';
import {
  DUPLICATE_OFFSET,
  addRegion,
  duplicateProfile,
  duplicateRegion,
  findRegion,
  moveRegion,
  removeRegion,
  renameProfile,
  setRegionVisible,
  updateEffects,
  updateGlobals,
  updateRegion,
  updateShape,
} from './ops';
import { newProfile, newRegion } from './defaults';
import type { Profile, Region, Shape } from './types';

function deepFreeze<T>(o: T): T {
  if (typeof o === 'object' && o !== null && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function region(id: string, shape: Shape, name = id): Region {
  return { ...newRegion(shape, name), id };
}

const ell: Shape = { type: 'ellipse', cx: 0.1, cy: -0.1, rx: 0.2, ry: 0.1, rotation: 10 };
const path: Shape = { type: 'path', points: [[0, 0], [0.1, 0], [0.1, 0.1]] };
const mask: Shape = { type: 'mask', dataUrl: 'data:image/png;base64,AAAA', x: 0.3, y: 0.4, width: 0.2, height: 0.2 };

// Profiles are deep-frozen, so any mutation by an op throws in strict mode (ES modules).
let p: Profile;
beforeEach(() => {
  const base = newProfile('Test', new Date('2026-01-01T00:00:00Z'));
  p = deepFreeze({
    ...base,
    regions: [region('a', ell), region('b', path), region('c', { type: 'full' })],
  });
});

const ids = (pr: Profile) => pr.regions.map((r) => r.id);

describe('findRegion', () => {
  it('finds by id', () => {
    expect(findRegion(p, 'b')?.id).toBe('b');
    expect(findRegion(p, 'zzz')).toBeUndefined();
  });
});

describe('addRegion', () => {
  it('appends by default', () => {
    const out = addRegion(p, region('d', ell));
    expect(ids(out)).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(p)).toEqual(['a', 'b', 'c']);
  });
  it('inserts at an index and clamps it', () => {
    expect(ids(addRegion(p, region('d', ell), 1))).toEqual(['a', 'd', 'b', 'c']);
    expect(ids(addRegion(p, region('d', ell), 0))).toEqual(['d', 'a', 'b', 'c']);
    expect(ids(addRegion(p, region('d', ell), 99))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(addRegion(p, region('d', ell), -5))).toEqual(['d', 'a', 'b', 'c']);
  });
  it('does not touch timestamps', () => {
    expect(addRegion(p, region('d', ell)).updatedAt).toBe(p.updatedAt);
  });
});

describe('removeRegion', () => {
  it('removes by id without mutating', () => {
    expect(ids(removeRegion(p, 'b'))).toEqual(['a', 'c']);
    expect(ids(p)).toEqual(['a', 'b', 'c']);
  });
  it('returns the same profile for an unknown id', () => {
    expect(removeRegion(p, 'nope')).toBe(p);
  });
});

describe('updateRegion', () => {
  it('patches fields, keeps the id, leaves others alone', () => {
    const out = updateRegion(p, 'a', { name: 'New', feather: 0.9 });
    expect(findRegion(out, 'a')).toMatchObject({ id: 'a', name: 'New', feather: 0.9 });
    expect(out.regions[1]).toBe(p.regions[1]);
    expect(findRegion(p, 'a')?.name).toBe('a');
  });
  it('cannot change the id even if one is smuggled in', () => {
    const out = updateRegion(p, 'a', { id: 'hacked', name: 'x' } as never);
    expect(ids(out)).toEqual(['a', 'b', 'c']);
    expect(findRegion(out, 'a')?.name).toBe('x');
  });
  it('returns the same profile for an unknown id', () => {
    expect(updateRegion(p, 'nope', { name: 'x' })).toBe(p);
  });
});

describe('updateEffects', () => {
  it('merges partial effects', () => {
    const first = updateEffects(p, 'a', { blur: 12 });
    const out = updateEffects(first, 'a', { darkSpot: 0.5 });
    expect(findRegion(out, 'a')?.effects).toMatchObject({ blur: 12, darkSpot: 0.5, dimming: 0 });
    expect(findRegion(p, 'a')?.effects.blur).toBe(0);
    expect(findRegion(first, 'a')?.effects.darkSpot).toBe(0);
  });
  it('returns the same profile for an unknown id', () => {
    expect(updateEffects(p, 'nope', { blur: 1 })).toBe(p);
  });
});

describe('updateShape', () => {
  it('replaces the shape', () => {
    const out = updateShape(p, 'a', mask);
    expect(findRegion(out, 'a')?.shape).toEqual(mask);
    expect(findRegion(p, 'a')?.shape).toEqual(ell);
  });
  it('returns the same profile for an unknown id', () => {
    expect(updateShape(p, 'nope', mask)).toBe(p);
  });
});

describe('setRegionVisible', () => {
  it('toggles visibility', () => {
    const out = setRegionVisible(p, 'a', false);
    expect(findRegion(out, 'a')?.visible).toBe(false);
    expect(findRegion(p, 'a')?.visible).toBe(true);
    expect(setRegionVisible(p, 'nope', false)).toBe(p);
  });
});

describe('duplicateRegion', () => {
  it('copies an ellipse after the original, offset, with a new id and name', () => {
    const { profile, newId } = duplicateRegion(p, 'a');
    expect(newId).toBeDefined();
    expect(newId).not.toBe('a');
    expect(ids(profile)).toEqual(['a', newId, 'b', 'c']);
    const copy = findRegion(profile, newId!)!;
    expect(copy.name).toBe('a copy');
    expect(copy.shape).toEqual({ ...ell, cx: 0.1 + DUPLICATE_OFFSET, cy: -0.1 + DUPLICATE_OFFSET });
    expect(findRegion(profile, 'a')?.shape).toEqual(ell);
    expect(ids(p)).toEqual(['a', 'b', 'c']);
  });
  it('offsets path points and mask origin, leaves full alone', () => {
    const d = duplicateRegion(p, 'b');
    const ps = findRegion(d.profile, d.newId!)!.shape as { type: string; points: [number, number][] };
    expect(ps.type).toBe('path');
    const want = [[0.02, 0.02], [0.12, 0.02], [0.12, 0.12]];
    ps.points.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(want[i]![0]!, 10);
      expect(y).toBeCloseTo(want[i]![1]!, 10);
    });
    const withMask = addRegion(p, region('m', mask));
    const m = duplicateRegion(withMask, 'm');
    const ms = findRegion(m.profile, m.newId!)?.shape;
    expect(ms).toMatchObject({ type: 'mask', dataUrl: 'data:image/png;base64,AAAA', width: 0.2, height: 0.2 });
    expect((ms as { x: number }).x).toBeCloseTo(0.32, 10);
    expect((ms as { y: number }).y).toBeCloseTo(0.42, 10);
    const f = duplicateRegion(p, 'c');
    expect(findRegion(f.profile, f.newId!)?.shape).toEqual({ type: 'full' });
  });
  it('deep-copies effects and shape', () => {
    const withFx = updateEffects(p, 'a', { blur: 5 });
    const { profile, newId } = duplicateRegion(withFx, 'a');
    const copy = findRegion(profile, newId!)!;
    expect(copy.effects).toEqual(findRegion(withFx, 'a')!.effects);
    expect(copy.effects).not.toBe(findRegion(withFx, 'a')!.effects);
    const d = duplicateRegion(p, 'b');
    const pts = (findRegion(d.profile, d.newId!)!.shape as { points: number[][] }).points;
    expect(pts).not.toBe((p.regions[1]!.shape as { points: number[][] }).points);
  });
  it('returns the profile unchanged for an unknown id', () => {
    const out = duplicateRegion(p, 'nope');
    expect(out.profile).toBe(p);
    expect(out.newId).toBeUndefined();
  });
});

describe('moveRegion', () => {
  it('moves forwards and backwards', () => {
    expect(ids(moveRegion(p, 'a', 2))).toEqual(['b', 'c', 'a']);
    expect(ids(moveRegion(p, 'c', 0))).toEqual(['c', 'a', 'b']);
    expect(ids(moveRegion(p, 'a', 1))).toEqual(['b', 'a', 'c']);
    expect(ids(p)).toEqual(['a', 'b', 'c']);
  });
  it('clamps the target index', () => {
    expect(ids(moveRegion(p, 'a', 50))).toEqual(['b', 'c', 'a']);
    expect(ids(moveRegion(p, 'c', -3))).toEqual(['c', 'a', 'b']);
  });
  it('returns the same profile for no-op moves and unknown ids', () => {
    expect(moveRegion(p, 'a', 0)).toBe(p);
    expect(moveRegion(p, 'nope', 1)).toBe(p);
  });
});

describe('renameProfile / updateGlobals', () => {
  it('renames without touching other fields', () => {
    const out = renameProfile(p, 'Renamed');
    expect(out.name).toBe('Renamed');
    expect(out.regions).toBe(p.regions);
    expect(out.updatedAt).toBe(p.updatedAt);
    expect(p.name).toBe('Test');
  });
  it('merges globals', () => {
    const out = updateGlobals(p, { distortAngle: 80 });
    expect(out.globals).toEqual({ ...p.globals, distortAngle: 80 });
    expect(p.globals.distortAngle).toBe(30);
  });
});

describe('duplicateProfile', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  it('deep copies with new ids and timestamps', () => {
    const src = updateEffects(p, 'a', { blur: 7 });
    const out = duplicateProfile(src, now);
    expect(out.id).not.toBe(src.id);
    expect(out.name).toBe('Test copy');
    expect(out.createdAt).toBe(now.toISOString());
    expect(out.updatedAt).toBe(now.toISOString());
    expect(out.regions).toHaveLength(3);
    for (const [i, r] of out.regions.entries()) {
      const orig = src.regions[i]!;
      expect(r.id).not.toBe(orig.id);
      expect({ ...r, id: '' }).toEqual({ ...orig, id: '' });
      expect(r.effects).not.toBe(orig.effects);
      expect(r.shape).not.toBe(orig.shape);
    }
    expect(new Set(out.regions.map((r) => r.id)).size).toBe(3);
    expect(out.globals).toEqual(src.globals);
    expect(out.globals).not.toBe(src.globals);
    expect(out.globals.ghostOffset).not.toBe(src.globals.ghostOffset);
    const pathOut = out.regions[1]!.shape as { points: number[][] };
    expect(pathOut.points).not.toBe((src.regions[1]!.shape as { points: number[][] }).points);
  });
  it('uses the given name', () => {
    expect(duplicateProfile(p, now, 'Check-up 2').name).toBe('Check-up 2');
  });
});

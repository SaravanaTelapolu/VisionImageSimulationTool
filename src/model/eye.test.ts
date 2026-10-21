import { describe, expect, it } from 'vitest';
import { newProfile } from './defaults';
import {
  EYES,
  FALLBACK_EYE,
  autoProfileName,
  eyeLabel,
  isAutoProfileName,
  isEye,
  renameAutoForEye,
  withEye,
} from './eye';

describe('eye basics', () => {
  it('knows the two eyes and the fallback', () => {
    expect(EYES).toEqual(['left', 'right']);
    expect(FALLBACK_EYE).toBe('right');
    expect(isEye('left')).toBe(true);
    expect(isEye('right')).toBe(true);
    for (const v of ['Left', 'both', '', null, undefined, 1, {}]) expect(isEye(v)).toBe(false);
  });

  it('labels eyes and makes automatic names', () => {
    expect(eyeLabel('left')).toBe('Left eye');
    expect(eyeLabel('right')).toBe('Right eye');
    expect(autoProfileName('left')).toBe('Left eye');
    expect(autoProfileName('right')).toBe('Right eye');
  });
});

describe('automatic names', () => {
  it('recognises the automatic name for the given eye only', () => {
    expect(isAutoProfileName('Right eye', 'right')).toBe(true);
    expect(isAutoProfileName('Right eye — 2026-10-20', 'right')).toBe(true);
    expect(isAutoProfileName('Left eye', 'right')).toBe(false);
    expect(isAutoProfileName('Right eye, October', 'right')).toBe(false);
    expect(isAutoProfileName('right eye', 'right')).toBe(false);
    expect(isAutoProfileName('Right eye — check-up', 'right')).toBe(false);
    expect(isAutoProfileName('My eye', 'left')).toBe(false);
  });

  it('renames only an automatic name for the old eye, keeping a check-up date', () => {
    expect(renameAutoForEye('Right eye', 'right', 'left')).toBe('Left eye');
    expect(renameAutoForEye('Left eye', 'left', 'right')).toBe('Right eye');
    expect(renameAutoForEye('Right eye — 2026-10-20', 'right', 'left')).toBe('Left eye — 2026-10-20');
    expect(renameAutoForEye('Dad’s map', 'right', 'left')).toBe('Dad’s map');
    expect(renameAutoForEye('Left eye', 'right', 'left')).toBe('Left eye'); // not the old eye's name
    expect(renameAutoForEye('Right eye', 'right', 'right')).toBe('Right eye');
  });

  it('withEye changes the eye, follows an automatic name, keeps a typed one', () => {
    const p = newProfile(undefined, new Date(0), 40, 'right');
    expect(p.name).toBe('Right eye');
    const l = withEye(p, 'left');
    expect(l).not.toBe(p);
    expect(l.eye).toBe('left');
    expect(l.name).toBe('Left eye');
    expect(withEye(l, 'right').name).toBe('Right eye');

    const typed = { ...p, name: 'October check' };
    expect(withEye(typed, 'left')).toMatchObject({ eye: 'left', name: 'October check' });
    expect(withEye(p, 'right')).toBe(p); // no change, same object (no undo step)
  });
});

describe('newProfile eye', () => {
  it('uses the fallback eye by default and names itself after the eye', () => {
    expect(newProfile()).toMatchObject({ eye: 'right', name: 'Right eye' });
    expect(newProfile(undefined, new Date(), 40, 'left')).toMatchObject({ eye: 'left', name: 'Left eye' });
    expect(newProfile('Mine', new Date(), 40, 'left')).toMatchObject({ eye: 'left', name: 'Mine' });
  });
});

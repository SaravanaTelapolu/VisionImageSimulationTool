import { describe, expect, it } from 'vitest';
import { defaultEllipse, newProfile, newRegion } from '../../../model/defaults';
import { addRegion } from '../../../model/ops';
import { MAX_BLUR_PX, MAX_SIZE_CHANGE, type EffectKey, type ShapeType } from '../../../model/types';
import { EFFECT_DEFS, EFFECT_GROUPS, EFFECT_ORDER, isEffectEnabled, isFeatherEnabled } from './effectDefs';
import { setEffect, setEye, setFeather, setGhostOffset, setGlobal, setViewingDistance } from './edits';

const ALL_KEYS: EffectKey[] = [
  'blur',
  'darkSpot',
  'fillIn',
  'distortion',
  'sizeChange',
  'contrastLoss',
  'dimming',
  'colourFade',
  'doubleImage',
];

function sample() {
  const region = newRegion(defaultEllipse(), 'Spot 1');
  return { region, profile: addRegion(newProfile(), region) };
}

describe('effect definitions', () => {
  it('covers every effect exactly once, in four groups', () => {
    expect([...EFFECT_ORDER].sort()).toEqual([...ALL_KEYS].sort());
    expect(EFFECT_GROUPS.map((g) => g.title)).toEqual(['Sharpness', 'Spots', 'Shape', 'Tone']);
  });
  it('has the ranges from the spec', () => {
    expect(EFFECT_DEFS.blur).toMatchObject({ min: 0, max: MAX_BLUR_PX, unit: 'px' });
    expect(EFFECT_DEFS.sizeChange).toMatchObject({ min: -MAX_SIZE_CHANGE, max: MAX_SIZE_CHANGE });
    for (const k of ALL_KEYS.filter((k) => k !== 'blur' && k !== 'sizeChange')) {
      expect(EFFECT_DEFS[k]).toMatchObject({ min: 0, max: 1, scale: 100, unit: '%' });
    }
  });
  it('enables size change only for ellipses', () => {
    const types: ShapeType[] = ['ellipse', 'path', 'mask', 'full'];
    for (const t of types) {
      expect(isEffectEnabled('sizeChange', t)).toBe(t === 'ellipse');
      expect(isEffectEnabled('blur', t)).toBe(true);
    }
  });
  it('disables feather for whole-image regions only', () => {
    expect(isFeatherEnabled('full')).toBe(false);
    expect(isFeatherEnabled('ellipse')).toBe(true);
    expect(isFeatherEnabled('mask')).toBe(true);
  });
});

describe('edits', () => {
  it('sets an effect immutably and clamps to range', () => {
    const { region, profile } = sample();
    const next = setEffect(profile, region.id, 'blur', 99);
    expect(next.regions[0]?.effects.blur).toBe(MAX_BLUR_PX);
    expect(profile.regions[0]?.effects.blur).toBe(0);
    expect(setEffect(profile, region.id, 'sizeChange', -5).regions[0]?.effects.sizeChange).toBe(-MAX_SIZE_CHANGE);
  });
  it('returns the same profile for no-ops and unknown regions', () => {
    const { region, profile } = sample();
    expect(setEffect(profile, region.id, 'blur', 0)).toBe(profile);
    expect(setEffect(profile, 'nope', 'blur', 3)).toBe(profile);
    expect(setFeather(profile, region.id, region.feather)).toBe(profile);
    expect(setEye(profile, profile.eye)).toBe(profile);
  });
  it('sets feather, globals, ghost offset, distance and eye', () => {
    const { region, profile } = sample();
    expect(setFeather(profile, region.id, 2).regions[0]?.feather).toBe(1);
    expect(setGlobal(profile, 'distortWaveSize', 0.5).globals.distortWaveSize).toBe(0.2);
    expect(setGlobal(profile, 'distortAngle', 90).globals.distortAngle).toBe(90);
    expect(setGlobal(profile, 'distortMaxAmplitude', 0.04).globals.distortMaxAmplitude).toBe(0.04);
    expect(setGlobal(profile, 'darkSpotShade', 0.5).globals.darkSpotShade).toBe(0.5);
    const g = setGhostOffset(setGhostOffset(profile, 0, 0.03), 1, -0.9);
    expect(g.globals.ghostOffset).toEqual([0.03, -0.05]);
    expect(profile.globals.ghostOffset).toEqual([0.01, 0]);
    expect(setViewingDistance(profile, 500).viewingDistanceCm).toBe(150);
    expect(setViewingDistance(profile, 3).viewingDistanceCm).toBe(10);
    expect(setEye(profile, 'left').eye).toBe('left');
  });
});

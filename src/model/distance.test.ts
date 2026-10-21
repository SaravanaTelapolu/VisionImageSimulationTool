import { describe, expect, it } from 'vitest';
import { newProfile } from './defaults';
import {
  DEFAULT_VIEWING_DISTANCE_CM,
  DISTANCE_PRESETS,
  MAX_VIEWING_DISTANCE_CM,
  MIN_VIEWING_DISTANCE_CM,
  distanceBand,
  distanceLabel,
  formatDistance,
  sanitizeDefaultDistance,
} from './distance';
import { validateProfile } from './validate';

describe('viewing distance bands', () => {
  it('labels <= 60 cm Near, 61-150 cm Computer, > 150 cm Far', () => {
    expect(distanceBand(10)).toBe('Near');
    expect(distanceBand(40)).toBe('Near');
    expect(distanceBand(60)).toBe('Near');
    expect(distanceBand(60.5)).toBe('Computer');
    expect(distanceBand(61)).toBe('Computer');
    expect(distanceBand(70)).toBe('Computer');
    expect(distanceBand(150)).toBe('Computer');
    expect(distanceBand(150.5)).toBe('Far');
    expect(distanceBand(151)).toBe('Far');
    expect(distanceBand(300)).toBe('Far');
    expect(distanceBand(600)).toBe('Far');
  });

  it('formats a label with the distance', () => {
    expect(distanceLabel(40)).toBe('Near · 40 cm');
    expect(distanceLabel(37.46)).toBe('Near · 37.5 cm');
    expect(distanceLabel(300)).toBe('Far · 300 cm');
    expect(formatDistance(70)).toBe('70 cm');
  });

  it('has the Near / Computer / Far presets at 40, 70 and 300 cm', () => {
    expect(DISTANCE_PRESETS.map((p) => p.cm)).toEqual([40, 70, 300]);
    expect(DISTANCE_PRESETS.map((p) => distanceBand(p.cm))).toEqual(['Near', 'Computer', 'Far']);
  });
});

describe('range and defaults', () => {
  it('allows 10 to 600 cm', () => {
    expect(MIN_VIEWING_DISTANCE_CM).toBe(10);
    expect(MAX_VIEWING_DISTANCE_CM).toBe(600);
  });

  it('validation keeps 600 cm and clamps above it', () => {
    const base = newProfile();
    expect(validateProfile({ ...base, viewingDistanceCm: 600 })).toMatchObject({ ok: true, profile: { viewingDistanceCm: 600 } });
    const hi = validateProfile({ ...base, viewingDistanceCm: 601 });
    expect(hi).toMatchObject({ ok: true, profile: { viewingDistanceCm: 600 } });
    const lo = validateProfile({ ...base, viewingDistanceCm: 9 });
    expect(lo).toMatchObject({ ok: true, profile: { viewingDistanceCm: 10 } });
  });

  it('sanitizeDefaultDistance clamps, rounds and falls back to 40', () => {
    expect(sanitizeDefaultDistance(300)).toBe(300);
    expect(sanitizeDefaultDistance(5000)).toBe(600);
    expect(sanitizeDefaultDistance(2)).toBe(10);
    expect(sanitizeDefaultDistance(37.46)).toBe(37.5);
    expect(sanitizeDefaultDistance('far')).toBe(DEFAULT_VIEWING_DISTANCE_CM);
    expect(sanitizeDefaultDistance(NaN)).toBe(DEFAULT_VIEWING_DISTANCE_CM);
    expect(sanitizeDefaultDistance(undefined)).toBe(DEFAULT_VIEWING_DISTANCE_CM);
  });

  it('model newProfile takes an optional distance and defaults to 40', () => {
    expect(newProfile().viewingDistanceCm).toBe(40);
    expect(newProfile('x', new Date(), 300).viewingDistanceCm).toBe(300);
  });
});

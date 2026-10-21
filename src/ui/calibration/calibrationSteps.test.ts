import { describe, expect, it } from 'vitest';
import {
  STEP_COUNT,
  calibrationReducer as reduce,
  initialCalibrationState as init,
  isFirstStep,
  isLastStep,
  stepId,
} from './calibrationSteps';
import {
  eyeName,
  eyeNameCapitalised,
  goodEyeName,
  otherEye,
  parseDistanceCm,
  stepIndicator,
} from './calibrationText';

describe('calibrationReducer', () => {
  it('starts at step 0 with 5 steps', () => {
    expect(init.step).toBe(0);
    expect(STEP_COUNT).toBe(5);
    expect(isFirstStep(init)).toBe(true);
  });

  it('advances and goes back', () => {
    const s1 = reduce(init, { type: 'next' });
    expect(s1.step).toBe(1);
    expect(stepId(s1)).toBe('look');
    expect(reduce(s1, { type: 'back' }).step).toBe(0);
  });

  it('is bounded at both ends', () => {
    expect(reduce(init, { type: 'back' })).toBe(init);
    let s = init;
    for (let i = 0; i < 10; i++) s = reduce(s, { type: 'next' });
    expect(s.step).toBe(STEP_COUNT - 1);
    expect(isLastStep(s)).toBe(true);
    expect(reduce(s, { type: 'next' })).toBe(s);
  });

  it('goTo clamps', () => {
    expect(reduce(init, { type: 'goTo', step: 99 }).step).toBe(STEP_COUNT - 1);
    expect(reduce(init, { type: 'goTo', step: -3 }).step).toBe(0);
    expect(reduce(init, { type: 'goTo', step: NaN }).step).toBe(0);
  });

  it('sets the image and keeps the step', () => {
    const s = reduce(reduce(init, { type: 'next' }), { type: 'setImage', image: 'photo' });
    expect(s).toEqual({ step: 1, image: 'photo' });
  });

  it('resets', () => {
    const s = reduce(reduce(init, { type: 'next' }), { type: 'setImage', image: 'photo' });
    expect(reduce(s, { type: 'reset' })).toEqual(init);
  });
});

describe('eye text helpers', () => {
  it('names the eyes from the prop', () => {
    expect(eyeName('right')).toBe('right eye');
    expect(eyeName('left')).toBe('left eye');
    expect(eyeNameCapitalised('left')).toBe('Left eye');
    expect(otherEye('right')).toBe('left');
    expect(goodEyeName('right')).toBe('left eye');
    expect(goodEyeName('left')).toBe('right eye');
  });

  it('formats the step indicator', () => {
    expect(stepIndicator(1)).toBe('Step 2 of 5');
    expect(stepIndicator(0)).toBe('Step 1 of 5');
    expect(stepIndicator(99)).toBe('Step 5 of 5');
  });

  it('parses distances', () => {
    expect(parseDistanceCm('40')).toBe(40);
    expect(parseDistanceCm(' 35,5 ')).toBe(35.5);
    expect(parseDistanceCm('')).toBeNull();
    expect(parseDistanceCm('abc')).toBeNull();
    expect(parseDistanceCm('5')).toBeNull();
    expect(parseDistanceCm('700')).toBeNull();
    expect(parseDistanceCm('500')).toBe(500);
  });
});

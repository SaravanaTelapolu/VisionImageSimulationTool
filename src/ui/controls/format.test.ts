import { describe, expect, it } from 'vitest';
import {
  clamp,
  decimalsForStep,
  formatValue,
  formatWithUnit,
  percentToValue,
  snapToStep,
  valueToPercent,
} from './format';

describe('clamp', () => {
  it('limits to the range and handles NaN', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(Number.NaN, 2, 3)).toBe(2);
  });
});

describe('decimalsForStep', () => {
  it('counts decimals', () => {
    expect(decimalsForStep(1)).toBe(0);
    expect(decimalsForStep(0.5)).toBe(1);
    expect(decimalsForStep(0.01)).toBe(2);
    expect(decimalsForStep(0.005)).toBe(3);
    expect(decimalsForStep(0)).toBe(0);
  });
});

describe('snapToStep', () => {
  it('snaps onto the step grid without float noise', () => {
    expect(snapToStep(0.123, 0, 1, 0.01)).toBe(0.12);
    expect(snapToStep(0.3000001, 0, 1, 0.1)).toBe(0.3);
    expect(snapToStep(2.2, 0, 40, 0.5)).toBe(2);
    expect(snapToStep(0.0123, 0.01, 0.2, 0.005)).toBe(0.01);
  });
  it('clamps', () => {
    expect(snapToStep(99, 0, 40, 0.5)).toBe(40);
    expect(snapToStep(-99, -0.3, 0.3, 0.01)).toBe(-0.3);
  });
});

describe('formatValue / formatWithUnit', () => {
  it('shows fractions as percent', () => {
    expect(formatValue(0.37, { scale: 100, step: 0.01 })).toBe('37');
    expect(formatWithUnit(0.37, '%', { scale: 100, step: 0.01 })).toBe('37%');
  });
  it('keeps decimals for fine steps', () => {
    expect(formatWithUnit(0.0125, '%', { scale: 100, step: 0.001 })).toBe('1.3%');
    expect(formatWithUnit(12.5, 'px', { step: 0.5 })).toBe('12.5 px');
  });
  it('separates cm and px but not % or degrees', () => {
    expect(formatWithUnit(40, 'cm', { step: 1 })).toBe('40 cm');
    expect(formatWithUnit(30, '°', { step: 1 })).toBe('30°');
  });
  it('signs positives when asked and never shows -0', () => {
    const o = { scale: 100, step: 0.01, signed: true };
    expect(formatWithUnit(0.12, '%', o)).toBe('+12%');
    expect(formatWithUnit(-0.12, '%', o)).toBe('-12%');
    expect(formatWithUnit(-0.0001, '%', o)).toBe('0%');
    expect(formatWithUnit(0, '%', o)).toBe('0%');
  });
  it('omits the unit when none is given', () => {
    expect(formatWithUnit(3, undefined, { step: 1 })).toBe('3');
  });
});

describe('range mapping', () => {
  it('maps value to percent of the range', () => {
    expect(valueToPercent(0, -0.3, 0.3)).toBeCloseTo(50);
    expect(valueToPercent(40, 0, 40)).toBe(100);
    expect(valueToPercent(5, 0, 0)).toBe(0);
    expect(valueToPercent(99, 0, 40)).toBe(100);
  });
  it('maps percent back to a snapped value', () => {
    expect(percentToValue(50, 0, 40, 0.5)).toBe(20);
    expect(percentToValue(25, 0, 0.05, 0.001)).toBe(0.013);
    expect(percentToValue(150, 0, 1, 0.01)).toBe(1);
  });
});

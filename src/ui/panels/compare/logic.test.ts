import { describe, expect, it } from 'vitest';
import { TAB_IDS } from '../../../state/store';
import { COMPARE_MODES } from '../../../state/ui';
import { TAB_LABELS } from '../../tabs';
import { chooseSideBySideLayout, clampWipe, clipLeft, wipeAfterKey, wipeFromClientX } from './logic';

describe('clampWipe', () => {
  it('keeps values inside 0..1', () => {
    expect(clampWipe(-0.3)).toBe(0);
    expect(clampWipe(1.7)).toBe(1);
    expect(clampWipe(0.25)).toBe(0.25);
  });
  it('falls back to the middle for non-numbers', () => {
    expect(clampWipe(Number.NaN)).toBe(0.5);
    expect(clampWipe(Number.POSITIVE_INFINITY)).toBe(0.5);
  });
});

describe('wipeAfterKey', () => {
  it('moves with the arrow keys and clamps at the ends', () => {
    expect(wipeAfterKey(0.5, 'ArrowRight')).toBeCloseTo(0.52);
    expect(wipeAfterKey(0.5, 'ArrowLeft')).toBeCloseTo(0.48);
    expect(wipeAfterKey(0.5, 'ArrowRight', true)).toBeCloseTo(0.6);
    expect(wipeAfterKey(0.01, 'ArrowLeft')).toBe(0);
    expect(wipeAfterKey(0.99, 'ArrowRight')).toBe(1);
  });
  it('jumps with Home and End, ignores other keys', () => {
    expect(wipeAfterKey(0.4, 'Home')).toBe(0);
    expect(wipeAfterKey(0.4, 'End')).toBe(1);
    expect(wipeAfterKey(0.4, 'a')).toBeNull();
  });
});

describe('wipeFromClientX', () => {
  it('maps a pointer position to a fraction of the box', () => {
    expect(wipeFromClientX(150, 100, 200)).toBeCloseTo(0.25);
    expect(wipeFromClientX(50, 100, 200)).toBe(0);
    expect(wipeFromClientX(900, 100, 200)).toBe(1);
    expect(wipeFromClientX(150, 100, 0)).toBe(0.5);
  });
});

describe('clipLeft', () => {
  it('converts the screen divider into layer pixels', () => {
    // 1000 px wide layer drawn at scale 0.5 from screen x=50; box 600 wide; divider at 50% = x 300.
    expect(clipLeft(0.5, 600, 50, 0.5, 1000)).toBe(500);
  });
  it('clamps when the divider is outside the image', () => {
    expect(clipLeft(0, 600, 50, 0.5, 1000)).toBe(0);
    expect(clipLeft(1, 600, 50, 0.5, 1000)).toBe(1000);
  });
  it('is safe for a zero scale', () => {
    expect(clipLeft(0.5, 600, 0, 0, 1000)).toBe(0);
  });
});

describe('chooseSideBySideLayout', () => {
  it('stacks on portrait areas', () => {
    expect(chooseSideBySideLayout({ width: 360, height: 400 })).toBe('stacked');
    expect(chooseSideBySideLayout({ width: 500, height: 500 })).toBe('stacked');
  });
  it('goes side by side on wide areas', () => {
    expect(chooseSideBySideLayout({ width: 900, height: 600 })).toBe('side-by-side');
  });
});

describe('tabs and modes', () => {
  it('lists five tabs with Profiles last', () => {
    expect(TAB_IDS).toEqual(['regions', 'effects', 'compare', 'export', 'profiles']);
  });
  it('has a short, unique label for every tab', () => {
    const labels = TAB_IDS.map((t) => TAB_LABELS[t]);
    expect(new Set(labels).size).toBe(TAB_IDS.length);
    for (const l of labels) expect(l.length).toBeLessThanOrEqual(8);
  });
  it('offers single, wipe and side-by-side', () => {
    expect(COMPARE_MODES).toEqual(['single', 'wipe', 'side']);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { activeTab } from '../state/store';
import { compareMode } from '../state/ui';
import { announce, announcement } from './announce';
import { SWITCHED_TO_SINGLE_MESSAGE, installCompareAutoSwitch, mustLeaveSideBySide } from './compareSwitch';

afterEach(() => {
  compareMode.value = 'single';
  activeTab.value = 'regions';
  announce('');
});

describe('mustLeaveSideBySide', () => {
  it('is true only for side by side on an editing tab', () => {
    expect(mustLeaveSideBySide('side', 'regions')).toBe(true);
    expect(mustLeaveSideBySide('side', 'effects')).toBe(true);
    expect(mustLeaveSideBySide('side', 'compare')).toBe(false);
    expect(mustLeaveSideBySide('side', 'export')).toBe(false);
    expect(mustLeaveSideBySide('side', 'profiles')).toBe(false);
    expect(mustLeaveSideBySide('wipe', 'regions')).toBe(false);
    expect(mustLeaveSideBySide('single', 'effects')).toBe(false);
  });
});

describe('installCompareAutoSwitch', () => {
  it('goes back to Single when an editing tab is opened, and says so', () => {
    activeTab.value = 'compare';
    compareMode.value = 'side';
    const stop = installCompareAutoSwitch();
    expect(compareMode.value).toBe('side'); // the Compare tab itself may stay in side by side
    activeTab.value = 'export';
    expect(compareMode.value).toBe('side');
    activeTab.value = 'effects';
    expect(compareMode.value).toBe('single');
    expect(announcement.value).toBe(SWITCHED_TO_SINGLE_MESSAGE);
    stop();
  });

  it('also fixes a state that is already wrong when it starts', () => {
    activeTab.value = 'regions';
    compareMode.value = 'side';
    const stop = installCompareAutoSwitch();
    expect(compareMode.value).toBe('single');
    stop();
  });

  it('leaves Wipe alone and stops after being disposed', () => {
    activeTab.value = 'compare';
    compareMode.value = 'wipe';
    const stop = installCompareAutoSwitch();
    activeTab.value = 'regions';
    expect(compareMode.value).toBe('wipe');
    stop();
    activeTab.value = 'compare';
    compareMode.value = 'side';
    activeTab.value = 'regions';
    expect(compareMode.value).toBe('side');
  });
});

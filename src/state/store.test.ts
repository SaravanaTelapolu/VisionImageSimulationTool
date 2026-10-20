import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newProfile } from '../model/defaults';
import { UNDO_LIMIT, type Profile } from '../model/types';
import {
  applyEdit,
  canRedo,
  canUndo,
  endEdit,
  flipView,
  fixation,
  profile,
  redo,
  resetProfile,
  setUiTextScale,
  setWorkingImage,
  uiTextScale,
  undo,
  viewMode,
} from './store';

const rename = (name: string) => (p: Profile): Profile => ({ ...p, name });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  resetProfile(newProfile('Start'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('applyEdit / undo / redo', () => {
  it('starts with nothing to undo or redo', () => {
    expect(canUndo.value).toBe(false);
    expect(canRedo.value).toBe(false);
  });

  it('applies, undoes and redoes an edit', () => {
    applyEdit(rename('A'));
    expect(profile.value.name).toBe('A');
    expect(canUndo.value).toBe(true);
    undo();
    expect(profile.value.name).toBe('Start');
    expect(canUndo.value).toBe(false);
    expect(canRedo.value).toBe(true);
    redo();
    expect(profile.value.name).toBe('A');
    expect(canRedo.value).toBe(false);
  });

  it('does nothing when undo/redo stacks are empty', () => {
    undo();
    redo();
    expect(profile.value.name).toBe('Start');
  });

  it('sets updatedAt on every edit', () => {
    const before = profile.value.updatedAt;
    vi.setSystemTime(new Date('2026-02-03T04:05:06Z'));
    applyEdit(rename('A'));
    expect(profile.value.updatedAt).toBe('2026-02-03T04:05:06.000Z');
    expect(profile.value.updatedAt).not.toBe(before);
  });

  it('ignores an edit that returns the same profile', () => {
    applyEdit((p) => p);
    expect(canUndo.value).toBe(false);
  });

  it('clears the redo stack on a new edit', () => {
    applyEdit(rename('A'));
    undo();
    expect(canRedo.value).toBe(true);
    applyEdit(rename('B'));
    expect(canRedo.value).toBe(false);
  });

  it('keeps separate undo steps for edits without a key', () => {
    applyEdit(rename('A'));
    applyEdit(rename('B'));
    undo();
    expect(profile.value.name).toBe('A');
    undo();
    expect(profile.value.name).toBe('Start');
  });

  it('keeps at least 100 undo steps and caps the stack', () => {
    for (let i = 1; i <= UNDO_LIMIT + 20; i++) applyEdit(rename(`n${i}`));
    let steps = 0;
    while (canUndo.value) {
      undo();
      steps++;
    }
    expect(steps).toBe(UNDO_LIMIT);
    expect(UNDO_LIMIT).toBeGreaterThanOrEqual(100);
  });
});

describe('coalescing', () => {
  it('merges consecutive edits with the same key into one undo step', () => {
    applyEdit(rename('A'), 'k');
    applyEdit(rename('B'), 'k');
    applyEdit(rename('C'), 'k');
    expect(profile.value.name).toBe('C');
    undo();
    expect(profile.value.name).toBe('Start');
    expect(canUndo.value).toBe(false);
    redo();
    expect(profile.value.name).toBe('C');
  });

  it('starts a new step when the key changes', () => {
    applyEdit(rename('A'), 'k1');
    applyEdit(rename('B'), 'k2');
    undo();
    expect(profile.value.name).toBe('A');
  });

  it('endEdit() ends the run', () => {
    applyEdit(rename('A'), 'k');
    endEdit();
    applyEdit(rename('B'), 'k');
    undo();
    expect(profile.value.name).toBe('A');
    undo();
    expect(profile.value.name).toBe('Start');
  });

  it('undo() ends the run, so the next same-key edit is a new step', () => {
    applyEdit(rename('A'), 'k');
    applyEdit(rename('B'), 'k');
    undo();
    applyEdit(rename('C'), 'k');
    undo();
    expect(profile.value.name).toBe('Start');
    expect(canUndo.value).toBe(false);
  });

  it('a keyless edit breaks a run', () => {
    applyEdit(rename('A'), 'k');
    applyEdit(rename('B'));
    applyEdit(rename('C'), 'k');
    undo();
    expect(profile.value.name).toBe('B');
  });

  it('still updates updatedAt while merging', () => {
    applyEdit(rename('A'), 'k');
    vi.setSystemTime(new Date('2026-05-05T00:00:00Z'));
    applyEdit(rename('B'), 'k');
    expect(profile.value.updatedAt).toBe('2026-05-05T00:00:00.000Z');
  });
});

describe('resetProfile', () => {
  it('clears history', () => {
    applyEdit(rename('A'));
    undo();
    resetProfile(newProfile('Fresh'));
    expect(profile.value.name).toBe('Fresh');
    expect(canUndo.value).toBe(false);
    expect(canRedo.value).toBe(false);
  });
});

describe('image and view', () => {
  it('setWorkingImage centres the fixation and shows the simulation', () => {
    flipView();
    expect(viewMode.value).toBe('original');
    setWorkingImage({} as CanvasImageSource, 400, 300, 'test');
    expect(fixation.value).toEqual({ x: 200, y: 150 });
    expect(viewMode.value).toBe('simulated');
  });

  it('flipView toggles', () => {
    flipView();
    expect(viewMode.value).toBe('original');
    flipView();
    expect(viewMode.value).toBe('simulated');
  });
});

describe('uiTextScale', () => {
  it('clamps to 0.85..1.5', () => {
    setUiTextScale(5);
    expect(uiTextScale.value).toBe(1.5);
    setUiTextScale(0.1);
    expect(uiTextScale.value).toBe(0.85);
    setUiTextScale(1.1);
    expect(uiTextScale.value).toBe(1.1);
  });
});

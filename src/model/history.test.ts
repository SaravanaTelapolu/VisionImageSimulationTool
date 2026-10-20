import { describe, expect, it } from 'vitest';
import { History } from './history';
import { UNDO_LIMIT } from './types';

describe('History', () => {
  it('starts with the initial state and nothing to undo or redo', () => {
    const h = new History(0);
    expect(h.present).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBeUndefined();
    expect(h.redo()).toBeUndefined();
  });

  it('pushes, undoes and redoes', () => {
    const h = new History(0);
    h.push(1);
    h.push(2);
    expect(h.present).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe(1);
    expect(h.redo()).toBe(2);
    expect(h.canRedo).toBe(false);
    expect(h.undoCount).toBe(2);
    expect(h.redoCount).toBe(0);
  });

  it('clears redo on push', () => {
    const h = new History(0);
    h.push(1);
    h.push(2);
    h.undo();
    h.push(9);
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeUndefined();
    expect(h.undo()).toBe(1);
  });

  it('defaults the limit to UNDO_LIMIT and drops the oldest entries beyond it', () => {
    const h = new History(0);
    for (let i = 1; i <= UNDO_LIMIT + 20; i++) h.push(i);
    expect(h.undoCount).toBe(UNDO_LIMIT);
    let last: number | undefined;
    while (h.canUndo) last = h.undo();
    expect(last).toBe(20);
  });

  it('honours a custom limit', () => {
    const h = new History(0, 3);
    for (let i = 1; i <= 10; i++) h.push(i);
    expect(h.undoCount).toBe(3);
    h.undo();
    h.undo();
    expect(h.undo()).toBe(7);
    expect(h.undo()).toBeUndefined();
  });

  it('with limit 0 keeps no undo steps', () => {
    const h = new History(0, 0);
    h.push(1);
    expect(h.present).toBe(1);
    expect(h.canUndo).toBe(false);
  });

  describe('coalescing', () => {
    it('merges consecutive pushes with the same key into one undo step', () => {
      const h = new History(0);
      h.push(1, 'slider');
      h.push(2, 'slider');
      h.push(3, 'slider');
      expect(h.present).toBe(3);
      expect(h.undoCount).toBe(1);
      expect(h.undo()).toBe(0);
      expect(h.redo()).toBe(3);
    });

    it('starts a new step when the key differs or is absent', () => {
      const h = new History(0);
      h.push(1, 'a');
      h.push(2, 'b');
      h.push(3);
      h.push(4, 'b');
      expect(h.undoCount).toBe(4);
    });

    it('treats an empty key as no key', () => {
      const h = new History(0);
      h.push(1, '');
      h.push(2, '');
      expect(h.undoCount).toBe(2);
    });

    it('does not merge a keyed push into an earlier un-keyed entry', () => {
      const h = new History(0);
      h.push(1);
      h.push(2, 'k');
      expect(h.undoCount).toBe(2);
      expect(h.undo()).toBe(1);
    });

    it('endCoalesce breaks the chain', () => {
      const h = new History(0);
      h.push(1, 'k');
      h.push(2, 'k');
      h.endCoalesce();
      h.push(3, 'k');
      h.push(4, 'k');
      expect(h.undoCount).toBe(2);
      expect(h.undo()).toBe(2);
      expect(h.undo()).toBe(0);
    });

    it('undo and redo break the chain', () => {
      const h = new History(0);
      h.push(1, 'k');
      h.undo();
      h.push(2, 'k');
      expect(h.undoCount).toBe(1);
      expect(h.present).toBe(2);
      h.push(3, 'k');
      h.undo();
      h.redo();
      h.push(4, 'k');
      expect(h.undoCount).toBe(2);
    });

    it('survives limit trimming while coalescing', () => {
      const h = new History(0, 2);
      h.push(1);
      h.push(2);
      h.push(3, 'k');
      h.push(4, 'k');
      expect(h.undoCount).toBe(2);
      expect(h.present).toBe(4);
      expect(h.undo()).toBe(2);
      expect(h.undo()).toBe(1);
      expect(h.undo()).toBeUndefined();
    });
  });

  it('reset replaces everything', () => {
    const h = new History('a');
    h.push('b', 'k');
    h.undo();
    h.reset('z');
    expect(h.present).toBe('z');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    h.push('y', 'k');
    h.push('x', 'k');
    expect(h.undoCount).toBe(1);
  });
});

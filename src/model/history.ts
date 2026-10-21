// Generic undo/redo history. States are treated as immutable values (push a new object, never
// mutate one that is already in the history).

import { UNDO_LIMIT } from './types';

export class History<T> {
  private entries: T[];
  private index = 0;
  private lastKey: string | undefined;
  private readonly limit: number;

  /** `limit` is the maximum number of undo steps kept; the oldest are dropped beyond it. */
  constructor(initial: T, limit: number = UNDO_LIMIT) {
    this.entries = [initial];
    this.limit = Math.max(0, Math.floor(limit));
  }

  get present(): T {
    return this.entries[this.index] as T;
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.entries.length - 1;
  }

  /** Number of undo steps currently available. */
  get undoCount(): number {
    return this.index;
  }

  /** Number of redo steps currently available. */
  get redoCount(): number {
    return this.entries.length - 1 - this.index;
  }

  /**
   * Records a new present state and clears redo. Consecutive pushes with the same non-empty
   * `coalesceKey` replace the newest entry, so one slider drag is a single undo step.
   */
  push(next: T, coalesceKey?: string): void {
    const key = coalesceKey === '' ? undefined : coalesceKey;
    if (key !== undefined && key === this.lastKey && this.index > 0) {
      // The newest entry was created by a push with this key; overwrite it (redo is already empty).
      this.entries[this.index] = next;
      return;
    }
    this.entries.length = this.index + 1;
    this.entries.push(next);
    this.index++;
    this.lastKey = key;
    const excess = this.entries.length - 1 - this.limit;
    if (excess > 0) {
      this.entries.splice(0, excess);
      this.index -= excess;
    }
  }

  /** Ends the current coalescing chain, so the next push always starts a new undo step. */
  endCoalesce(): void {
    this.lastKey = undefined;
  }

  undo(): T | undefined {
    if (!this.canUndo) return undefined;
    this.lastKey = undefined;
    this.index--;
    return this.present;
  }

  redo(): T | undefined {
    if (!this.canRedo) return undefined;
    this.lastKey = undefined;
    this.index++;
    return this.present;
  }

  /** Replaces the whole history with a single state (for example when opening another profile). */
  reset(state: T): void {
    this.entries = [state];
    this.index = 0;
    this.lastKey = undefined;
  }
}

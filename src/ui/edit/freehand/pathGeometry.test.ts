import { describe, expect, it } from 'vitest';
import { dragVertex, handleIndices, handleStep, translatePoints } from './pathGeometry';

const square: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

describe('translatePoints', () => {
  it('moves all points and leaves the input alone', () => {
    const out = translatePoints(square, 0.5, -1);
    expect(out[0]).toEqual([0.5, -1]);
    expect(out[2]).toEqual([1.5, 0]);
    expect(square[0]).toEqual([0, 0]);
  });
});

describe('handleIndices', () => {
  it('shows every vertex of a small outline', () => {
    expect(handleIndices(5)).toEqual([0, 1, 2, 3, 4]);
    expect(handleStep(40)).toBe(1);
  });
  it('samples large outlines down to at most 40 handles', () => {
    for (const n of [41, 80, 100, 333, 1000]) {
      const idx = handleIndices(n);
      expect(idx.length).toBeLessThanOrEqual(40);
      expect(idx.length).toBeGreaterThan(20);
      expect(idx[0]).toBe(0);
      expect(idx.every((v) => v < n)).toBe(true);
    }
  });
});

describe('dragVertex', () => {
  it('moves only the chosen vertex when every vertex has a handle', () => {
    const out = dragVertex(square, 1, 0.1, 0.2);
    expect(out[1]).toEqual([1.1, 0.2]);
    expect(out[0]).toEqual([0, 0]);
    expect(out[2]).toEqual([1, 1]);
  });
  it('drags neighbours with a fall-off when handles are sampled', () => {
    const line: [number, number][] = Array.from({ length: 20 }, (_, i) => [i, 0]);
    const out = dragVertex(line, 10, 0, 1, 4);
    expect(out[10]?.[1]).toBeCloseTo(1);
    expect(out[11]?.[1]).toBeGreaterThan(0.5);
    expect(out[11]?.[1]).toBeLessThan(1);
    expect(out[13]?.[1]).toBeGreaterThan(0);
    expect(out[14]?.[1]).toBe(0); // the next handle is untouched
    expect(out[6]?.[1]).toBe(0);
  });
  it('wraps around the closing edge', () => {
    const line: [number, number][] = Array.from({ length: 12 }, (_, i) => [i, 0]);
    const out = dragVertex(line, 0, 0, 1, 3);
    expect(out[11]?.[1]).toBeGreaterThan(0);
    expect(out[1]?.[1]).toBeGreaterThan(0);
  });
  it('ignores a bad index', () => {
    expect(dragVertex(square, 9, 1, 1)).toEqual(square);
  });
});

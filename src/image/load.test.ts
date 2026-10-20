import { describe, expect, it } from 'vitest';
import { fitWithin } from './load';

describe('fitWithin', () => {
  it('does not upscale small images', () => {
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 });
  });
  it('returns the same size when the long side equals the max', () => {
    expect(fitWithin(2048, 1000, 2048)).toEqual({ width: 2048, height: 1000 });
  });
  it('scales a landscape image down by its long side', () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
  });
  it('scales a portrait image down by its long side', () => {
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
  });
  it('keeps at least 1 pixel on the short side', () => {
    expect(fitWithin(10000, 1, 100)).toEqual({ width: 100, height: 1 });
  });
  it('handles squares', () => {
    expect(fitWithin(3000, 3000, 1024)).toEqual({ width: 1024, height: 1024 });
  });
  it('returns whole pixels', () => {
    const r = fitWithin(3001, 2001, 1000);
    expect(Number.isInteger(r.width)).toBe(true);
    expect(Number.isInteger(r.height)).toBe(true);
    expect(r.width).toBe(1000);
  });
});

import { describe, expect, it } from 'vitest';
import { PREVIEW_CAP_SIDE, PREVIEW_DEFAULT_SIDE, PREVIEW_MIN_SIDE, choosePreviewLongSide } from './previewSize';

const base = { current: null, imageLong: 2048, gpuMax: 16384 };

describe('choosePreviewLongSide', () => {
  it('uses the default before any view reports a size', () => {
    expect(choosePreviewLongSide({ ...base, wanted: null })).toBe(PREVIEW_DEFAULT_SIDE);
    expect(choosePreviewLongSide({ ...base, wanted: null, imageLong: 800 })).toBe(800);
  });

  it('rounds the displayed size up to a step, never below the minimum', () => {
    expect(choosePreviewLongSide({ ...base, wanted: 1082 })).toBe(1280);
    expect(choosePreviewLongSide({ ...base, wanted: 1024 })).toBe(1024);
    expect(choosePreviewLongSide({ ...base, wanted: 100 })).toBe(PREVIEW_MIN_SIDE);
  });

  it('never exceeds the working image, the GPU limit or the cap', () => {
    expect(choosePreviewLongSide({ ...base, wanted: 5000 })).toBe(2048);
    expect(choosePreviewLongSide({ ...base, wanted: 5000, imageLong: 1500 })).toBe(1500);
    expect(choosePreviewLongSide({ ...base, wanted: 5000, gpuMax: 1024 })).toBe(1024);
    expect(choosePreviewLongSide({ ...base, wanted: 5000, imageLong: 4000 })).toBe(PREVIEW_CAP_SIDE);
    expect(choosePreviewLongSide({ ...base, wanted: 5000, cap: 1536 })).toBe(1536);
  });

  it('snaps to the full working image when the wanted size is close to it', () => {
    expect(choosePreviewLongSide({ ...base, wanted: 1700 })).toBe(2048); // 1792 >= 0.8 * 2048
    expect(choosePreviewLongSide({ ...base, wanted: 1500 })).toBe(1536);
  });

  it('grows immediately but shrinks only past the hysteresis band', () => {
    expect(choosePreviewLongSide({ ...base, wanted: 1500, current: 1024 })).toBe(1536);
    expect(choosePreviewLongSide({ ...base, wanted: 1300, current: 1536 })).toBe(1536); // 1536 -> 1536
    expect(choosePreviewLongSide({ ...base, wanted: 1100, current: 1536 })).toBe(1536); // 1280 >= 0.7 * 1536
    expect(choosePreviewLongSide({ ...base, wanted: 900, current: 2048 })).toBe(1024); // 1024 < 0.7 * 2048
  });

  it('ignores a current size that no longer fits (new image)', () => {
    expect(choosePreviewLongSide({ ...base, wanted: 600, current: 2048, imageLong: 1000 })).toBe(768);
  });

  it('handles odd input', () => {
    expect(choosePreviewLongSide({ ...base, wanted: Number.NaN })).toBe(PREVIEW_DEFAULT_SIDE);
    expect(choosePreviewLongSide({ ...base, wanted: 800, gpuMax: 0 })).toBe(1024);
    expect(choosePreviewLongSide({ ...base, wanted: 800, imageLong: 0 })).toBe(1);
  });
});

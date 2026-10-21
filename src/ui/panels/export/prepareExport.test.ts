// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const composeSpy = vi.hoisted(() => vi.fn());
const renderSpy = vi.hoisted(() => vi.fn());
const originalSpy = vi.hoisted(() => vi.fn());

vi.mock('../../../export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../export')>();
  return {
    ...actual,
    composeExport: composeSpy,
    canvasToBlob: vi.fn(async (_c: unknown, type: string) => new Blob(['x'], { type })),
  };
});
vi.mock('../../../state/render', () => ({
  renderFullSizeCanvas: renderSpy,
  getOriginalCanvas: originalSpy,
}));

import { DEFAULT_EXPORT_OPTIONS, captionFieldsFromProfile, type ExportOptions } from './options';
import { newProfile } from '../../../model/defaults';
import { prepareExport } from './run';

const fields = captionFieldsFromProfile(newProfile(), new Date(2026, 0, 5));
const opts = (o: Partial<ExportOptions>): ExportOptions => ({ ...DEFAULT_EXPORT_OPTIONS, ...o });
const canvas = (): HTMLCanvasElement => Object.assign(document.createElement('canvas'), { width: 4, height: 4 });

beforeEach(() => {
  composeSpy.mockReset().mockImplementation(canvas);
  renderSpy
    .mockReset()
    .mockImplementation(async () => ({
      canvas: canvas(),
      width: 4,
      height: 4,
      downscaled: false,
      originalWidth: 4,
      originalHeight: 4,
      tiles: 0,
    }));
  originalSpy.mockReset().mockImplementation(async () => canvas());
});

describe('prepareExport export size (Q5)', () => {
  it('asks for a full-resolution render and original only with Full resolution', async () => {
    await prepareExport(opts({ simulated: true, original: true, sideBySide: false }), fields);
    expect(renderSpy).toHaveBeenLastCalledWith({ fullResolution: false });
    expect(originalSpy).toHaveBeenLastCalledWith(undefined, { fullResolution: false });
    await prepareExport(opts({ simulated: true, original: true, sideBySide: false, size: 'full' }), fields);
    expect(renderSpy).toHaveBeenLastCalledWith({ fullResolution: true });
    expect(originalSpy).toHaveBeenLastCalledWith(undefined, { fullResolution: true });
  });

  it('passes on the size facts and a fallback reason', async () => {
    renderSpy.mockImplementation(async () => ({
      canvas: canvas(),
      width: 4,
      height: 3,
      downscaled: true,
      originalWidth: 8,
      originalHeight: 6,
      tiles: 0,
      fallback: 'This device could not hold an image that large.',
    }));
    const out = await prepareExport(opts({ size: 'full', sideBySide: false }), fields);
    expect(out).toMatchObject({ width: 4, height: 3, downscaled: true, originalWidth: 8, originalHeight: 6 });
    expect(out.fallback).toContain('could not hold');
  });
});

describe('prepareExport approximation note', () => {
  it('composes a simulated-only export with the caption off, so it still gets the approximation strip', async () => {
    const out = await prepareExport(opts({ simulated: true, sideBySide: false, caption: false }), fields);
    expect(out.files).toHaveLength(1);
    expect(composeSpy).toHaveBeenCalledTimes(1);
    const arg = composeSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.caption).toBeUndefined();
    expect(arg.original).toBeUndefined();
    expect(arg.approximationNote).not.toBe(false); // default (true): the strip is added
  });

  it('passes the caption lines when the caption is on', async () => {
    await prepareExport(opts({ simulated: true, sideBySide: false, caption: true }), fields);
    const arg = composeSpy.mock.calls[0]![0] as { caption?: string[] };
    expect(arg.caption?.length).toBeGreaterThan(0);
  });

  it('keeps the original export clean: it is never composed', async () => {
    const out = await prepareExport(opts({ simulated: false, original: true, sideBySide: false }), fields);
    expect(out.files).toHaveLength(1);
    expect(composeSpy).not.toHaveBeenCalled();
    expect(renderSpy).not.toHaveBeenCalled(); // nothing simulated is needed
  });

  it('composes the side-by-side image without a caption too (the strip comes from composeExport)', async () => {
    await prepareExport(opts({ simulated: false, sideBySide: true, caption: false }), fields);
    expect(composeSpy).toHaveBeenCalledTimes(1);
    const arg = composeSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.caption).toBeUndefined();
    expect(arg.approximationNote).not.toBe(false);
  });
});

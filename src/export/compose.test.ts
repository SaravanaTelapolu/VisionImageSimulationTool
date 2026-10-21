// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPROXIMATION_LINE } from './caption';
import { canvasToBlob, composeExport, type SizedImageSource } from './compose';
import { layoutExport } from './layout';

interface Call {
  fn: string;
  args: unknown[];
}

describe('composeExport', () => {
  let calls: Call[];

  beforeEach(() => {
    calls = [];
    const rec = (fn: string) => (...args: unknown[]) => {
      calls.push({ fn, args });
    };
    const ctx = {
      font: '',
      fillStyle: '',
      fillRect: rec('fillRect'),
      drawImage: rec('drawImage'),
      fillText: rec('fillText'),
      measureText: (s: string) => ({ width: s.length * 10 }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never);
  });

  afterEach(() => vi.restoreAllMocks());

  const img = (w: number, h: number): SizedImageSource => ({ width: w, height: h }) as unknown as SizedImageSource;

  it('draws original and simulated panels sized by the layout', () => {
    const canvas = composeExport({
      simulated: img(600, 800),
      original: img(600, 800),
      orientation: 'auto',
      labels: true,
      approximationNote: false,
    });
    const expected = layoutExport({
      simulated: { w: 600, h: 800 },
      original: { w: 600, h: 800 },
      orientation: 'auto',
      captionLines: 0,
      labels: true,
    });
    expect(canvas.width).toBe(expected.width);
    expect(canvas.height).toBe(expected.height);
    const draws = calls.filter((c) => c.fn === 'drawImage');
    expect(draws).toHaveLength(2);
    expect(draws[1]!.args.slice(1)).toEqual([expected.panels[1]!.x, expected.panels[1]!.y, 600, 800]);
    expect(calls.filter((c) => c.fn === 'fillText').map((c) => c.args[0])).toEqual(['Original', 'Simulated']);
  });

  it('wraps caption lines to the width and grows the canvas for the caption bar', () => {
    const long = 'word '.repeat(40).trim();
    const lines = ['short line', long];
    const withCaption = composeExport({ simulated: img(600, 800), orientation: 'auto', caption: lines });
    const without = composeExport({ simulated: img(600, 800), orientation: 'auto', approximationNote: false });
    expect(withCaption.width).toBe(without.width);
    expect(withCaption.height).toBeGreaterThan(without.height);
    const texts = calls.filter((c) => c.fn === 'fillText').map((c) => c.args[0] as string);
    expect(texts.length).toBeGreaterThan(2);
    expect(texts[0]).toBe('short line');
    expect(texts.every((t) => t.length * 10 <= 600)).toBe(true);
  });

  it('adds a small approximation strip when the caption is off', () => {
    const clean = composeExport({ simulated: img(600, 800), orientation: 'auto', approximationNote: false });
    const cleanCalls = calls.length;
    const withNote = composeExport({ simulated: img(600, 800), orientation: 'auto' });
    expect(withNote.height).toBeGreaterThan(clean.height);
    const texts = calls.slice(cleanCalls).filter((c) => c.fn === 'fillText').map((c) => c.args[0]);
    expect(texts.join(' ')).toContain('approximation');
  });

  it('adds the strip to side-by-side exports without a caption', () => {
    composeExport({ simulated: img(600, 800), original: img(600, 800), orientation: 'auto' });
    const texts = calls.filter((c) => c.fn === 'fillText').map((c) => c.args[0] as string);
    expect(texts.join(' ')).toContain('approximation');
  });

  it('does not duplicate the note when a caption (which already carries it) is given', () => {
    composeExport({ simulated: img(600, 800), orientation: 'auto', caption: ['hello', APPROXIMATION_LINE] });
    const texts = calls.filter((c) => c.fn === 'fillText').map((c) => c.args[0] as string);
    expect(texts.join(' ').split('approximation').length - 1).toBe(1);
  });

  it('uses naturalWidth/naturalHeight when present', () => {
    const el = { width: 10, height: 10, naturalWidth: 400, naturalHeight: 300 } as unknown as SizedImageSource;
    const canvas = composeExport({ simulated: el, orientation: 'auto', approximationNote: false });
    expect([canvas.width, canvas.height]).toEqual([400, 300]);
  });
});

describe('canvasToBlob', () => {
  it('resolves with the encoded blob and passes type and quality', async () => {
    const canvas = document.createElement('canvas');
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const toBlob = vi.fn((cb: BlobCallback) => cb(blob));
    canvas.toBlob = toBlob as never;
    await expect(canvasToBlob(canvas, 'image/jpeg', 0.8)).resolves.toBe(blob);
    expect(toBlob.mock.calls[0]!.slice(1)).toEqual(['image/jpeg', 0.8]);
    await canvasToBlob(canvas);
    expect(toBlob.mock.calls[1]!.slice(1)).toEqual(['image/png', 0.92]);
  });

  it('rejects when encoding fails', async () => {
    const canvas = document.createElement('canvas');
    canvas.toBlob = ((cb: BlobCallback) => cb(null)) as never;
    await expect(canvasToBlob(canvas)).rejects.toThrow();
  });
});

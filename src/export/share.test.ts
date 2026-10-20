// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportFileName, shareOrDownload } from './share';

describe('exportFileName', () => {
  const date = new Date(2026, 9, 20);

  it('slugs the profile name', () => {
    expect(exportFileName({ profileName: 'Right eye', date, kind: 'simulated', ext: 'png' })).toBe(
      'vision-sim_2026-10-20_right-eye_simulated.png',
    );
    expect(exportFileName({ profileName: "  Dr. Rao's Café #2!! ", date, kind: 'side-by-side', ext: 'jpg' })).toBe(
      'vision-sim_2026-10-20_dr-rao-s-cafe-2_side-by-side.jpg',
    );
  });

  it('omits the profile part when empty or unsluggable', () => {
    expect(exportFileName({ date, kind: 'original', ext: 'png' })).toBe('vision-sim_2026-10-20_original.png');
    expect(exportFileName({ profileName: '???', date, kind: 'original', ext: 'png' })).toBe(
      'vision-sim_2026-10-20_original.png',
    );
  });

  it('pads month and day and limits long names', () => {
    const n = exportFileName({ profileName: 'x'.repeat(100), date: new Date(2027, 0, 3), kind: 'simulated', ext: 'png' });
    expect(n.startsWith('vision-sim_2027-01-03_')).toBe(true);
    expect(n.length).toBeLessThan(80);
  });
});

describe('shareOrDownload', () => {
  const files = [
    { blob: new Blob(['a'], { type: 'image/png' }), name: 'a.png' },
    { blob: new Blob(['b'], { type: 'image/png' }), name: 'b.png' },
  ];
  const nav = navigator as unknown as Record<string, unknown>;
  let createUrl: ReturnType<typeof vi.fn>;
  let revokeUrl: ReturnType<typeof vi.fn>;
  let clicked: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    createUrl = vi.fn((b: Blob) => `blob:${(b as Blob).size}-${Math.random()}`);
    revokeUrl = vi.fn();
    (URL as unknown as Record<string, unknown>).createObjectURL = createUrl;
    (URL as unknown as Record<string, unknown>).revokeObjectURL = revokeUrl;
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
  });

  afterEach(() => {
    delete nav.share;
    delete nav.canShare;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shares files through the share sheet when supported', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    nav.share = share;
    nav.canShare = vi.fn().mockReturnValue(true);
    expect(await shareOrDownload(files, 'Vision')).toBe('shared');
    expect(share).toHaveBeenCalledTimes(1);
    const arg = share.mock.calls[0]![0] as { files: File[]; title: string };
    expect(arg.title).toBe('Vision');
    expect(arg.files.map((f) => f.name)).toEqual(['a.png', 'b.png']);
    expect(arg.files[0]!.type).toBe('image/png');
    expect(clicked).toEqual([]);
  });

  it("returns 'cancelled' when the share sheet is dismissed", async () => {
    nav.share = vi.fn().mockRejectedValue(new DOMException('dismissed', 'AbortError'));
    nav.canShare = vi.fn().mockReturnValue(true);
    expect(await shareOrDownload(files, 'Vision')).toBe('cancelled');
    expect(clicked).toEqual([]);
  });

  it('downloads when canShare says no', async () => {
    const share = vi.fn();
    nav.share = share;
    nav.canShare = vi.fn().mockReturnValue(false);
    expect(await shareOrDownload(files, 'Vision')).toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
    expect(clicked).toEqual(['a.png', 'b.png']);
  });

  it('downloads when the Web Share API is missing, and revokes the object URLs', async () => {
    expect(await shareOrDownload(files, 'Vision')).toBe('downloaded');
    expect(clicked).toEqual(['a.png', 'b.png']);
    expect(createUrl).toHaveBeenCalledTimes(2);
    expect(revokeUrl).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(revokeUrl).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('falls back to download when sharing fails for another reason', async () => {
    nav.share = vi.fn().mockRejectedValue(new DOMException('no gesture', 'NotAllowedError'));
    nav.canShare = vi.fn().mockReturnValue(true);
    expect(await shareOrDownload(files, 'Vision')).toBe('downloaded');
    expect(clicked).toEqual(['a.png', 'b.png']);
  });
});

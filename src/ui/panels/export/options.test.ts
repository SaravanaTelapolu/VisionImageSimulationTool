import { describe, expect, it } from 'vitest';
import { APPROXIMATION_LINE } from '../../../export';
import { newProfile } from '../../../model/defaults';
import {
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_OPTIONS_KEY,
  captionFieldsFromProfile,
  captionLinesFromFields,
  disabledReason,
  loadExportOptions,
  parseDateInput,
  planExportFiles,
  reducedNotice,
  resultMessage,
  sanitizeExportOptions,
  saveExportOptions,
  toDateInputValue,
  type ExportOptions,
} from './options';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

const today = new Date(2026, 9, 21, 9, 30);
const profile = {
  ...newProfile('p1', today),
  name: 'Check-up',
  eye: 'right' as const,
  viewingDistanceCm: 40,
  note: 'Night view',
};

describe('defaults', () => {
  it('start with Simulated + Side by side, PNG, JPEG 0.9, auto, labels and caption on', () => {
    expect(DEFAULT_EXPORT_OPTIONS).toMatchObject({
      simulated: true,
      original: false,
      sideBySide: true,
      format: 'png',
      jpegQuality: 0.9,
      orientation: 'auto',
      labels: true,
      caption: true,
      size: 'limited',
    });
  });
});

describe('export size (Q5)', () => {
  it('persists Full resolution and falls back to the default for bad values', () => {
    const s = fakeStorage();
    saveExportOptions({ ...DEFAULT_EXPORT_OPTIONS, size: 'full' }, s);
    expect(loadExportOptions(s).size).toBe('full');
    expect(sanitizeExportOptions({ size: 'huge' }).size).toBe('limited');
    expect(sanitizeExportOptions({}).size).toBe('limited');
  });

  it('explains a reduced export, with the reason', () => {
    const facts = { width: 4096, height: 2731, downscaled: true, originalWidth: 6000, originalHeight: 4000 };
    expect(reducedNotice(facts, 'limited')).toBe(
      'Exported at 4096 × 2731 px — reduced from 6000 × 4000 px. Choose Export size: Full resolution to keep every pixel.',
    );
    expect(reducedNotice({ ...facts, fallback: 'This device could not hold an image that large.' }, 'full')).toBe(
      'Exported at 4096 × 2731 px — reduced from 6000 × 4000 px. This device could not hold an image that large.',
    );
    expect(reducedNotice({ ...facts, downscaled: false, width: 6000, height: 4000 }, 'full')).toBe('');
  });
});

describe('option persistence', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadExportOptions(fakeStorage())).toEqual(DEFAULT_EXPORT_OPTIONS);
  });

  it('round-trips saved options', () => {
    const s = fakeStorage();
    const o: ExportOptions = {
      ...DEFAULT_EXPORT_OPTIONS,
      original: true,
      format: 'jpeg',
      jpegQuality: 0.75,
      orientation: 'vertical',
      caption: false,
    };
    expect(saveExportOptions(o, s)).toBe(true);
    expect(loadExportOptions(s)).toEqual(o);
  });

  it('survives corrupt data and partial or invalid fields', () => {
    expect(loadExportOptions(fakeStorage({ [EXPORT_OPTIONS_KEY]: '{not json' }))).toEqual(DEFAULT_EXPORT_OPTIONS);
    const o = sanitizeExportOptions({
      format: 'gif',
      jpegQuality: 7,
      orientation: 'diagonal',
      original: true,
      labels: 'yes',
    });
    expect(o).toEqual({ ...DEFAULT_EXPORT_OPTIONS, original: true, jpegQuality: 1 });
    expect(sanitizeExportOptions({ jpegQuality: 0.1 }).jpegQuality).toBe(0.5);
    expect(sanitizeExportOptions(null)).toEqual(DEFAULT_EXPORT_OPTIONS);
  });

  it('tolerates blocked or throwing storage', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadExportOptions(throwing)).toEqual(DEFAULT_EXPORT_OPTIONS);
    expect(saveExportOptions(DEFAULT_EXPORT_OPTIONS, throwing)).toBe(false);
    expect(saveExportOptions(DEFAULT_EXPORT_OPTIONS, null)).toBe(false);
  });
});

describe('caption fields', () => {
  it('are prefilled from the profile, with today as the date', () => {
    expect(captionFieldsFromProfile(profile, today)).toEqual({
      date: '2026-10-21',
      eye: 'right',
      viewingDistanceCm: 40,
      note: 'Night view',
      profileName: 'Check-up',
    });
  });

  it('parse and format dates as local dates', () => {
    expect(toDateInputValue(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(parseDateInput('2026-02-30')).toBeNull();
    expect(parseDateInput('')).toBeNull();
    expect(parseDateInput('2026-10-21')?.getDate()).toBe(21);
  });

  it('always end with the approximation line, and an empty date means today', () => {
    const f = { ...captionFieldsFromProfile(profile, today), date: '' };
    const lines = captionLinesFromFields(f, today);
    expect(lines[0]).toBe('21 Oct 2026 · Right eye · viewed at 40 cm');
    expect(lines).toContain('Profile: Check-up');
    expect(lines).toContain('Night view');
    expect(lines[lines.length - 1]).toBe(APPROXIMATION_LINE);
    const blank = captionLinesFromFields({ ...f, note: '', profileName: '' }, today);
    expect(blank).toHaveLength(2);
    expect(blank[1]).toBe(APPROXIMATION_LINE);
  });
});

describe('planExportFiles', () => {
  const fields = captionFieldsFromProfile(profile, today);

  it('default options give simulated + side-by-side PNGs named with profile and date', () => {
    expect(planExportFiles(DEFAULT_EXPORT_OPTIONS, fields, today)).toEqual([
      { kind: 'simulated', name: 'vision-sim_2026-10-21_check-up_simulated.png' },
      { kind: 'side-by-side', name: 'vision-sim_2026-10-21_check-up_side-by-side.png' },
    ]);
  });

  it('orders simulated, original, side-by-side and uses jpg for JPEG', () => {
    const o: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, original: true, format: 'jpeg' };
    const plan = planExportFiles(o, { ...fields, profileName: '', date: '2026-03-04' }, today);
    expect(plan.map((p) => p.kind)).toEqual(['simulated', 'original', 'side-by-side']);
    expect(plan.map((p) => p.name)).toEqual([
      'vision-sim_2026-03-04_simulated.jpg',
      'vision-sim_2026-03-04_original.jpg',
      'vision-sim_2026-03-04_side-by-side.jpg',
    ]);
  });

  it('gives an empty list when nothing is chosen', () => {
    const none: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, simulated: false, sideBySide: false };
    expect(planExportFiles(none, fields, today)).toEqual([]);
  });
});

describe('messages', () => {
  it('result text', () => {
    expect(resultMessage('shared', 2)).toBe('Shared');
    expect(resultMessage('cancelled', 2)).toBe('Cancelled');
    expect(resultMessage('downloaded', 2)).toBe('Downloaded 2 files');
    expect(resultMessage('downloaded', 1)).toBe('Downloaded 1 file');
  });

  it('disabled reasons', () => {
    expect(disabledReason(false, DEFAULT_EXPORT_OPTIONS)).toMatch(/Load a photo/);
    expect(
      disabledReason(true, { ...DEFAULT_EXPORT_OPTIONS, simulated: false, sideBySide: false }),
    ).toMatch(/at least one/);
    expect(disabledReason(true, DEFAULT_EXPORT_OPTIONS)).toBe('');
  });
});

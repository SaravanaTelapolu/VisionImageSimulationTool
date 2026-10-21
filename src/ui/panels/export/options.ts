// Pure helpers for the Export panel: the options (and how they are remembered), the caption fields
// prefilled from the profile, and the list of files an export will produce. No DOM, no canvas.
import { buildCaptionLines, exportFileName } from '../../../export';
import type { CaptionInfo, ExportKind } from '../../../export';
import type { Eye, Profile } from '../../../model/types';

export type ExportFormat = 'png' | 'jpeg';
export type ExportOrientation = 'auto' | 'horizontal' | 'vertical';
/** "limited": up to 4096 px on the long side (or the GPU limit). "full": keep the photo's size (tiled render). */
export type ExportSize = 'limited' | 'full';

export interface ExportOptions {
  /** Which files to produce. */
  simulated: boolean;
  original: boolean;
  sideBySide: boolean;
  format: ExportFormat;
  /** JPEG quality, 0.5 .. 1. */
  jpegQuality: number;
  orientation: ExportOrientation;
  /** "Original" / "Simulated" labels on the side-by-side image. */
  labels: boolean;
  /** Burn the caption into the simulated and side-by-side images. */
  caption: boolean;
  /** Export size (Q5): up to 4096 px (default) or full resolution. */
  size: ExportSize;
}

export const DEFAULT_EXPORT_OPTIONS: Readonly<ExportOptions> = {
  simulated: true,
  original: false,
  sideBySide: true,
  format: 'png',
  jpegQuality: 0.9,
  orientation: 'auto',
  labels: true,
  caption: true,
  size: 'limited',
};

export const JPEG_QUALITY_MIN = 0.5;
export const JPEG_QUALITY_MAX = 1;
export const EXPORT_OPTIONS_KEY = 'vision-simulator.exportOptions';

const clampQuality = (q: number): number =>
  Math.min(JPEG_QUALITY_MAX, Math.max(JPEG_QUALITY_MIN, Math.round(q * 100) / 100));

/** Turns anything (for example parsed JSON) into valid options; unknown or bad fields fall back to defaults. */
export function sanitizeExportOptions(raw: unknown): ExportOptions {
  const d = DEFAULT_EXPORT_OPTIONS;
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const bool = (k: keyof ExportOptions, fallback: boolean): boolean =>
    typeof o[k] === 'boolean' ? (o[k] as boolean) : fallback;
  const q = o.jpegQuality;
  return {
    simulated: bool('simulated', d.simulated),
    original: bool('original', d.original),
    sideBySide: bool('sideBySide', d.sideBySide),
    format: o.format === 'png' || o.format === 'jpeg' ? o.format : d.format,
    jpegQuality: typeof q === 'number' && Number.isFinite(q) ? clampQuality(q) : d.jpegQuality,
    orientation:
      o.orientation === 'auto' || o.orientation === 'horizontal' || o.orientation === 'vertical'
        ? o.orientation
        : d.orientation,
    labels: bool('labels', d.labels),
    caption: bool('caption', d.caption),
    size: o.size === 'limited' || o.size === 'full' ? o.size : d.size,
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // accessing localStorage can throw when site data is blocked
  }
}

/** Reads the remembered options; defaults when nothing is stored, storage is blocked or the data is bad. */
export function loadExportOptions(storage: StorageLike | null = defaultStorage()): ExportOptions {
  try {
    const raw = storage?.getItem(EXPORT_OPTIONS_KEY);
    if (raw) return sanitizeExportOptions(JSON.parse(raw));
  } catch {
    // unreadable: use defaults
  }
  return { ...DEFAULT_EXPORT_OPTIONS };
}

/** Remembers the options. Returns false when storage is unavailable (the panel still works). */
export function saveExportOptions(opts: ExportOptions, storage: StorageLike | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(EXPORT_OPTIONS_KEY, JSON.stringify(sanitizeExportOptions(opts)));
    return true;
  } catch {
    return false;
  }
}

// --- Caption fields -----------------------------------------------------------------------

/** The editable caption values. `date` is a "YYYY-MM-DD" string, as an <input type="date"> uses. */
export interface CaptionFields {
  date: string;
  eye: Eye;
  viewingDistanceCm: number;
  note: string;
  profileName: string;
}

const two = (n: number): string => String(n).padStart(2, '0');

/** Local "YYYY-MM-DD". */
export function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** Parses "YYYY-MM-DD" as a local date (noon, so DST shifts cannot change the day); null when invalid. */
export function parseDateInput(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(y, mo - 1, da, 12);
  return d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === da ? d : null;
}

/** Caption fields prefilled from the profile; the date is today. */
export function captionFieldsFromProfile(p: Profile, today: Date = new Date()): CaptionFields {
  return {
    date: toDateInputValue(today),
    eye: p.eye,
    viewingDistanceCm: p.viewingDistanceCm,
    note: p.note,
    profileName: p.name,
  };
}

/** Caption info for buildCaptionLines; an empty or invalid date means today. */
export function captionInfoFromFields(f: CaptionFields, today: Date = new Date()): CaptionInfo {
  return {
    date: parseDateInput(f.date) ?? today,
    eye: f.eye,
    viewingDistanceCm: f.viewingDistanceCm,
    note: f.note,
    profileName: f.profileName,
  };
}

/** Caption lines for the fields (the approximation line is always last and cannot be removed). */
export function captionLinesFromFields(f: CaptionFields, today: Date = new Date()): string[] {
  return buildCaptionLines(captionInfoFromFields(f, today));
}

// --- File list ----------------------------------------------------------------------------

export interface PlannedFile {
  kind: ExportKind;
  name: string;
}

/** True when the options select at least one file. */
export const hasAnyFile = (o: ExportOptions): boolean => o.simulated || o.original || o.sideBySide;

/** The files an export will make, in order: simulated, original, side by side. */
export function planExportFiles(o: ExportOptions, f: CaptionFields, today: Date = new Date()): PlannedFile[] {
  const date = parseDateInput(f.date) ?? today;
  const ext = o.format === 'jpeg' ? 'jpg' : 'png';
  const kinds: ExportKind[] = [];
  if (o.simulated) kinds.push('simulated');
  if (o.original) kinds.push('original');
  if (o.sideBySide) kinds.push('side-by-side');
  return kinds.map((kind) => ({ kind, name: exportFileName({ profileName: f.profileName, date, kind, ext }) }));
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/** "Shared", "Downloaded 2 files" or "Cancelled". */
export function resultMessage(outcome: ShareOutcome, fileCount: number): string {
  if (outcome === 'shared') return 'Shared';
  if (outcome === 'cancelled') return 'Cancelled';
  return `Downloaded ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
}

/** Size facts of a prepared export, for the "reduced" notice. */
export interface ExportSizeFacts {
  width: number;
  height: number;
  downscaled: boolean;
  originalWidth: number;
  originalHeight: number;
  /** Why "Full resolution" could not be honoured, when it could not. */
  fallback?: string;
}

/**
 * The notice shown when the simulated image is smaller than the photo, or '' when it is not:
 * "Exported at W × H px — reduced from W0 × H0 px." plus why.
 */
export function reducedNotice(f: ExportSizeFacts, size: ExportSize): string {
  if (!f.downscaled) return '';
  const from =
    f.originalWidth > f.width || f.originalHeight > f.height ? ` — reduced from ${f.originalWidth} × ${f.originalHeight} px` : '';
  const head = `Exported at ${f.width} × ${f.height} px${from}.`;
  if (size === 'full') return `${head} ${f.fallback ?? "This device's graphics chip could not render the full photo size."}`;
  if (Math.max(f.originalWidth, f.originalHeight) > 4096) return `${head} Choose Export size: Full resolution to keep every pixel.`;
  return `${head} This device's graphics chip could not render the full photo size.`;
}

/** Why the Prepare images button is disabled, or '' when it is enabled. */
export function disabledReason(hasImage: boolean, o: ExportOptions): string {
  if (!hasImage) return 'Load a photo or a test image first.';
  if (!hasAnyFile(o)) return 'Choose at least one thing to save.';
  return '';
}

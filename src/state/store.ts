// Central app state (signals). UI modules read these signals and change the profile only through
// applyEdit()/undo()/redo(), so undo history stays consistent.
import { computed, signal } from '@preact/signals';
import { newProfile } from '../model/defaults';
import { UNDO_LIMIT, type ImageFrame, type Profile, type Vec2 } from '../model/types';
import { History } from '../model/history';
import { loadWorkingImage } from '../image/load';
import { rasterizeTestImage, testImages } from '../assets/testImages';

export interface PhotoState {
  /** The untouched file, kept for full-size export; null for built-in test images. */
  original: File | null;
  /** Working-size pixels (long side <= 2048 for photos). */
  working: CanvasImageSource;
  width: number;
  height: number;
  name: string;
}

export type ViewMode = 'simulated' | 'original';
export type TabId = 'regions' | 'effects' | 'compare' | 'export' | 'profiles';

export const TAB_IDS: readonly TabId[] = ['regions', 'effects', 'compare', 'export', 'profiles'];

export const UI_TEXT_SCALE_MIN = 0.85;
export const UI_TEXT_SCALE_MAX = 1.5;
const UI_TEXT_SCALE_KEY = 'vision-simulator.uiTextScale';

// --- Core signals -------------------------------------------------------------------------

export const image = signal<PhotoState | null>(null);
/** Fixation point in image (working-size) pixels. */
export const fixation = signal<Vec2>({ x: 0, y: 0 });
export const profile = signal<Profile>(newProfile());
export const selectedRegionId = signal<string | null>(null);
export const viewMode = signal<ViewMode>('simulated');
export const activeTab = signal<TabId>('regions');
/**
 * Canvas supplied by the WebGL renderer. While set (and viewMode is 'simulated') the viewport
 * shows it instead of the plain 2D drawing of the working image. It must have the working
 * image's aspect ratio; the viewport stretches it to the image's width x height.
 */
export const previewCanvas = signal<HTMLCanvasElement | null>(null);
export const photoLoading = signal(false);
export const photoError = signal('');

/** Image size plus fixation, ready for model/coords helpers; null when no image is loaded. */
export const imageFrame = computed<ImageFrame | null>(() => {
  const img = image.value;
  return img ? { width: img.width, height: img.height, fixation: fixation.value } : null;
});

// --- UI text scale (persisted) ------------------------------------------------------------

function clampScale(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(UI_TEXT_SCALE_MAX, Math.max(UI_TEXT_SCALE_MIN, Math.round(v * 100) / 100));
}

function readStoredScale(): number {
  try {
    const raw = localStorage.getItem(UI_TEXT_SCALE_KEY);
    if (raw !== null) return clampScale(parseFloat(raw));
  } catch {
    // storage blocked or unavailable: use the default
  }
  return 1;
}

export const uiTextScale = signal(readStoredScale());

export function setUiTextScale(value: number): void {
  const v = clampScale(value);
  uiTextScale.value = v;
  try {
    localStorage.setItem(UI_TEXT_SCALE_KEY, String(v));
  } catch {
    // ignore: the setting just will not persist
  }
}

// --- Simple actions -----------------------------------------------------------------------

export function flipView(): void {
  viewMode.value = viewMode.value === 'simulated' ? 'original' : 'simulated';
}

// --- Activity and image loading ----------------------------------------------------------

/**
 * Bumped on every user-driven change (edit, profile reset, image load request). Startup restore
 * compares it before and after its slow storage reads and gives up when it moved, so it never
 * overwrites what the user did in the meantime.
 */
let activity = 0;

export function activityCount(): number {
  return activity;
}

/** Marks that the user has done something (see activityCount). */
export function noteActivity(): void {
  activity++;
}

/** Latest-wins token: each load request takes the next number; only the newest may apply its result. */
let loadSeq = 0;
/** Loads still running (stale ones included), so photoLoading stays true until the last one ends. */
let loadsInFlight = 0;

/** How long a replaced ImageBitmap stays open, so views and exports still drawing from it finish first. */
export const BITMAP_CLOSE_DELAY_MS = 5000;

function isClosable(x: unknown): x is { close(): void } {
  return typeof x === 'object' && x !== null && typeof (x as { close?: unknown }).close === 'function';
}

/** Closes an ImageBitmap-like source (canvases are left to the garbage collector). */
function closeSource(src: unknown): void {
  if (!isClosable(src)) return;
  try {
    src.close();
  } catch {
    // already closed
  }
}

/** Closes a replaced working bitmap after a short delay, unless it is the current image again. */
function releaseLater(src: CanvasImageSource): void {
  if (!isClosable(src)) return;
  setTimeout(() => {
    if (image.peek()?.working !== src) closeSource(src);
  }, BITMAP_CLOSE_DELAY_MS);
}

function applyImage(
  source: CanvasImageSource,
  width: number,
  height: number,
  name: string,
  original: File | null,
): void {
  const previous = image.peek()?.working;
  image.value = { original, working: source, width, height, name };
  fixation.value = { x: width / 2, y: height / 2 };
  viewMode.value = 'simulated';
  photoError.value = '';
  if (previous && previous !== source) releaseLater(previous);
}

/**
 * Use a ready-made image (built-in test image, or a decoded photo). Resets fixation to centre.
 * Any photo still loading is cancelled (its result will be discarded).
 */
export function setWorkingImage(
  source: CanvasImageSource,
  width: number,
  height: number,
  name: string,
  original: File | null = null,
): void {
  loadSeq++;
  activity++;
  applyImage(source, width, height, name, original);
}

const HEIC_RE = /\.(heic|heif)$/i;

function isHeic(file: File): boolean {
  return /^image\/hei[cf]$/i.test(file.type) || HEIC_RE.test(file.name);
}

export const HEIC_ERROR =
  "This photo format can't be opened in this browser — try JPEG (on iPhone: Settings → Camera → Formats → Most Compatible).";
export const GENERIC_PHOTO_ERROR =
  "This photo can't be opened — the file may be damaged or in a format this browser doesn't support. Try a JPEG or PNG.";

/** Plain-language reason a photo could not be opened. */
export function photoErrorFor(file: File): string {
  return isHeic(file) ? HEIC_ERROR : GENERIC_PHOTO_ERROR;
}

/** Runs one load with latest-wins semantics. `fn` resolves the image; `fail` is the error message. */
async function runLoad<T>(
  fn: () => Promise<T>,
  apply: (r: T) => void,
  discard: (r: T) => void,
  fail: string,
): Promise<boolean> {
  const token = ++loadSeq;
  activity++;
  loadsInFlight++;
  photoLoading.value = true;
  photoError.value = '';
  try {
    const result = await fn();
    if (token !== loadSeq) {
      discard(result);
      return false;
    }
    apply(result);
    return true;
  } catch {
    if (token === loadSeq) photoError.value = fail;
    return false;
  } finally {
    loadsInFlight--;
    photoLoading.value = loadsInFlight > 0;
  }
}

/**
 * Decodes a photo file and makes it the current image. Resolves false (and sets photoError) on
 * failure, and false without any message when a newer load request replaced this one.
 */
export async function loadPhoto(file: File): Promise<boolean> {
  return runLoad(
    () => loadWorkingImage(file),
    (img) => applyImage(img.working, img.width, img.height, file.name, img.original),
    (img) => closeSource(img.working),
    photoErrorFor(file),
  );
}

/** Draws a built-in test image (see assets/testImages) and makes it the current image. */
export async function loadTestImage(id: string): Promise<boolean> {
  const def = testImages.find((t) => t.id === id);
  if (!def) return false;
  return runLoad(
    () => rasterizeTestImage(def),
    (canvas) => applyImage(canvas, canvas.width, canvas.height, def.name, null),
    () => undefined,
    'Could not draw that test image.',
  );
}

// --- Profile edits and undo ---------------------------------------------------------------
// Backed by model/history.ts. Edit functions must be pure: return a new Profile, never mutate the
// one they receive.

const history = new History<Profile>(profile.peek(), UNDO_LIMIT);
/** Bumped whenever the history changes, so canUndo / canRedo recompute. */
const historyVersion = signal(0);

export const canUndo = computed(() => {
  void historyVersion.value;
  return history.canUndo;
});
export const canRedo = computed(() => {
  void historyVersion.value;
  return history.canRedo;
});

function syncFromHistory(): void {
  profile.value = history.present;
  historyVersion.value++;
}

/**
 * Applies an edit to the profile and records it for undo. Consecutive edits with the same
 * coalesceKey (for example while dragging a slider) merge into one undo step until endEdit(),
 * undo(), redo() or an edit with a different key.
 */
export function applyEdit(fn: (p: Profile) => Profile, coalesceKey?: string): void {
  const cur = profile.value;
  const result = fn(cur);
  if (result === cur) return;
  const next: Profile = { ...result, updatedAt: new Date().toISOString() };
  activity++;
  history.push(next, coalesceKey);
  syncFromHistory();
}

/** Ends the current coalescing run (call on pointer-up / slider release). */
export function endEdit(): void {
  history.endCoalesce();
}

export function undo(): void {
  if (history.undo() !== undefined) syncFromHistory();
}

export function redo(): void {
  if (history.redo() !== undefined) syncFromHistory();
}

/** Replaces the whole profile (new, or loaded from storage) and clears undo history. */
export function resetProfile(p: Profile = newProfile()): void {
  activity++;
  history.reset(p);
  syncFromHistory();
  selectedRegionId.value = null;
}

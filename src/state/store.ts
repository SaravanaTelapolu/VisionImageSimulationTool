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

/** Use a ready-made image (built-in test image, or a decoded photo). Resets fixation to centre. */
export function setWorkingImage(
  source: CanvasImageSource,
  width: number,
  height: number,
  name: string,
  original: File | null = null,
): void {
  image.value = { original, working: source, width, height, name };
  fixation.value = { x: width / 2, y: height / 2 };
  viewMode.value = 'simulated';
  photoError.value = '';
}

/** Decodes a photo file and makes it the current image. Resolves false (and sets photoError) on failure. */
export async function loadPhoto(file: File): Promise<boolean> {
  photoLoading.value = true;
  photoError.value = '';
  try {
    const img = await loadWorkingImage(file);
    setWorkingImage(img.working, img.width, img.height, file.name, img.original);
    return true;
  } catch {
    photoError.value = 'Could not open that image.';
    return false;
  } finally {
    photoLoading.value = false;
  }
}

/** Draws a built-in test image (see assets/testImages) and makes it the current image. */
export async function loadTestImage(id: string): Promise<boolean> {
  const def = testImages.find((t) => t.id === id);
  if (!def) return false;
  photoLoading.value = true;
  photoError.value = '';
  try {
    const canvas = await rasterizeTestImage(def);
    setWorkingImage(canvas, canvas.width, canvas.height, def.name);
    return true;
  } catch {
    photoError.value = 'Could not draw that test image.';
    return false;
  } finally {
    photoLoading.value = false;
  }
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
  history.reset(p);
  syncFromHistory();
  selectedRegionId.value = null;
}

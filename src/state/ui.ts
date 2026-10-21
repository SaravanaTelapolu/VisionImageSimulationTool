// UI-only state that several components share (not part of the profile or undo history).
import { signal } from '@preact/signals';

/** True while the full-screen calibration guide is shown. */
export const calibrationOpen = signal(false);

export function openCalibration(): void {
  calibrationOpen.value = true;
}

export function closeCalibration(): void {
  calibrationOpen.value = false;
}

// --- Compare, present and timeline ---------------------------------------------------------

export type CompareMode = 'single' | 'wipe' | 'side';

export const COMPARE_MODES: readonly CompareMode[] = ['single', 'wipe', 'side'];

/** How the image area shows original vs simulated: one view, a wipe divider, or two views. */
export const compareMode = signal<CompareMode>('single');

/** Wipe divider position as a fraction (0..1) of the viewport width, left to right. */
export const wipePos = signal(0.5);

/** True while the full-screen presentation mode is shown. */
export const presentOpen = signal(false);

/** True while the timeline of saved profiles is shown. */
export const timelineOpen = signal(false);

export function openPresent(): void {
  presentOpen.value = true;
}

export function closePresent(): void {
  presentOpen.value = false;
}

export function openTimeline(): void {
  timelineOpen.value = true;
}

export function closeTimeline(): void {
  timelineOpen.value = false;
}

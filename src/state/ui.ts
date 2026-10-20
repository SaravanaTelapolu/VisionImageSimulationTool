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

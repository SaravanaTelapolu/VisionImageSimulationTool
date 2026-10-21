// Viewing-distance constants, presets and labels (pure, shared by validation, UI and storage code).

export const MIN_VIEWING_DISTANCE_CM = 10;
/** Far vision may mean a laptop or a TV across the room. */
export const MAX_VIEWING_DISTANCE_CM = 600;
export const DEFAULT_VIEWING_DISTANCE_CM = 40;

export interface DistancePreset {
  id: 'near' | 'computer' | 'far';
  label: string;
  cm: number;
}

export const DISTANCE_PRESETS: readonly DistancePreset[] = [
  { id: 'near', label: 'Near (reading)', cm: 40 },
  { id: 'computer', label: 'Computer', cm: 70 },
  { id: 'far', label: 'Far', cm: 300 },
];

export type DistanceBand = 'Near' | 'Computer' | 'Far';

/** Up to this distance is "Near" (reading distance). */
export const NEAR_MAX_CM = 60;
/** Up to this distance (above Near) is "Computer" (intermediate); beyond it is "Far". */
export const INTERMEDIATE_MAX_CM = 150;

/** Near (<= 60 cm), Computer (61-150 cm) or Far (> 150 cm). */
export function distanceBand(cm: number): DistanceBand {
  if (cm <= NEAR_MAX_CM) return 'Near';
  if (cm <= INTERMEDIATE_MAX_CM) return 'Computer';
  return 'Far';
}

/** "40 cm" / "37.5 cm" (one decimal at most). */
export function formatDistance(cm: number): string {
  return `${Math.round(cm * 10) / 10} cm`;
}

/** "Near · 40 cm", for profile lists and timeline captions. */
export function distanceLabel(cm: number): string {
  return `${distanceBand(cm)} · ${formatDistance(cm)}`;
}

/** A usable stored/typed default distance (rounded to 0.1, clamped to range), or the built-in 40 cm. */
export function sanitizeDefaultDistance(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_VIEWING_DISTANCE_CM;
  const rounded = Math.round(v * 10) / 10;
  return Math.min(MAX_VIEWING_DISTANCE_CM, Math.max(MIN_VIEWING_DISTANCE_CM, rounded));
}

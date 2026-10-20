import { signal } from '@preact/signals';
import type { MaskData } from '../render/shapeCoverage';

/**
 * Decoded greyscale data for 'mask' regions, keyed by region id. The effect-map builder reads
 * this; the brush tool (W3-4) keeps it in sync with each mask region's dataUrl.
 */
export const maskData = signal<Map<string, MaskData>>(new Map());

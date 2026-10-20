// Pure helpers for slider values: clamping, step snapping, display formatting.

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Number of decimals needed to show multiples of `step` exactly (capped at 6). */
export function decimalsForStep(step: number): number {
  const s = Math.abs(step);
  if (!Number.isFinite(s) || s === 0) return 0;
  for (let d = 0; d < 6; d++) {
    const f = 10 ** d;
    if (Math.abs(Math.round(s * f) / f - s) < 1e-9) return d;
  }
  return 6;
}

/** Rounds to the nearest step on the grid that starts at `min`, then clamps to [min, max]. */
export function snapToStep(value: number, min: number, max: number, step: number): number {
  if (!(step > 0)) return clamp(value, min, max);
  const snapped = min + Math.round((value - min) / step) * step;
  const d = Math.max(decimalsForStep(step), decimalsForStep(min));
  return clamp(Number(snapped.toFixed(d)), min, max);
}

export interface FormatOptions {
  /** Multiplier from stored units to displayed units (for example 100 for 0..1 shown as %). */
  scale?: number;
  /** Fixed decimals; derived from `step` x `scale` when omitted. */
  decimals?: number;
  step?: number;
  /** Prefix positive numbers with "+". */
  signed?: boolean;
}

/** Formats a stored value as the number shown to the user (no unit). */
export function formatValue(value: number, opts: FormatOptions = {}): string {
  const scale = opts.scale ?? 1;
  const decimals = opts.decimals ?? decimalsForStep((opts.step ?? 1) * scale);
  let text = (value * scale).toFixed(decimals);
  // Avoid "-0" and "-0.0".
  if (Number(text) === 0) text = (0).toFixed(decimals);
  if (opts.signed && Number(text) > 0) text = `+${text}`;
  return text;
}

/** "%" and "°" attach to the number; other units (px, cm) are separated by a space. */
export function formatWithUnit(value: number, unit: string | undefined, opts: FormatOptions = {}): string {
  const num = formatValue(value, opts);
  if (!unit) return num;
  return unit === '%' || unit === '°' ? `${num}${unit}` : `${num} ${unit}`;
}

/** Position of `value` within [min, max] as 0..100 (used for the track fill). */
export function valueToPercent(value: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

/** Inverse of valueToPercent, snapped to `step`. */
export function percentToValue(percent: number, min: number, max: number, step: number): number {
  const raw = min + (clamp(percent, 0, 100) / 100) * (max - min);
  return snapToStep(raw, min, max, step);
}

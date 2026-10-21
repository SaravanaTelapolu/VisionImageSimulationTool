import type { Eye } from '../model/types';

export interface CaptionInfo {
  date: Date;
  eye: Eye;
  viewingDistanceCm: number;
  note?: string;
  profileName?: string;
}

export const APPROXIMATION_LINE = 'My own approximation — not a clinical measurement.';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "20 Oct 2026" (local date, English month names regardless of locale). */
export function formatCaptionDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''} ${date.getFullYear()}`;
}

/**
 * Caption lines, before wrapping: date/eye/distance, optional profile name, optional note
 * (one line per non-empty note line), and always the approximation disclaimer last.
 */
export function buildCaptionLines(info: CaptionInfo): string[] {
  const eye = info.eye === 'left' ? 'Left eye' : 'Right eye';
  const dist = Number.isFinite(info.viewingDistanceCm) ? Math.round(info.viewingDistanceCm * 10) / 10 : 0;
  const lines = [`${formatCaptionDate(info.date)} · ${eye} · viewed at ${dist} cm`];
  const name = info.profileName?.trim();
  if (name) lines.push(`Profile: ${name}`);
  for (const part of (info.note ?? '').split(/\r?\n/)) {
    const t = part.trim();
    if (t) lines.push(t);
  }
  lines.push(APPROXIMATION_LINE);
  return lines;
}

/**
 * Greedy word wrap using an injected width measure. Explicit newlines are kept; words wider
 * than maxWidth are broken by character so nothing overflows.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      if (line && measure(`${line} ${word}`) <= maxWidth) {
        line = `${line} ${word}`;
        continue;
      }
      if (line) out.push(line);
      line = breakLong(word, maxWidth, measure, out);
    }
    out.push(line);
  }
  return out;
}

/** Pushes full-width chunks of an over-long word to `out`; returns the remainder. */
function breakLong(word: string, maxWidth: number, measure: (s: string) => number, out: string[]): string {
  let rest = word;
  while (rest.length > 1 && measure(rest) > maxWidth) {
    let n = rest.length - 1;
    while (n > 1 && measure(rest.slice(0, n)) > maxWidth) n--;
    out.push(rest.slice(0, n));
    rest = rest.slice(n);
  }
  return rest;
}

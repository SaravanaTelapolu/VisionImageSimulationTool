// Pure helpers for the profiles panel and the timeline (no DOM, easy to test).
import { formatCaptionDate } from '../../../export/caption';
import type { Profile } from '../../../model/types';

export const DEFAULT_TIMELINE_COUNT = 4;
export const NOTE_PREVIEW_CHARS = 80;
/** Widest timeline image we will compose (pixels), to stay inside phone canvas limits. */
export const MAX_TIMELINE_EXPORT_WIDTH = 4096;
export const MAX_TIMELINE_TILE_WIDTH = 640;

/** "20 Oct 2026" from an ISO string; '' if the date is invalid. */
export function formatProfileDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : formatCaptionDate(d);
}

/** Single-line preview of a note, cut at `max` characters with an ellipsis. */
export function notePreview(note: string, max: number = NOTE_PREVIEW_CHARS): string {
  const flat = note.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function regionCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'region' : 'regions'}`;
}

interface Dated {
  id: string;
  createdAt: string;
}

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Oldest first (timeline order). Ties keep their input order. */
export function sortOldestFirst<T extends Dated>(items: readonly T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => time(a.item.createdAt) - time(b.item.createdAt) || a.i - b.i)
    .map((x) => x.item);
}

/** Ids of the `count` most recent items (by createdAt), the default timeline choice. */
export function defaultTimelineSelection<T extends Dated>(
  items: readonly T[],
  count: number = DEFAULT_TIMELINE_COUNT,
): string[] {
  const sorted = sortOldestFirst(items);
  return sorted.slice(Math.max(0, sorted.length - Math.max(0, count))).map((x) => x.id);
}

/** Toggles an id in a selection, returning a new array (selection order is not significant). */
export function toggleId(selection: readonly string[], id: string): string[] {
  return selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
}

/** The profiles to show: chosen ones only, oldest first. */
export function selectTimelineProfiles(all: readonly Profile[], selectedIds: readonly string[]): Profile[] {
  const chosen = new Set(selectedIds);
  return sortOldestFirst(all.filter((p) => chosen.has(p.id)));
}

/** Date plus name, e.g. "20 Oct 2026". Name is added on a second line by the caller. */
export function timelineCaption(p: Pick<Profile, 'createdAt'>): string {
  return formatProfileDate(p.createdAt);
}

export interface TimelineExportLayoutInput {
  count: number;
  /** Rendered image size (all tiles share it). */
  imageWidth: number;
  imageHeight: number;
}

export interface TimelineExportLayout {
  width: number;
  /** Height of the picture area plus the per-tile caption band; the footer is added by the caller. */
  bodyHeight: number;
  pad: number;
  gap: number;
  tileWidth: number;
  tileHeight: number;
  fontPx: number;
  /** Space under each tile for the date and name lines. */
  captionBand: number;
  /** Top-left of each tile. */
  tiles: { x: number; y: number }[];
}

/** Lays out `count` tiles in one row: scaled down to fit MAX_TIMELINE_EXPORT_WIDTH, never scaled up. */
export function layoutTimelineExport(i: TimelineExportLayoutInput): TimelineExportLayout {
  const count = Math.max(1, Math.floor(i.count));
  const iw = Math.max(1, i.imageWidth);
  const ih = Math.max(1, i.imageHeight);
  const tileWidth0 = Math.min(MAX_TIMELINE_TILE_WIDTH, iw);
  const pad0 = Math.max(12, Math.round(tileWidth0 / 24));
  const gap = pad0;
  const fits = Math.floor((MAX_TIMELINE_EXPORT_WIDTH - 2 * pad0 - (count - 1) * gap) / count);
  const tileWidth = Math.max(40, Math.min(tileWidth0, fits));
  const tileHeight = Math.max(1, Math.round((tileWidth * ih) / iw));
  const fontPx = Math.max(12, Math.round(tileWidth / 22));
  const pad = pad0;
  const captionBand = Math.round(fontPx * 3.4);
  const width = 2 * pad + count * tileWidth + (count - 1) * gap;
  const top = pad + Math.round(fontPx * 1.6); // title row
  const tiles = Array.from({ length: count }, (_, k) => ({ x: pad + k * (tileWidth + gap), y: top }));
  return {
    width,
    bodyHeight: top + tileHeight + captionBand,
    pad,
    gap,
    tileWidth,
    tileHeight,
    fontPx,
    captionBand,
    tiles,
  };
}

/** e.g. "vision-sim_2026-10-20_timeline.png". */
export function timelineFileName(date: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `vision-sim_${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}_timeline.png`;
}

import { describe, expect, it } from 'vitest';
import { newProfile } from '../../../model/defaults';
import {
  MAX_TIMELINE_EXPORT_WIDTH,
  defaultTimelineSelection,
  formatProfileDate,
  layoutTimelineExport,
  notePreview,
  regionCountLabel,
  selectTimelineProfiles,
  sortOldestFirst,
  timelineFileName,
  toggleId,
} from './helpers';

const mk = (id: string, createdAt: string) => ({ ...newProfile(id, new Date(createdAt)), id, createdAt });

describe('formatProfileDate', () => {
  it('formats local dates and tolerates bad input', () => {
    expect(formatProfileDate(new Date(2026, 9, 20, 12).toISOString())).toBe('20 Oct 2026');
    expect(formatProfileDate('garbage')).toBe('');
  });
});

describe('notePreview', () => {
  it('flattens whitespace and truncates', () => {
    expect(notePreview('  a\n\n b   c ')).toBe('a b c');
    expect(notePreview('x'.repeat(100), 10)).toBe('xxxxxxxxx…');
    expect(notePreview('short', 10)).toBe('short');
    expect(notePreview('')).toBe('');
  });
});

describe('regionCountLabel', () => {
  it('pluralises', () => {
    expect(regionCountLabel(0)).toBe('0 regions');
    expect(regionCountLabel(1)).toBe('1 region');
    expect(regionCountLabel(3)).toBe('3 regions');
  });
});

describe('timeline selection', () => {
  const items = [
    mk('b', '2026-02-01T00:00:00.000Z'),
    mk('e', '2026-05-01T00:00:00.000Z'),
    mk('a', '2026-01-01T00:00:00.000Z'),
    mk('d', '2026-04-01T00:00:00.000Z'),
    mk('c', '2026-03-01T00:00:00.000Z'),
  ];

  it('sorts oldest first', () => {
    expect(sortOldestFirst(items).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('defaults to the 4 most recent', () => {
    expect(defaultTimelineSelection(items).sort()).toEqual(['b', 'c', 'd', 'e']);
    expect(defaultTimelineSelection(items.slice(0, 2))).toHaveLength(2);
    expect(defaultTimelineSelection([])).toEqual([]);
    expect(defaultTimelineSelection(items, 0)).toEqual([]);
  });

  it('toggles ids without mutating', () => {
    const sel = ['a'];
    expect(toggleId(sel, 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
    expect(sel).toEqual(['a']);
  });

  it('selects chosen profiles in date order', () => {
    expect(selectTimelineProfiles(items, ['e', 'a', 'zzz']).map((p) => p.id)).toEqual(['a', 'e']);
  });
});

describe('layoutTimelineExport', () => {
  it('lays tiles in a row, never scaling up', () => {
    const l = layoutTimelineExport({ count: 3, imageWidth: 400, imageHeight: 200 });
    expect(l.tileWidth).toBe(400);
    expect(l.tileHeight).toBe(200);
    expect(l.tiles).toHaveLength(3);
    expect(l.tiles[1]!.x - l.tiles[0]!.x).toBe(l.tileWidth + l.gap);
    expect(l.width).toBe(2 * l.pad + 3 * l.tileWidth + 2 * l.gap);
    expect(l.bodyHeight).toBe(l.tiles[0]!.y + l.tileHeight + l.captionBand);
  });

  it('shrinks tiles so many of them stay within the maximum width', () => {
    const l = layoutTimelineExport({ count: 10, imageWidth: 2000, imageHeight: 1000 });
    expect(l.width).toBeLessThanOrEqual(MAX_TIMELINE_EXPORT_WIDTH);
    expect(l.tileHeight).toBe(Math.round(l.tileWidth / 2));
  });

  it('copes with degenerate input', () => {
    const l = layoutTimelineExport({ count: 0, imageWidth: 0, imageHeight: 0 });
    expect(l.tiles).toHaveLength(1);
    expect(l.width).toBeGreaterThan(0);
  });
});

describe('timelineFileName', () => {
  it('uses the local date', () => {
    expect(timelineFileName(new Date(2026, 0, 5))).toBe('vision-sim_2026-01-05_timeline.png');
  });
});

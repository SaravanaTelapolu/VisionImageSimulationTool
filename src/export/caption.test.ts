import { describe, expect, it } from 'vitest';
import { APPROXIMATION_LINE, buildCaptionLines, wrapText } from './caption';

describe('buildCaptionLines', () => {
  const date = new Date(2026, 9, 20);

  it('starts with date, eye and distance and ends with the approximation line', () => {
    const lines = buildCaptionLines({ date, eye: 'right', viewingDistanceCm: 40 });
    expect(lines).toEqual(['20 Oct 2026 · Right eye · viewed at 40 cm', APPROXIMATION_LINE]);
    expect(APPROXIMATION_LINE).toBe('My own approximation — not a clinical measurement.');
  });

  it('handles the left eye and fractional distances', () => {
    const lines = buildCaptionLines({ date: new Date(2026, 0, 5), eye: 'left', viewingDistanceCm: 37.46 });
    expect(lines[0]).toBe('5 Jan 2026 · Left eye · viewed at 37.5 cm');
  });

  it('includes profile name and note before the approximation line', () => {
    const lines = buildCaptionLines({
      date,
      eye: 'right',
      viewingDistanceCm: 40,
      note: 'Reading a menu\n\n  at dinner ',
      profileName: ' Check-up 3 ',
    });
    expect(lines).toEqual([
      '20 Oct 2026 · Right eye · viewed at 40 cm',
      'Profile: Check-up 3',
      'Reading a menu',
      'at dinner',
      APPROXIMATION_LINE,
    ]);
  });

  it('ignores a blank note', () => {
    const lines = buildCaptionLines({ date, eye: 'left', viewingDistanceCm: 30, note: '   ' });
    expect(lines).toHaveLength(2);
    expect(lines.at(-1)).toBe(APPROXIMATION_LINE);
  });
});

describe('wrapText', () => {
  const measure = (s: string): number => s.length;

  it('keeps short text on one line', () => {
    expect(wrapText('hello world', 20, measure)).toEqual(['hello world']);
  });

  it('wraps greedily at word boundaries', () => {
    expect(wrapText('the quick brown fox jumps', 10, measure)).toEqual(['the quick', 'brown fox', 'jumps']);
  });

  it('allows a line that exactly fits', () => {
    expect(wrapText('abc def', 7, measure)).toEqual(['abc def']);
  });

  it('breaks words longer than the width', () => {
    const out = wrapText('abcdefghij kl', 4, measure);
    expect(out.every((l) => l.length <= 4)).toBe(true);
    expect(out.join('').replace(/ /g, '')).toBe('abcdefghijkl');
  });

  it('keeps explicit newlines and collapses extra spaces', () => {
    expect(wrapText('a  b\nc', 10, measure)).toEqual(['a b', 'c']);
  });

  it('returns a single empty line for empty text', () => {
    expect(wrapText('', 10, measure)).toEqual(['']);
  });

  it('uses the injected measure (proportional widths)', () => {
    const wide = (s: string): number => [...s].reduce((a, c) => a + (c === 'W' ? 3 : 1), 0);
    expect(wrapText('WW WW', 6, wide)).toEqual(['WW', 'WW']);
  });
});

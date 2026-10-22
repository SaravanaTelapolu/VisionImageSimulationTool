import { describe, expect, it } from 'vitest';
import { defaultEllipse, defaultRect, newProfile, newRegion } from '../../../model/defaults';
import { addRegion } from '../../../model/ops';
import { cleanRegionName, nextRegionName, selectionAfterDelete, shapeLabel } from './helpers';

describe('nextRegionName', () => {
  it('numbers spots and skips used names', () => {
    let p = newProfile();
    expect(nextRegionName(p, 'ellipse')).toBe('Spot 1');
    p = addRegion(p, newRegion(defaultEllipse(), 'Spot 1'));
    p = addRegion(p, newRegion(defaultEllipse(), 'Spot 3'));
    expect(nextRegionName(p, 'ellipse')).toBe('Spot 2');
  });
  it('numbers rectangles separately from oval spots', () => {
    let p = addRegion(newProfile(), newRegion(defaultEllipse(), 'Spot 1'));
    expect(nextRegionName(p, 'rect')).toBe('Rectangle 1');
    p = addRegion(p, newRegion(defaultRect(), 'Rectangle 1'));
    expect(nextRegionName(p, 'rect')).toBe('Rectangle 2');
    expect(shapeLabel('rect')).toBe('Rectangle');
  });
  it('uses a plain name for the first whole-image region', () => {
    let p = newProfile();
    expect(nextRegionName(p, 'full')).toBe('Whole image');
    p = addRegion(p, newRegion({ type: 'full' }, 'Whole image'));
    expect(nextRegionName(p, 'full')).toBe('Whole image 1');
  });
});

describe('selectionAfterDelete', () => {
  it('picks the region that takes the deleted one’s place, else the last, else null', () => {
    const a = newRegion(defaultEllipse(), 'a');
    const b = newRegion(defaultEllipse(), 'b');
    const c = newRegion(defaultEllipse(), 'c');
    const p = [a, b, c].reduce((acc, r) => addRegion(acc, r), newProfile());
    expect(selectionAfterDelete(p, b.id)).toBe(c.id);
    expect(selectionAfterDelete(p, c.id)).toBe(b.id);
    expect(selectionAfterDelete(addRegion(newProfile(), a), a.id)).toBeNull();
    expect(selectionAfterDelete(p, 'missing')).toBeNull();
  });
});

describe('cleanRegionName', () => {
  it('trims, collapses spaces, rejects empty', () => {
    expect(cleanRegionName('  Left   scar ')).toBe('Left scar');
    expect(cleanRegionName('   ')).toBeNull();
    expect(cleanRegionName('x'.repeat(100))).toHaveLength(60);
  });
});

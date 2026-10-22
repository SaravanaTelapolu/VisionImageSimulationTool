// Pure helpers for the Regions panel.

import type { Profile, ShapeType } from '../../../model/types';

const BASE_NAMES: Record<ShapeType, string> = {
  ellipse: 'Spot',
  rect: 'Rectangle',
  path: 'Area',
  mask: 'Brush area',
  full: 'Whole image',
};

/** "Spot 1", "Spot 2", ...: the first number not already used by a region name. "Whole image" stays plain until repeated. */
export function nextRegionName(profile: Profile, type: ShapeType): string {
  const base = BASE_NAMES[type];
  const used = new Set(profile.regions.map((r) => r.name));
  if (type === 'full' && !used.has(base)) return base;
  for (let n = 1; ; n++) {
    const name = `${base} ${n}`;
    if (!used.has(name)) return name;
  }
}

/** After deleting the region at `index`, which region id should be selected (null when none are left). */
export function selectionAfterDelete(profile: Profile, deletedId: string): string | null {
  const i = profile.regions.findIndex((r) => r.id === deletedId);
  if (i < 0) return null;
  const rest = profile.regions.filter((r) => r.id !== deletedId);
  if (rest.length === 0) return null;
  return (rest[Math.min(i, rest.length - 1)] as { id: string }).id;
}

/** Trims a renamed region; an empty name is rejected (returns null) so the old name is kept. */
export function cleanRegionName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  return name.length > 0 ? name.slice(0, 60) : null;
}

/** Short human description of a shape type for the list. */
export function shapeLabel(type: ShapeType): string {
  switch (type) {
    case 'ellipse':
      return 'Spot';
    case 'rect':
      return 'Rectangle';
    case 'path':
      return 'Freehand';
    case 'mask':
      return 'Brush';
    case 'full':
      return 'Whole image';
  }
}

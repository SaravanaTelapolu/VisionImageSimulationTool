// Pure geometry for editing a freehand outline (points in shorter-side units).

type Pt = [number, number];

/** At most this many vertex handles are shown, however detailed the outline is. */
export const MAX_VERTEX_HANDLES = 40;

/** Moves every point by (dx, dy). */
export function translatePoints(points: readonly Pt[], dx: number, dy: number): Pt[] {
  return points.map(([x, y]) => [x + dx, y + dy] as Pt);
}

/** Spacing (in vertices) between shown handles, so no more than `max` are shown. */
export function handleStep(count: number, max = MAX_VERTEX_HANDLES): number {
  return count <= max ? 1 : Math.ceil(count / max);
}

/** Indices of the vertices that get a handle: all of them for small outlines, otherwise evenly sampled. */
export function handleIndices(count: number, max = MAX_VERTEX_HANDLES): number[] {
  const step = handleStep(count, max);
  const out: number[] = [];
  for (let i = 0; i < count; i += step) out.push(i);
  return out;
}

/**
 * Moves vertex `index` by (dx, dy). With `step` > 1 (sampled handles) the vertices between this
 * handle and its neighbouring handles follow with a smooth fall-off, so a sampled handle still
 * reshapes the outline locally instead of kinking one vertex. Distances wrap around the outline.
 */
export function dragVertex(points: readonly Pt[], index: number, dx: number, dy: number, step = 1): Pt[] {
  const n = points.length;
  const out = points.map(([x, y]) => [x, y] as Pt);
  if (n === 0 || index < 0 || index >= n) return out;
  const reach = Math.max(1, Math.floor(step));
  for (let k = -(reach - 1); k <= reach - 1; k++) {
    const i = (((index + k) % n) + n) % n;
    const w = reach === 1 ? 1 : 0.5 * (1 + Math.cos((Math.PI * Math.abs(k)) / reach));
    const p = out[i] as Pt;
    p[0] += dx * w;
    p[1] += dy * w;
  }
  return out;
}

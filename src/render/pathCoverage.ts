// Fast coverage raster for freehand (path) regions. Pure maths: no DOM or canvas.
//
// Definition (unchanged from the original per-pixel sampler): for map pixel centre p,
//   inside  = even-odd rule on the closed polygon
//   hard    (featherWidth ~ 0): clamp01(0.5 +- dist / pixel)      (about 1 px of anti-aliasing, both sides)
//   feather: inside ? smoothstep(0, featherWidth, dist) : 0       (dist = distance to the nearest edge)
//
// The original evaluated O(n) work for every pixel in the bounding box (O(area x n)). This version is
// O(area + edges x band):
//   1. Scanline fill (even-odd). Edge crossings are bucketed per row once, sorted, and the spans between
//      crossing pairs are filled with 1. Replaces the per-pixel point-in-polygon test.
//   2. Per-edge distance stamping. Each edge writes its exact point-to-segment distance only to pixels whose
//      centre lies within a reach `s` of the edge (clipped per row to the capsule around the edge), keeping the
//      minimum. Only pixels near an edge ever need a distance: deeper inside the result is 1 and outside it is 0.
//   3. If the feather is wider than SEED_PIXELS (8) map pixels, stamping stops at that seed radius and the nearest
//      boundary point of each seeded pixel is propagated inwards with a two-pass chamfer-style sweep
//      (8SSEDT-style: carry the nearest point, not just a distance). Distances for pixels beyond the seed band
//      are then exact except at the rare medial-axis ties where a neighbour's nearest point is marginally
//      farther than the true one. Edges outside a clipped map box are handled by seeding the box border exactly (measured max difference from the original: under 1/255 on very jagged random outlines).
//      For hard edges and narrow feathers (the band is entirely within the stamped radius) the result is exact.
//
// Scratch buffers are module-level and reused between calls (no per-call allocation in the hot loops), so the
// raster returned by buildPathCoverage is only valid until the next call. The effect-map builder uses one
// sampler at a time, and a Web Worker has its own module instance, so this is safe.

export interface PathCoverage {
  /** Inclusive map-pixel bounds the raster covers. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Row-major coverage (0..1) of the (x1 - x0 + 1) x (y1 - y0 + 1) bounding box; valid until the next call. */
  cov: Float32Array;
}

interface Scratch {
  cov: Float32Array;
  dist2: Float32Array;
  qx: Float32Array;
  qy: Float32Array;
  rowStart: Int32Array;
  rowCursor: Int32Array;
  cross: Float64Array;
}

const scratch: Scratch = {
  cov: new Float32Array(0),
  dist2: new Float32Array(0),
  qx: new Float32Array(0),
  qy: new Float32Array(0),
  rowStart: new Int32Array(0),
  rowCursor: new Int32Array(0),
  cross: new Float64Array(0),
};

function grownF32(a: Float32Array, n: number): Float32Array {
  return a.length >= n ? a : new Float32Array(Math.max(n, a.length * 2));
}

/** Seed radius (in map pixels) for exact stamping; wider bands are completed by propagation. */
const SEED_PIXELS = 8;

/** Adopts neighbour nidx's carried boundary point for pixel idx when it is nearer. Saturated sources (D >= r2) are not spread. */
function relax(
  d: Float32Array,
  qx: Float32Array,
  qy: Float32Array,
  idx: number,
  nidx: number,
  px: number,
  py: number,
  r2: number,
): void {
  if (!(d[nidx]! < r2)) return;
  const ax = px - qx[nidx]!;
  const ay = py - qy[nidx]!;
  const d2 = ax * ax + ay * ay;
  if (d2 < d[idx]!) {
    d[idx] = d2;
    qx[idx] = qx[nidx]!;
    qy[idx] = qy[nidx]!;
  }
}

/** Brute-force nearest point on the polygon outline for one pixel; keeps the result if it improves on D. */
function seedExact(
  xs: Float64Array,
  ys: Float64Array,
  n: number,
  px: number,
  py: number,
  idx: number,
  D: Float32Array,
  QX: Float32Array,
  QY: Float32Array,
): void {
  let best = D[idx]!;
  let bx = 0;
  let by = 0;
  let found = false;
  for (let a = 0, q = n - 1; a < n; q = a++) {
    const xa = xs[q]!;
    const ya = ys[q]!;
    const ex = xs[a]! - xa;
    const ey = ys[a]! - ya;
    const len2 = ex * ex + ey * ey;
    let t = len2 > 0 ? ((px - xa) * ex + (py - ya) * ey) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = xa + t * ex;
    const cy = ya + t * ey;
    const d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
    if (d2 < best) {
      best = d2;
      bx = cx;
      by = cy;
      found = true;
    }
  }
  if (found) {
    D[idx] = best;
    QX[idx] = bx;
    QY[idx] = by;
  }
}

/**
 * Rasterises the coverage of a polygon (image-pixel vertices xs, ys; at least 3) over the inclusive map-pixel
 * box x0..x1, y0..y1. sx, sy are image pixels per map pixel; featherWidth is in image pixels.
 */
export function buildPathCoverage(
  xs: Float64Array,
  ys: Float64Array,
  n: number,
  box: { x0: number; y0: number; x1: number; y1: number },
  sx: number,
  sy: number,
  featherWidth: number,
): PathCoverage {
  const { x0, y0, x1, y1 } = box;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const area = w * h;
  const sc = scratch;
  sc.cov = grownF32(sc.cov, area);
  sc.dist2 = grownF32(sc.dist2, area);
  if (sc.rowStart.length < h + 1) sc.rowStart = new Int32Array(Math.max(h + 1, sc.rowStart.length * 2));
  if (sc.rowCursor.length < h) sc.rowCursor = new Int32Array(Math.max(h, sc.rowCursor.length * 2));
  const cov = sc.cov;
  const D = sc.dist2;
  const rowStart = sc.rowStart;
  const rowCursor = sc.rowCursor;

  // ---- 1. Scanline fill (even-odd) -------------------------------------------------------------------------
  cov.fill(0, 0, area);
  rowStart.fill(0, 0, h + 1);
  for (let a = 0, q = n - 1; a < n; q = a++) {
    const ya = ys[q]!;
    const yb = ys[a]!;
    if (ya === yb) continue;
    const lo = ya < yb ? ya : yb;
    const hi = ya < yb ? yb : ya;
    // Rows with lo <= (j + 0.5) * sy < hi.
    const jA = Math.max(y0, Math.ceil(lo / sy - 0.5));
    const jB = Math.min(y1, Math.ceil(hi / sy - 0.5) - 1);
    for (let j = jA; j <= jB; j++) rowStart[j - y0 + 1]!++;
  }
  for (let r = 0; r < h; r++) rowStart[r + 1] = rowStart[r + 1]! + rowStart[r]!;
  const totalCross = rowStart[h]!;
  if (sc.cross.length < totalCross) sc.cross = new Float64Array(Math.max(totalCross, sc.cross.length * 2));
  const cross = sc.cross;
  for (let r = 0; r < h; r++) rowCursor[r] = rowStart[r]!;
  for (let a = 0, q = n - 1; a < n; q = a++) {
    const xi = xs[a]!;
    const yi = ys[a]!;
    const xq = xs[q]!;
    const yq = ys[q]!;
    if (yi === yq) continue;
    const lo = yi < yq ? yi : yq;
    const hi = yi < yq ? yq : yi;
    const jA = Math.max(y0, Math.ceil(lo / sy - 0.5));
    const jB = Math.min(y1, Math.ceil(hi / sy - 0.5) - 1);
    const k = (xq - xi) / (yq - yi);
    for (let j = jA; j <= jB; j++) {
      const r = j - y0;
      cross[rowCursor[r]!++] = k * ((j + 0.5) * sy - yi) + xi;
    }
  }
  for (let r = 0; r < h; r++) {
    const s0 = rowStart[r]!;
    const s1 = rowStart[r + 1]!;
    // Insertion sort (rows hold a handful of crossings).
    for (let a = s0 + 1; a < s1; a++) {
      const v = cross[a]!;
      let b = a - 1;
      while (b >= s0 && cross[b]! > v) {
        cross[b + 1] = cross[b]!;
        b--;
      }
      cross[b + 1] = v;
    }
    const rowBase = r * w;
    for (let a = s0; a + 1 < s1; a += 2) {
      // Inside where cross[a] <= px < cross[a + 1]: i from ceil(c0 / sx - 0.5) to ceil(c1 / sx - 0.5) - 1.
      const iA = Math.max(x0, Math.ceil(cross[a]! / sx - 0.5));
      const iB = Math.min(x1, Math.ceil(cross[a + 1]! / sx - 0.5) - 1);
      if (iA <= iB) cov.fill(1, rowBase + iA - x0, rowBase + iB - x0 + 1);
    }
  }

  // ---- 2. Edge distance stamping ----------------------------------------------------------------------------
  const pixel = (sx + sy) / 2;
  const hard = featherWidth < 1e-6;
  // Distance past which the coverage is already saturated (1 inside, 0 outside).
  const reach = hard ? 0.5 * pixel : featherWidth;
  const propagate = reach > SEED_PIXELS * pixel;
  const s = propagate ? SEED_PIXELS * pixel : reach;
  if (propagate) {
    sc.qx = grownF32(sc.qx, area);
    sc.qy = grownF32(sc.qy, area);
  }
  const QX = sc.qx;
  const QY = sc.qy;
  D.fill(Infinity, 0, area);

  for (let a = 0, q = n - 1; a < n; q = a++) {
    const xa = xs[q]!;
    const ya = ys[q]!;
    const xb = xs[a]!;
    const yb = ys[a]!;
    const ex = xb - xa;
    const ey = yb - ya;
    const len2 = ex * ex + ey * ey;
    const inv = len2 > 0 ? 1 / len2 : 0;
    const ymin = ya < yb ? ya : yb;
    const ymax = ya < yb ? yb : ya;
    const jA = Math.max(y0, Math.ceil((ymin - s) / sy - 0.5));
    const jB = Math.min(y1, Math.floor((ymax + s) / sy - 0.5));
    for (let j = jA; j <= jB; j++) {
      const py = (j + 0.5) * sy;
      // x extent of the part of the edge inside the row's band py +- s.
      let xl: number;
      let xr: number;
      if (ey === 0) {
        xl = xa < xb ? xa : xb;
        xr = xa < xb ? xb : xa;
      } else {
        let t1 = (py - s - ya) / ey;
        let t2 = (py + s - ya) / ey;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        if (t1 < 0) t1 = 0;
        if (t2 > 1) t2 = 1;
        if (t1 > t2) continue;
        const xA = xa + ex * t1;
        const xB = xa + ex * t2;
        xl = xA < xB ? xA : xB;
        xr = xA < xB ? xB : xA;
      }
      const iA = Math.max(x0, Math.ceil((xl - s) / sx - 0.5));
      const iB = Math.min(x1, Math.floor((xr + s) / sx - 0.5));
      const rowBase = (j - y0) * w - x0;
      for (let i = iA; i <= iB; i++) {
        const px = (i + 0.5) * sx;
        let t = ((px - xa) * ex + (py - ya) * ey) * inv;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = xa + t * ex;
        const cy = ya + t * ey;
        const dx = px - cx;
        const dy = py - cy;
        const d2 = dx * dx + dy * dy;
        const idx = rowBase + i;
        if (d2 < D[idx]!) {
          D[idx] = d2;
          if (propagate) {
            QX[idx] = cx;
            QY[idx] = cy;
          }
        }
      }
    }
  }

  // A polygon clipped by the map has edges outside the box, so the interior may have no seeds nearby.
  // Seed the border pixels of the box with their exact nearest point (O(border x edges), clipped case only).
  if (propagate) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = xs[k]!;
      const y = ys[k]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (minX < x0 * sx || maxX > (x1 + 1) * sx || minY < y0 * sy || maxY > (y1 + 1) * sy) {
      for (let r = 0; r < h; r++) {
        const edgeRow = r === 0 || r === h - 1;
        for (let c = 0; c < w; c += edgeRow ? 1 : w - 1 || 1) {
          const idx = r * w + c;
          if (cov[idx]! === 0) continue;
          seedExact(xs, ys, n, (c + x0 + 0.5) * sx, (r + y0 + 0.5) * sy, idx, D, QX, QY);
        }
      }
    }
  }

  // ---- 3. Propagate nearest boundary points across the interior (wide feathers only) ----------------------
  if (propagate) {
    const s2 = s * s; // pixels with D <= s2 were stamped exactly and are final
    const r2 = reach * reach;
    for (let r = 0; r < h; r++) {
      const py = (r + y0 + 0.5) * sy;
      const base = r * w;
      for (let c = 0; c < w; c++) {
        const idx = base + c;
        if (cov[idx]! === 0 || D[idx]! <= s2) continue;
        const px = (c + x0 + 0.5) * sx;
        if (c > 0) relax(D, QX, QY, idx, idx - 1, px, py, r2);
        if (r > 0) {
          if (c > 0) relax(D, QX, QY, idx, idx - w - 1, px, py, r2);
          relax(D, QX, QY, idx, idx - w, px, py, r2);
          if (c < w - 1) relax(D, QX, QY, idx, idx - w + 1, px, py, r2);
        }
      }
      for (let c = w - 2; c >= 0; c--) {
        const idx = base + c;
        if (cov[idx]! === 0 || D[idx]! <= s2) continue;
        relax(D, QX, QY, idx, idx + 1, (c + x0 + 0.5) * sx, py, r2);
      }
    }
    for (let r = h - 1; r >= 0; r--) {
      const py = (r + y0 + 0.5) * sy;
      const base = r * w;
      for (let c = w - 1; c >= 0; c--) {
        const idx = base + c;
        if (cov[idx]! === 0 || D[idx]! <= s2) continue;
        const px = (c + x0 + 0.5) * sx;
        if (c < w - 1) relax(D, QX, QY, idx, idx + 1, px, py, r2);
        if (r < h - 1) {
          if (c < w - 1) relax(D, QX, QY, idx, idx + w + 1, px, py, r2);
          relax(D, QX, QY, idx, idx + w, px, py, r2);
          if (c > 0) relax(D, QX, QY, idx, idx + w - 1, px, py, r2);
        }
      }
      for (let c = 1; c < w; c++) {
        const idx = base + c;
        if (cov[idx]! === 0 || D[idx]! <= s2) continue;
        relax(D, QX, QY, idx, idx - 1, (c + x0 + 0.5) * sx, py, r2);
      }
    }
  }

  // ---- 4. Final coverage ------------------------------------------------------------------------------------
  if (hard) {
    const invPixel = 1 / pixel;
    for (let idx = 0; idx < area; idx++) {
      const d2 = D[idx]!;
      if (d2 === Infinity) continue; // deeper than half a pixel from every edge: 1 inside, 0 outside
      const dist = Math.sqrt(d2);
      const v = 0.5 + (cov[idx]! > 0 ? dist : -dist) * invPixel;
      cov[idx] = v > 0 ? (v < 1 ? v : 1) : 0;
    }
  } else {
    const invFeather = 1 / featherWidth;
    for (let idx = 0; idx < area; idx++) {
      if (cov[idx]! === 0) continue; // outside: 0
      const d2 = D[idx]!;
      if (d2 === Infinity) continue; // beyond the feather band: 1
      const t = Math.sqrt(d2) * invFeather;
      if (t < 1) cov[idx] = t * t * (3 - 2 * t);
    }
  }

  return { x0, y0, x1, y1, cov };
}

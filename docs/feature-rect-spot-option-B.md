# Feature plan: "+ Spot (rectangle)" — Option B (proper rectangle shape)

Status: **not started** (planned 2026-10-21, on top of `main` at `a87a084`, tag `v1.0.1`).
Alternative: [Option A — quick four-corner outline](feature-rect-spot-option-A.md). Pick one; do not build both.
Recommended: **B** (it behaves like the oval spot users already know).

Estimated effort: **about half a day** for one Claude Code session (Opus for the renderer parts),
plus 1–2 hours more if Size change for rectangles (phase B2) is included.

## 1. What the user gets

A new button **+ Spot (rectangle)** in the Regions tab. Tap the picture and a rectangle appears there.
It edits exactly like the oval spot and **stays a rectangle**:

- white dot (middle): move; yellow dots (edge midpoints): width / height; blue dot: rotate
  (snaps like the oval); arrow keys nudge it (Shift = bigger steps);
- soft edge (feather) with rounded, even fading at the corners;
- every effect; **Size change too** if phase B2 is done (otherwise greyed out for rectangles);
- list type "Rectangle", names "Rectangle 1", "Rectangle 2", ...; rename, hide, duplicate, reorder,
  delete, undo/redo, save/load, JSON export/import, image export, timeline all work.

## 2. Project context (read first in a new session)

- Read `CLAUDE.md` (rules, stack, layout), then this file. Live status: `docs/development-coding-progress.md`.
- App: Vision Simulator, a private, phone-first PWA (TypeScript strict, Vite 6, Preact + signals,
  WebGL2, IndexedDB). All processing on device. Node 18 locally.
- Work on `main` (the `develop` branch was retired after v1.0). **Pushing `main` deploys the live
  site** (GitHub Pages): commit locally, push only with Saravana's go-ahead.
- **Shared contracts** `src/model/types.ts` and `src/render/types.ts` change only deliberately, with a
  log entry in `docs/development-coding-progress.md`. This feature changes both (B2) or the first.
- Coordinates in a profile: relative to the fixation point (crosshair), in units of the image's
  **shorter side**; +x right, +y down; rotation in degrees, clockwise on screen. Convert with
  `toPixel` / `fromPixel` / `lengthToPixels` in `src/model/coords.ts`.
- Unit tests next to code (`*.test.ts(x)`, Vitest) for all maths and data-model code. Before
  finishing: `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e` (Playwright, installed Edge).
- Touch targets ≥ 44 px; must work at 360 px width; high contrast.
- The renderer design is described at the top of `src/render/createRenderer.ts`.

## 3. How the oval spot works today (verified against the code)

| Piece | Where | What it does |
| --- | --- | --- |
| Type | `src/model/types.ts` | `EllipseShape { type: 'ellipse'; cx; cy; rx; ry; rotation }`; `Shape = EllipseShape \| PathShape \| MaskShape \| FullShape`; `ShapeType = Shape['type']`. `PROFILE_VERSION = 1`. |
| Default | `src/model/defaults.ts` `defaultEllipse()` | `{ cx: 0, cy: 0, rx: 0.12, ry: 0.09, rotation: 0 }`. |
| Validation | `src/model/validate.ts` `validateShape` | `case 'ellipse'`: required numbers, `rx/ry > 0` else warn + `MIN_SHAPE_SIZE`; rotation optional. Unknown type → **error**, which makes the whole profile fail to load (`ctx.errors` → `{ ok: false }`). |
| Ops | `src/model/ops.ts` `offsetShape` (duplicate offsets the copy), `cloneShape` | Switch on shape type. |
| Coverage (effect maps) | `src/render/shapeCoverage.ts` `ellipseSampler`, `createCoverageSampler` | Returns a map-pixel bounding box, optional `rowSpan`, and `sample(i, j)` → 0..1. Hard edge: signed distance anti-aliased over one map pixel. Feather `f`: full strength inside normalised radius `1 - f`, `smoothstep` to 0 at the edge. Used by `src/render/effectMaps.ts` (also inside the Web Worker `src/render/mapWorker.ts`, same module, no change needed). |
| Size change | `src/render/lenses.ts` `collectLenses` (ellipses only), `warpByLenses` (CPU mirror); shader `applyLenses` / `lensWeight` in `src/render/shaders/effects.ts`; uniforms `uLensA[i] = (cx, cy, 1/rx, 1/ry)`, `uLensB[i] = (cos, sin, amount, feather)` set in `src/render/gl/pipeline.ts` (≈ line 455); max `MAX_SIZE_CHANGE_LENSES = 8`. Tiled export margin: `tileReach` in `src/render/gl/tiles.ts` uses lens radius `max(rx, ry)`. Contract type `SizeChangeLens` in `src/render/types.ts`. |
| Effect availability | `src/ui/panels/effects/effectDefs.ts` `isEffectEnabled` | `sizeChange` only for `'ellipse'`; `SIZE_CHANGE_NOTE` text. |
| Handles maths | `src/ui/edit/geometry.ts` | `ellipseAxes`, `ellipseHandles`, `moveEllipse`, `dragRadius`, `radiusGrabOffset`, `rotationFromPointer`, `snapAngle`, `translateEllipse`, `pointInEllipse`, `hitTestAll` / `hitTest` / `pickTapTarget`. They only read `cx, cy, rx, ry, rotation`. |
| Overlay | `src/ui/edit/RegionOverlay.tsx` | `RegionOutline` (switch per type), `EllipseHandlesView` + `Handle` (aria-labels "Move the ellipse", "Change the ellipse width/height", "Rotate the ellipse" — used by tests and `scripts/help-capture`), drag `begin()` (returns unless `'ellipse'`), keyboard nudge (only `'ellipse'`), `onFixationCapture` and the "Tap where the spot is" banner (only when placing `'ellipse'`). |
| Placing | `src/state/edit.ts` | `PlacingKind = 'ellipse' \| 'path' \| 'brush'`; `placeShapeAt(point)` adds an ellipse "Spot N" at the tap. |
| Panel | `src/ui/panels/regions/Panel.tsx` `addEllipse()`, `RegionsPanel`; `regions.css` `.rg-add` (2-column grid) | Buttons: + Spot (ellipse), + Whole image, Freehand, Brush. |
| Names / labels | `src/ui/panels/regions/helpers.ts` | `BASE_NAMES: Record<ShapeType, string>`, `nextRegionName`, `shapeLabel` (exhaustive switch). |

TypeScript helps: adding `'rect'` to the `Shape` union makes every exhaustive switch without a
default fail to compile (`ops.ts`, `shapeCoverage.ts`, `helpers.ts`, `RegionOverlay.tsx`
`RegionOutline`, `geometry.ts` `hitTestAll`). Run `npm run typecheck` early to get the list.

## 4. Design decisions (defaults; change only with a reason)

1. **Data**: `RectShape { type: 'rect'; cx; cy; rx; ry; rotation }` where `rx` / `ry` are the
   **half-width / half-height** (same field names as the ellipse on purpose, so the handle maths can be
   shared). Document this in the type comment. Default `defaultRect()` = `{ cx: 0, cy: 0, rx: 0.12, ry: 0.09, rotation: 0 }`.
2. **Profile version stays 1** (the change is additive). Consequence: v1.0.x apps refuse a profile
   that contains a rectangle with "unknown shape type "rect"". Profiles without rectangles still open
   everywhere. (Alternative, not chosen: bump `PROFILE_VERSION` to 2, which makes old apps refuse
   *every* new profile with a clearer "made by a newer version" message.) Record the choice in
   `docs/morning-review.md`.
3. **Feather** (matches the oval's "fraction of the size" meaning, gives soft corners without a
   diagonal crease): in the rectangle's own frame (u, v),
   `cov = s(|u| / rx) * s(|v| / ry)` with `s(t) = 1 - smoothstep(1 - f, 1, t)` (1 inside, 0 outside).
   Hard edge (`f ≈ 0`): `cov = clamp01(0.5 + (rx - |u|) / pixel) * clamp01(0.5 + (ry - |v|) / pixel)`
   (one map pixel of anti-aliasing, like the ellipse). `pixel = (g.sx + g.sy) / 2`.
4. **Size change (B2)**: the same lens, but "radius" measured with the box norm
   `r = max(|lx|, |ly|)` instead of `length(local)`; everything else (amount, feather, the
   strongest-lens-wins blending) unchanged. Lens reach for tiling becomes `hypot(rx, ry)`.
5. **UI**: a separate **+ Spot (rectangle)** button right after "+ Spot (ellipse)" (keep that label;
   tests and the Help page use it). Last odd button spans the row:
   `.rg-add .btn:last-child:nth-child(odd) { grid-column: 1 / -1; }`.
   Handle aria-labels for rectangles say "rectangle" ("Move the rectangle", "Change the rectangle
   width/height", "Rotate the rectangle"); ellipse labels stay exactly as they are.

## 5. Implementation steps

### Phase B1 — rectangle without Size change

1. **Contract** `src/model/types.ts`: add `RectShape`, extend `Shape`; add a progress-log entry.
   Update the `sizeChange` comment in `Effects` if B2 is done ("Ellipses and rectangles").
2. **Defaults** `src/model/defaults.ts`: `defaultRect()`.
3. **Validation** `src/model/validate.ts`: `case 'rect'` — copy the ellipse case (rx/ry > 0 else warn
   and `MIN_SHAPE_SIZE`, rotation optional 0); add `rect` to the "expected ..." error text.
   Tests in `validate.test.ts`: valid rect round-trips through `serializeProfile` → `parseProfileJson`;
   bad rx is clamped with a warning; missing cx is an error.
4. **Ops** `src/model/ops.ts`: `offsetShape` and `cloneShape` handle `'rect'` like `'ellipse'`.
   Test in `ops.test.ts` (duplicate offsets a rect).
5. **Coverage** `src/render/shapeCoverage.ts`: `rectSampler` per design 3.
   - Bounding box of the rotated rectangle: half-extents `hx = |rx cos| + |ry sin|`,
     `hy = |rx sin| + |ry cos|` (in px), then `mapBounds`.
   - `rowSpan` is optional (the ellipse has one for speed); a first version may skip it. If added,
     intersect the row with the four edges of the rotated rectangle (convex polygon).
   - `createCoverageSampler`: `case 'rect'`.
   - Tests (new `src/render/shapeCoverage.test.ts` or extend `effectMaps.test.ts`): centre = 1, far
     outside = 0, axis-aligned edge ≈ 0.5 with feather 0, rotated 90° equals swapped rx/ry, feather 1
     falls off monotonically, corners lower than edge midpoints at the same inset.
6. **Handles maths** `src/ui/edit/geometry.ts`: introduce
   `type CentredShape = EllipseShape | RectShape` and make `ellipseHandles`, `moveEllipse`,
   `dragRadius`, `radiusGrabOffset`, `rotationFromPointer`, `translateEllipse` generic
   (`<T extends CentredShape>(shape: T, ...) => T`); keep the old names (or add neutral aliases) so
   callers and tests keep working. Add `pointInRect(shape, p, frame, minHalfPx)` and `case 'rect'` in
   `hitTestAll`. Tests in `geometry.test.ts`: point in a rotated rect, handles at the edge midpoints,
   width/height drags resize about the centre (same behaviour as the oval).
7. **Overlay** `src/ui/edit/RegionOverlay.tsx`:
   - `RegionOutline`: `case 'rect'` → `<rect x={c.x - rxPx} y={c.y - ryPx} width={2 * rxPx} height={2 * ryPx} transform={`rotate(${s.rotation} ${c.x} ${c.y})`} />`.
   - Show the handles view for `'ellipse' | 'rect'` (rename `EllipseHandlesView` → `SpotHandlesView`
     with a `kind` prop for the aria-label wording).
   - `begin()` and the keyboard nudge: accept `'rect'` as well as `'ellipse'`.
   - `onFixationCapture` and the placing banner: also for placing `'rect'` ("Tap where the rectangle is").
8. **Placing** `src/state/edit.ts`: `PlacingKind` adds `'rect'`; `placeShapeAt` builds
   `{ ...defaultRect(), cx, cy }` named via `nextRegionName(profile, 'rect')`.
9. **Panel** `src/ui/panels/regions/Panel.tsx`: `addRectangle()` mirroring `addEllipse()` (with a
   photo → `startPlacing('rect')`; without → add at the fixation point and select); the button and
   CSS from design 5. `helpers.ts`: `BASE_NAMES.rect = 'Rectangle'`, `shapeLabel('rect') = 'Rectangle'`.
   Tests: `RegionsPanel.test.tsx`, `helpers.test.ts`, `src/ui/edit/tools.test.tsx` (place by tap).
10. **Effects panel**: nothing to do for feather (`isFeatherEnabled` already allows it). Without B2,
    `isEffectEnabled('sizeChange', 'rect')` stays false and shows `SIZE_CHANGE_NOTE`
    ("Size change works on spots (ellipses) only.") — fine; reword to "ovals" if you like.

### Phase B2 — Size change for rectangles (optional, renderer work)

11. **Contract** `src/render/types.ts`: `SizeChangeLens` gains `box: boolean` (true = rectangle).
12. `src/render/lenses.ts`: `collectLenses` accepts `'rect'` and sets `box`; `warpByLenses` uses
    `r = l.box ? Math.max(Math.abs(lx), Math.abs(ly)) : Math.hypot(lx, ly)`. Tests in `lenses.test.ts`
    (box lens: corner inside is warped, a point outside the box but inside the circumscribed circle
    is not).
13. Shader `src/render/shaders/effects.ts`: add `uniform float uLensBox[MAX_LENSES];` and in
    `applyLenses` `float r = uLensBox[i] > 0.5 ? max(abs(local.x), abs(local.y)) : length(local);`.
    `src/render/gl/pipeline.ts`: fill and upload the array next to `uLensA` / `uLensB`.
14. `src/render/gl/tiles.ts` `tileReach`: lens radius `l.box ? Math.hypot(l.rx, l.ry) : Math.max(|rx|, |ry|)`
    (otherwise tiled full-resolution export could show seams). Extend `tiles.test.ts`.
15. `effectDefs.ts`: `isEffectEnabled('sizeChange', shape)` true for `'ellipse' | 'rect'`; update
    `SIZE_CHANGE_NOTE`, the `Effects.sizeChange` comment, `MAX_SIZE_CHANGE_LENSES` comment.
16. Check in the browser (`npm run dev`, Regions → + Spot (rectangle), Effects → Size change ±30 %,
    with feather 0 and 50 %), and in `dev/render-harness.html` if useful.

### Phase B3 — docs, Help page, clips

17. `public/help.html` `#spot`: describe + Spot (rectangle) (same handles as the oval); the effects
    table row for Size change ("spots (ovals and rectangles)" if B2); FAQ "Size change is greyed out".
18. `README.md`: "Use it in five steps" step 2 and the effects table note.
19. Clip: add a `02b-rect` test to `scripts/help-capture/capture.spec.ts` (copy `02-spot`, use the
    rectangle handle labels), run `npm run help:capture` (needs ffmpeg; first time also
    `npx playwright install ffmpeg`), look at the frames, embed the GIF in `#spot`.
20. `tests/e2e/smoke.spec.ts`: Regions → + Spot (rectangle) → tap → "Rectangle 1" in the list;
    Effects → Blur up → preview changes (reuse `settledShot` / `pixelDiff`).
21. `docs/development-coding-progress.md` log (mention both contract changes), `docs/morning-review.md`
    (decision 2 and any assumptions), `CLAUDE.md` only if the layout description changes.

## 6. Done when

- [ ] Rectangle can be placed, moved, resized, rotated (with snapping) by touch, mouse and arrow keys.
- [ ] All effects render inside it; soft edge fades evenly with rounded corners; hard edge is anti-aliased.
- [ ] Size change works on it (B2) or is clearly marked unavailable (B1 only).
- [ ] Tiled full-resolution export (Export → Export size → Full resolution) shows no seams with a rotated rectangle.
- [ ] Old profiles load unchanged; new profiles with rectangles round-trip through save, JSON export/import.
- [ ] Layout fine at 360 px and 150 % text; all touch targets ≥ 44 px.
- [ ] Help page, README, clip updated; typecheck, unit tests, build, e2e pass.
- [ ] Committed on `main`. Push, tag (e.g. `v1.1.0`; bump with `npm version 1.1.0 --no-git-tag-version`)
      and, if wanted, `npm run package:iis` only after Saravana's go-ahead.

## 7. Risks

- **Corner feather look**: the product form avoids the crease of a plain box distance; verify by eye
  at feather 30 % and 100 %.
- **Older app versions** cannot open profiles with rectangles (design 2). Tell the user in the release note.
- **Shader uniforms**: +8 floats is far within limits; the renderer already uses 12 texture units.
- **Phone performance**: `rectSampler` without `rowSpan` scans its bounding box; at the 512 px preview
  maps (1024 px for export) this is cheap, but check ⋯ → Performance with several large rotated rectangles.

## 8. Prompt to start a new session

> Read CLAUDE.md and docs/feature-rect-spot-option-B.md, then implement Option B phases B1 and B3
> (and B2 if time allows) exactly as planned. Work on main, keep the shared-contract rule (log entry
> for types.ts / render/types.ts changes), commit when typecheck, unit tests, build and e2e pass, and
> do not push until I say so.

# Feature plan: "+ Spot (rectangle)" — Option A (quick: four-corner outline)

Status: **not started** (planned 2026-10-21, on top of `main` at `a87a084`, tag `v1.0.1`).
Alternative: [Option B — proper rectangle shape](feature-rect-spot-option-B.md). Pick one; do not build both.

Estimated effort: **1–2 hours** for one Claude Code session (Sonnet is enough).

## 1. What the user gets

A new button **+ Spot (rectangle)** in the Regions tab. With a photo open, the user taps the picture
and a rectangle-shaped region appears there, the same default size as an oval spot. It is stored as
an ordinary **freehand outline** (`PathShape`) with four corners, so everything that works for
Freehand works for it with no new rendering code:

- soft edge (feather), every effect **except Size change**;
- drag inside it to move it; drag a corner dot to reshape it;
- **Redraw outline**, rename, hide, duplicate, reorder, delete, undo/redo;
- saved, exported and imported like any profile.

Known limits (state them in the Help page):

- dragging one corner turns it into any four-sided shape; it does **not stay a rectangle**;
- no rotate handle and no width/height handles;
- **Size change** is greyed out (it works on ovals only, see `isEffectEnabled`);
- in the region list it shows as "Freehand" type (named "Rectangle 1", "Rectangle 2", ...).

No data-model change: profiles stay fully compatible with v1.0.x (older versions open them too).

## 2. Project context (read first in a new session)

- Read `CLAUDE.md` (rules, stack, layout), then this file. Live status: `docs/development-coding-progress.md`.
- App: Vision Simulator, a private, phone-first PWA (TypeScript strict, Vite 6, Preact + signals,
  WebGL2). All processing on device. Node 18 locally.
- Work on `main` (the `develop` branch was retired after v1.0). **Pushing `main` deploys the live
  site** (GitHub Pages): commit locally, push only with Saravana's go-ahead.
- Coordinates in a profile are relative to the fixation point (the crosshair), in units of the
  image's **shorter side**; +x right, +y down. Convert with `fromPixel` / `toPixel` in
  `src/model/coords.ts`.
- Unit tests sit next to the code (`*.test.ts(x)`, Vitest). Before finishing:
  `npm run typecheck`, `npm test`, `npm run build`, and `npm run e2e` (Playwright, uses installed Edge).
- Touch targets ≥ 44 px; must work at 360 px width; high contrast.

## 3. How the existing pieces work (verified against the code)

| Piece | Where | Notes |
| --- | --- | --- |
| Shape types | `src/model/types.ts` | `EllipseShape {cx, cy, rx, ry, rotation}`, `PathShape {points: [x, y][]}`, `MaskShape`, `FullShape`. **Not changed in Option A.** |
| Default oval | `src/model/defaults.ts` → `defaultEllipse()` | `rx: 0.12, ry: 0.09` (shorter-side units). |
| Placing tool state | `src/state/edit.ts` | `PlacingKind = 'ellipse' \| 'path' \| 'brush'`; `startPlacing(kind)`; `placeShapeAt(point)` adds the region on tap (only handles `'ellipse'` today; names it `Spot N`). |
| Tap handling while placing | `src/ui/edit/RegionOverlay.tsx` | `handleTap` calls `placeShapeAt(p)` whenever `placingShape` is set. `onFixationCapture` (≈ line 203) only steals taps on the crosshair when placing `'ellipse'`. The "Tap where the spot is" banner shows only for `placing === 'ellipse'` (≈ line 325). |
| Regions panel buttons | `src/ui/panels/regions/Panel.tsx` (`RegionsPanel`, `addEllipse()`) | 2-column grid `.rg-add` in `regions.css`: + Spot (ellipse), + Whole image, Freehand, Brush. Without a photo, `addEllipse` drops the spot on the fixation point. |
| Region names | `src/ui/panels/regions/helpers.ts` | `nextRegionName(profile, type)` with `BASE_NAMES` per `ShapeType` (`path` → "Area"). `shapeLabel(type)` gives the list label ("Freehand" for path). |
| Path coverage (rendering) | `src/render/shapeCoverage.ts` `pathSampler` + `src/render/pathCoverage.ts` | Polygon scanline fill; feather width = `feather × 0.5 × min(bbox width, bbox height)`, fading inward from the edge. Sharp corners stay sharp. |
| Path editing | `src/ui/edit/freehand/PathEditor.tsx`, `pathGeometry.ts`, `PathToolbar.tsx` | A handle per vertex for small outlines (`handleIndices`), drag body to move, "Redraw outline" button. |
| Size change | `src/render/lenses.ts` `collectLenses` and `src/ui/panels/effects/effectDefs.ts` `isEffectEnabled` | Ellipses only. |
| Validation | `src/model/validate.ts` `validateShape` | A path needs ≥ 3 points (`MIN_PATH_POINTS`). Four corners pass. |

## 4. Implementation steps

1. **Corner helper** — `src/model/defaults.ts`:
   ```ts
   /** Default rectangle spot size: same half-extents as defaultEllipse() (rx 0.12, ry 0.09). */
   export const DEFAULT_RECT_HALF: Readonly<Vec2> = { x: 0.12, y: 0.09 };
   /** Four corners (clockwise from top-left) of an axis-aligned rectangle centred on (cx, cy). */
   export function rectanglePath(cx: number, cy: number, half: Vec2 = DEFAULT_RECT_HALF): PathShape {
     return { type: 'path', points: [
       [cx - half.x, cy - half.y], [cx + half.x, cy - half.y],
       [cx + half.x, cy + half.y], [cx - half.x, cy + half.y],
     ] };
   }
   ```
   Test in `src/model/defaults.test.ts` (create it if missing): 4 points, centred, passes `validateProfile`.

2. **Placing kind** — `src/state/edit.ts`:
   - `PlacingKind = 'ellipse' | 'rect' | 'path' | 'brush'`; update the doc comment.
   - `placeShapeAt`: accept `'rect'` too. For `'rect'` build `rectanglePath(u.x, u.y)` and name it with
     a new helper (step 4) → "Rectangle N". Keep the ellipse branch as is.

3. **Overlay** — `src/ui/edit/RegionOverlay.tsx`:
   - `onFixationCapture`: steal the crosshair tap for `'ellipse'` **and** `'rect'`.
   - Banner: show it for `placing === 'ellipse' || placing === 'rect'`; text for rect
     "Tap where the rectangle is" (ellipse text unchanged).
   - Check `onDown` (`tool === 'path' || tool === 'brush'` early return) — `'rect'` must fall through
     like `'ellipse'` so the tap is detected.

4. **Names** — `src/ui/panels/regions/helpers.ts`: add `nextNamedRegion(profile, base: string)` (same
   loop as `nextRegionName`) or an optional `base` argument; use base `"Rectangle"`. Unit-test it in
   `helpers.test.ts`.

5. **Button** — `src/ui/panels/regions/Panel.tsx`:
   - Add `addRectangle()` mirroring `addEllipse()`: with a photo → `startPlacing('rect')`; without →
     add `rectanglePath(0, 0)` at the fixation point and select it.
   - Button text **"+ Spot (rectangle)"**, placed right after "+ Spot (ellipse)". Keep the existing
     "+ Spot (ellipse)" label: tests and the Help page use it.
   - Five buttons in a 2-column grid leave one alone on the last row: in `regions.css` add
     `.rg-add .btn:last-child:nth-child(odd) { grid-column: 1 / -1; }` (Brush spans the row).
   - Check the layout at 360 px width and at 150 % text (⋯ menu → A+).

6. **Tests**
   - `src/ui/panels/regions/RegionsPanel.test.tsx`: the new button exists; without an image it adds a
     4-point path named "Rectangle 1" and selects it.
   - `src/ui/edit/tools.test.tsx` ("regions panel tools"): with an image, `startPlacing('rect')` + tap →
     region added at the tap point, placing mode cleared.
   - `tests/e2e/smoke.spec.ts`: optional short test — Regions → + Spot (rectangle) → tap → list shows
     "Rectangle 1"; Effects → Blur up → preview changes (reuse `settledShot` / `pixelDiff`).

7. **Help page and README** (keep them in step with the UI — rule in `CLAUDE.md`)
   - `public/help.html`, section `#spot` ("2. Mark the affected area with a spot"): add a short
     paragraph or step for **+ Spot (rectangle)** with the limits from section 1; mention in the
     Freehand section that a rectangle is edited like an outline. Update the quick start if useful.
   - `README.md`: "Use it in five steps" step 2 — mention the rectangle spot.
   - Optional clip: copy the `02-spot` test in `scripts/help-capture/capture.spec.ts` to a
     `02b-rect` clip, run `npm run help:capture` (needs ffmpeg; first time also
     `npx playwright install ffmpeg`), check the GIF frames, embed it in `#spot`.

8. **Docs**: add a log line at the top of `docs/development-coding-progress.md`; note any assumption in
   `docs/morning-review.md`.

## 5. Done when

- [ ] + Spot (rectangle) adds a rectangle where you tap (and on the crosshair without a photo).
- [ ] Effects, soft edge, move, corner drag, redraw, undo/redo, save/load, export all work on it.
- [ ] Size change is shown as unavailable for it, with the existing note.
- [ ] Layout fine at 360 px and 150 % text; buttons ≥ 44 px.
- [ ] Help page + README updated; typecheck, unit tests, build, e2e pass.
- [ ] Committed on `main`; pushed and tagged (e.g. `v1.1.0`, bump `package.json` with
      `npm version 1.1.0 --no-git-tag-version`) only after Saravana's go-ahead.

## 6. Risks and open questions

- **Users may expect it to stay rectangular.** If that matters, choose Option B instead.
- Region list shows type "Freehand" for rectangles. Acceptable for A; changing it would need a marker
  in the data (that is Option B territory).
- Upgrading later to Option B is still possible: old A-rectangles simply remain freehand outlines.

## 7. Prompt to start a new session

> Read CLAUDE.md and docs/feature-rect-spot-option-A.md, then implement Option A exactly as planned
> (+ Spot (rectangle) as a four-corner freehand outline). Work on main, commit when typecheck, unit
> tests, build and e2e pass, update the Help page and README, and do not push until I say so.

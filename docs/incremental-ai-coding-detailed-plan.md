# Vision Simulator — Incremental AI Coding Plan (detailed)

Source of truth for *what* to build: [Vision-Simulator-Plan.md](Vision-Simulator-Plan.md) (F1–F9, NFRs, design).
This file says *how* it is built by Claude: in waves of parallel tasks, each owned by one agent with a fixed set of files.
Live status lives in [development-coding-progress.md](development-coding-progress.md); how to pick up mid-way is in [handoff.md](handoff.md).
Decisions and questions for Saravana are in [morning-review.md](morning-review.md).

## Stack (option 3: static web app / PWA)

| Layer | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript (strict) | |
| Build | Vite 6 | Vite 7 needs Node 20; this machine has Node 18.20 |
| UI | Preact 10 + @preact/signals | |
| Rendering | WebGL2 fragment shaders | 3 passes: distort → variable blur → tone/spots |
| Effect maps | Pure TypeScript rasteriser into RGBA8 arrays (≤ 512 px), uploaded as textures | Testable in Node; smooth maps are upscaled linearly by the GPU |
| Storage | IndexedDB via `idb` | `fake-indexeddb` in tests |
| Offline | `vite-plugin-pwa` | Enabled in wave 4 |
| Tests | Vitest (unit), Playwright (smoke) | |
| Hosting | GitHub Pages via GitHub Actions | Workflow written; push and Pages setting are Saravana's call |

Runs on: Android Chrome (primary), desktop Chrome/Edge (install as app), iOS Safari (best effort).

## Shared contracts (written by the orchestrator, change only via orchestrator)

- `src/model/types.ts` — Profile, Region, Shape, Effects, ProfileGlobals, ImageFrame, effect-map channel layout, constants.
- `src/model/coords.ts` — fixation-relative ↔ pixel conversion.
- `src/model/defaults.ts` — `newProfile`, `newRegion`, `emptyEffects`, `defaultGlobals`, `defaultEllipse`, `newId`.
- `src/render/types.ts` — `EffectMaps`, `SizeChangeLens`, `RenderParams`, `Renderer`.

## Working rules for every agent

1. Touch only the files your task owns (listed below). Never edit `package.json`/lockfile, shared contracts, or docs — if you need a change, say so in your report.
2. Unit tests for all maths and data code, next to the code as `*.test.ts`.
3. `npm run typecheck` and `npm test` must pass before you finish; `npm run build` too for UI tasks.
4. Never ask questions; choose, and list assumptions/questions in your final report (the orchestrator copies them to morning-review.md).
5. In a worktree: run `npm ci` first, commit your work to your branch with a clear message. In the main checkout: do not commit.
6. Final report: files changed, what works, what is stubbed, test/build results, assumptions, questions.

## Model tiers

| Tier | Use for |
| --- | --- |
| Opus | WebGL pipeline and shaders, integration of modules, tricky interaction, final review |
| Sonnet | Normal feature modules (model, effect maps, UI panels, storage, export, compare) |
| Haiku | Mechanical work: procedural test images, copy, config, simple tests |

## Waves

Concurrency cap: **7 agents at once**. A wave starts when everything it depends on is merged into `develop`.

### Wave 0 — Scaffold (sequential) → Phase 0

| ID | Task | Tier | Owns | Done when |
| --- | --- | --- | --- | --- |
| W0-1 | Contracts + docs + CLAUDE.md | Orchestrator | `src/model/{types,coords,defaults}.ts`, `src/render/types.ts`, `docs/*`, `CLAUDE.md` | Committed |
| W0-2 | Vite/TS/Preact/Vitest scaffold, photo load + fit, CI + Pages workflows | Sonnet | everything else at root, `src/main.tsx`, `src/ui/App.tsx`, `src/image/*` | typecheck, test, build pass; photo shows fitted at 360 px |

### Wave 1 — Independent modules (7 in parallel, each in its own worktree)

| ID | Task | Tier | Owns | Depends on | Done when |
| --- | --- | --- | --- | --- | --- |
| W1-A | Model: validation/migration, profile + region ops, undo/redo history (≥ 50 steps, slider-drag coalescing) | Sonnet | `src/model/validate.ts`, `ops.ts`, `history.ts` (+tests) | W0 | Tests cover valid/invalid JSON, every op, undo limits |
| W1-B | Effect-map builder: ellipse/path/full rasterise with feather, max-combine into maps A/B, lens extraction for size change, mask stub | Sonnet | `src/render/effectMaps.ts`, `lenses.ts` (+tests) | W0 | Tests: feather profile, rotation, overlaps take max, hidden regions ignored |
| W1-C | WebGL2 renderer: blur pyramid (2–32 px), distortion, variable blur + fill-in, tone/spots, size-change lenses, full-size export with texture-limit tiling or downscale, dev harness page | Opus | `src/render/gl/**`, `src/render/shaders/**`, `src/render/createRenderer.ts`, `dev/render-harness.html`, `dev/render-harness.ts` | W0 | Harness shows every effect; pure helpers tested |
| W1-D | Procedural test images: Amsler grid, reading text sizes, face, street scene, high-contrast pattern (SVG strings + rasterise helper) | Haiku | `src/assets/**` | W0 | Tests check each image renders valid SVG of expected size |
| W1-E | Export composer: side-by-side (horizontal/vertical), burned caption with approximation note, PNG/JPEG blob, Web Share with download fallback, file names | Sonnet | `src/export/**` | W0 | Caption/name/layout maths tested |
| W1-F | UI shell: signals store, top bar (profile name, undo, redo, flip), canvas viewport with pinch-zoom/pan, draggable fixation crosshair, bottom sheet (phone) / right sidebar (≥ 900 px) with 4 tabs, UI text-size setting | Sonnet | `src/state/**`, `src/ui/**` (except `src/ui/calibration/**`), `src/main.tsx`, `src/ui/App.tsx` | W0 | Builds; viewport maths tested; works at 360 px |
| W1-G | Calibration guide component (prop-driven step flow: distance, cover left eye, stare, note, swap eyes, adjust, flip) | Sonnet | `src/ui/calibration/**` | W0 | Component renders all steps; step logic tested |

### Wave 2 — Integration → Phases 1, 2, 3 (first useful version)

| ID | Task | Tier | Owns | Depends on |
| --- | --- | --- | --- | --- |
| W2-1 | Integration: store → effect maps → renderer → viewport; live preview < 50 ms; flip; export button (PNG) | Opus | `src/ui/App.tsx`, `src/ui/preview/**`, `src/state/render.ts` | W1-A,B,C,F |
| W2-2 | Ellipse editing: tap to place, move, resize, rotate handles, hit-testing (maths tested) | Sonnet | `src/ui/edit/**` | W1-F |
| W2-3 | Panels: Regions list (add ellipse/full, select, duplicate, hide, reorder, delete) and Effects sliders + profile globals (wave, angle, ghost, shade) wired to history | Sonnet | `src/ui/panels/regions/**`, `src/ui/panels/effects/**` | W1-A,F |
| W2-4 | Storage: profiles + optional photos in IndexedDB, JSON import/export with validation | Sonnet | `src/storage/**` | W1-A |

### Wave 3 — Phases 4, 5, 6

| ID | Task | Tier | Owns | Depends on |
| --- | --- | --- | --- | --- |
| W3-1 | Compare: before/after wipe, side-by-side (stacked on phone), full-screen presentation, test-image picker, calibration hook-up | Sonnet | `src/ui/panels/compare/**`, `src/ui/present/**` | W2-1 |
| W3-2 | Profiles UI: save, rename, duplicate dated check-up, list, timeline of dated profiles on one test image | Sonnet | `src/ui/panels/profiles/**` | W2-4, W2-1 |
| W3-3 | Export panel: PNG/JPEG, caption fields, side-by-side export, share sheet | Sonnet | `src/ui/panels/export/**` | W1-E, W2-1 |
| W3-4 | Freehand outline + brush mask (paint/erase), mask rasterisation in effect maps | Sonnet | `src/ui/edit/freehand/**`, `src/ui/edit/brush/**`, `src/render/maskRaster.ts` | W2-2 |

### Wave 4 — Phase 7 and verification

| ID | Task | Tier | Owns |
| --- | --- | --- | --- |
| W4-1 | PWA: manifest, icons, offline service worker, install prompt | Haiku/Sonnet | `vite.config.ts` PWA block, `public/**` |
| W4-2 | Accessibility + one-handed use pass, approximation note everywhere | Sonnet | UI files, after W3 merges |
| W4-3 | Playwright smoke test (load app, load test image, add ellipse, blur, export) | Sonnet | `e2e/**`, `playwright.config.ts` |
| W4-4 | Final review: performance against 50 ms, code review, docs refresh | Opus | review notes |

## Merge procedure (orchestrator)

1. Each wave-1+ agent works in an isolated git worktree on its own branch and commits there.
2. When an agent finishes, merge its branch into `develop` (`git merge --no-ff <branch>`), run `npm ci` if the lockfile changed, `npm run typecheck && npm test && npm run build`.
3. On conflict or red build: fix in `develop` directly (small) or send it back to the agent / a fix-up agent.
4. Update the progress file, commit, refresh the heartbeat in handoff.md.

## Phase mapping to the original plan

| Original phase | Waves |
| --- | --- |
| 0 Scaffold and deploy | W0 (deploy itself is a morning decision) |
| 1 Rendering core | W1-C + W2-1 |
| 2 Ellipse regions (first useful version) | W1-A, W1-B, W1-F, W2-1, W2-2, W2-3 |
| 3 All effects and undo | W1-C, W1-A, W2-3 |
| 4 Calibrate, compare, present | W1-D, W1-G, W3-1 |
| 5 Profiles and history | W2-4, W3-2, W3-3, W1-E |
| 6 Freehand and brush | W3-4 |
| 7 Offline and polish | W4 |

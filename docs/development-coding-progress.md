# Development and Coding Progress

Plan: [incremental-ai-coding-detailed-plan.md](incremental-ai-coding-detailed-plan.md) · Resume guide: [handoff.md](handoff.md) · Questions: [morning-review.md](morning-review.md)

**Overall: BUILD COMPLETE (2026-10-21 07:07 IST).** All tasks merged into `develop`; 592 unit tests and 8 Playwright smoke tests pass; production build green. Remaining work is Saravana's: deploy, test on the phone, answer docs/morning-review.md.

Status values: `todo` · `running` · `done` (merged into `develop`) · `blocked` · `review` (merged, needs Saravana's check on a device)

## Task status

| ID | Task | Tier | Status | Branch / notes |
| --- | --- | --- | --- | --- |
| W0-1 | Contracts, docs, CLAUDE.md | Orchestrator | done | develop a88a281 |
| W0-2 | Scaffold + photo load | Sonnet | done | develop a88a281 |
| W1-A | Model ops, validation, undo | Sonnet | done | merged 6496be0 |
| W1-B | Effect-map builder | Sonnet | done | merged 232dfd5 (~17 ms for 8 ellipses at 512 px on this PC) |
| W1-C | WebGL2 renderer | Opus | done | merged 2eba328; verified in desktop browser harness; 2–4 ms at 1024 px on a desktop GPU |
| W1-D | Test images | Haiku | done | merged 605d20a |
| W1-E | Export composer | Sonnet | done | merged 536ddd9 |
| W1-F | UI shell | Sonnet | done | merged 4aa6087 (UI not yet seen in a browser) |
| W1-G | Calibration guide | Sonnet | done | merged b5106f7 (not yet wired into App) |
| W2-1 | Integration, live preview | Opus | done | merged a41a954; verified in browser (desktop + mobile width): live preview, flip, undo/redo, export, context loss |
| W2-2 | Ellipse editing | Sonnet | done | merged d8919ad; tap-to-place wired in 0822672 |
| W2-3 | Regions + Effects panels | Sonnet | done | merged (placement-mode TODO for W2-2 hook-up) |
| W2-4 | Storage | Sonnet | done | merged |
| W3-1 | Compare + present + app wiring (Profiles tab, timeline, install prompt) | Sonnet | done | merged f2302c5; verified in browser (wipe, side by side, present, profiles, timeline, 360 px) |
| W3-2 | Profiles + timeline | Sonnet | done | merged; mounted by W3-1 |
| W3-3 | Export panel | Sonnet | done | merged; share sheet untested on a phone |
| W3-4 | Freehand + brush | Sonnet | done | merged 8062c06; touch untested on a real phone |
| W3-6 | Effect-map Web Worker (phone performance) | Sonnet | done | merged; worker path not yet run in a browser |
| W4-1 | PWA offline | Sonnet | done | merged; InstallPrompt mounted by W3-1 |
| W4-2 | Accessibility + UX pass (incl. two-step share, wipe knob, compare auto-switch; review M1, L2, L7) | Sonnet | done | merged 3df1563; checked in browser at 375 px and desktop, 100 % and 150 % text |
| W4-3 | Playwright smoke (Edge locally, chromium in CI) | Sonnet | done | merged 07198be; 3/3 pass on desktop + mobile projects (swiftshader WebGL) |
| W4-4 | Opus code review → docs/code-review-findings.md | Opus | done | merged ec94301: 0 critical, 3 high, 5 medium, 11 low |
| W5-1 | Review H2: fast freehand coverage | Sonnet | done | merged; 200-pt outline ~1 s → 24–28 ms (feather 0.3), 6–9 ms (no feather) |
| W5-2 | Review H1, H3, M5, L4, L8–L11: render fixes | Opus | done | merged fc14d17; verified in browser; preview sized to screen (cap 2048), 0.6–2.2 ms/frame on desktop GPU |
| W5-3 | Review M2–M4, L1, L3, L5, L6: state/storage/export fixes | Sonnet | done | merged d7a78ca; L3 simulated-only wiring moved to W5-4 |
| W5-4 | Update e2e for new UI; L3 wiring in export run; storage-persistence hint | Sonnet | done | merged; e2e 8/8 (desktop 4, mobile 4) |

## Original-plan phases

| Phase | Status |
| --- | --- |
| 0 Scaffold and deploy | done locally; deploy is Saravana's step (push + enable Pages) |
| 1 Rendering core | done (needs phone check) |
| 2 Ellipse regions | done (needs phone check) — first useful version |
| 3 All effects and undo | done (needs phone check) |
| 4 Calibrate, compare, present | done (needs phone check) |
| 5 Profiles and history | done (needs phone check) |
| 6 Freehand and brush | done (needs phone check) |
| 7 Offline and polish | done (needs phone check) |

## Log (newest first)

- 2026-10-21 IST — IIS packaging: `deploy/iis/` (web.config, install-iis.ps1, README.txt) and `scripts/package-iis.ps1` (`npm run package:iis`) → `release/VisionSimulator-iis-<version>.zip`. Packaging checked in Windows PowerShell 5.1 and PowerShell 7; install-iis.ps1 not yet run against IIS (needs an elevated session). Tag `v1.0.1` moved to this commit.

- 2026-10-21 IST — `develop` (identical to `main` at v1.0) deleted locally and on GitHub; work continues on `main`. CLAUDE.md and handoff updated. Added `.claude/launch.json` (dev-server preview config). Tagged `v1.0.1`.

- 2026-10-22 night — **Rectangle spot (Option B), branch `feature/rect-spot`** (not merged). Contract changes: `RectShape { type: 'rect'; cx; cy; rx; ry; rotation }` added to `Shape` in src/model/types.ts (rx/ry = half-width/half-height, named like the ellipse's radii so the handle maths is shared); `SizeChangeLens.box: boolean` in src/render/types.ts (rectangle lenses use the box norm max(|u|,|v|) in CPU warp, shader `uLensBox[]`, `lensRadius`; tile reach uses the half-diagonal). PROFILE_VERSION stays 1 (additive; v1.0.x apps refuse profiles containing a rectangle). Coverage: product of two per-axis smoothstep fades (rounded soft corners), one-pixel AA per axis for hard edges, convex row spans. Decisions: docs/rect-spot-review.md; progress: docs/feature-rect-spot-handoff.md.

- 2026-10-21 IST — **v1.0.** Resumed after the session limit: finished and merged the two open v0.2 worktrees — Eye choice (Left/Right radio group, defaultEye setting, automatic name follows the eye) and D05 + Q5 + Blur100 (MAX_BLUR_PX 40 → 100, pyramid levels 70/100, tiled export shares coarse levels; `src/model/types.ts` contract change). Added the Help page (`public/help.html`, ⋯ menu → Help and how-to, start-screen link; help media not precached), GIFs/screenshots recorded from the built app by `scripts/help-capture` (`npm run help:capture`), and an illustrated README. package.json version 1.0.0. Checks: typecheck, unit tests, build, Playwright e2e. Merged to `main`, tagged `v1.0`.

- 2026-10-21 v0.2 Blur100 — Contract change: `MAX_BLUR_PX` 40 → 100 in src/model/types.ts (blur is stored in px, so existing profiles look the same; effect map A.r = blur / 100, so one 8-bit step is now 0.39 px instead of 0.16 px). Pyramid levels 0, 2.5, 5, 10, 20, 40, 70, 100 reference px (neighbours at most 2x apart; 8 level samplers + 4 = 12 texture units, WebGL2 guarantees 16). Missing-area fill still falls back to the 40 px level (`FILL_TOP_LEVEL`), contrast mean stays at 20 px. Tiled export: the fill and the coarse blur levels (those whose full-size downscale factor x copy scale >= 1, `sharedLevelsFrom`) are built once from a whole-image copy of at most one tile (replaces the 1536 px fill copy) and read by every tile in whole-image coordinates (`uSharedFrom`); tiles build only the finer levels, so the margin and alignment cover only those (`tileReach(..., localLevels)`, `pyramidAlign(w, h, levels)`). Tests check per-tile seams, the 100 px level, and that shared levels are as close to an exact Gaussian as full-size ones.

- 2026-10-21 v0.2 Q5 — Export size option ("Up to 4096 px" default / "Full resolution"). Full resolution renders in tiles of at most min(GPU limit, 4096) px (src/render/gl/tiles.ts): each tile's margin covers lenses + distortion + ghost + 3 sigma of the widest blur level read over its own core; tiles align to the pyramid's largest downscale factor; the missing-area fill is built once from a 1536 px copy. Falls back to the downscaled export (with a notice) when the full-size canvas cannot be allocated. Contract: `Renderer` unchanged; `WebGLRenderer` gains options/`exportFullSizeWith`, `ExportInfo.tiles/fallback`.

- 2026-10-21 v0.2 D05 — Contract change: `Region.darkSpotShade` (0 black .. 1 mid grey) added in src/model/types.ts; `ProfileGlobals.darkSpotShade` kept but deprecated (fallback for older profiles, read by v0.1). `EffectMaps.c` added in src/render/types.ts: C.r = shade of the strongest dark spot (ties darker, 1-texel dilation), other channels reserved. No PROFILE_VERSION bump (additive field with a fallback).

- 2026-10-21 07:07 IST — Merged W5-4. Final checks on develop: typecheck, 592 unit tests, build, Playwright 8/8 (Edge, desktop + mobile). README.md written, CLAUDE.md refreshed. BUILD_STATUS set to COMPLETE; auto-resume cron and scheduled task switched off.

- 2026-10-21 06:56 IST — Merged W5-1 (freehand ~40× faster) and W5-2 (render fixes). 587 tests, build green. Only W5-4 (e2e update) remains.

- 2026-10-21 06:40 IST — Merged W4-2 (a11y/UX) and W5-3 (state/storage fixes). 565 tests, build green. Launched W5-4 (e2e update for the two-step share + small wiring). W5-1 and W5-2 still running.

- 2026-10-21 06:28 IST — Second usage limit ~02:30 to 06:20 stopped W4-2, W5-1, W5-2, W5-3; all resumed at 06:28. Playwright e2e on develop (07198be, with InstallPrompt mounted): 6/6 pass in 2.8 min.

- 2026-10-21 02:23 IST — Merged W4-4 review findings and W4-3 e2e tests. Fix wave launched: W5-1 (H2), W5-2 (Opus: H1, H3, M5, L4, L8–L11), W5-3 (M2–M4, L1, L3, L5, L6). W4-2 (still running) also took M1, L2, L7.

- 2026-10-21 02:01 IST — Merged W3-4 (freehand/brush), W3-6 (map worker), W3-3 (export panel), W3-1 (compare/present/wiring). 513 tests, build green. All original phases 0–6 are implemented. Launched W4-2 (a11y/UX), W4-4 (Opus review); W4-3 (e2e) running since 01:55.

- 2026-10-21 01:45 IST — Merged W4-1 (PWA), W3-2 (profiles UI), W2-1 (integration). 399 tests, build green. Added renderTick signal (354a8b6). Launched W3-1 (compare/present/wiring), W3-3 (export panel), W3-6 (map Web Worker). W3-4 told to fix crosshair-tap-while-placing.

- 2026-10-21 01:28 IST — Usage limit hit at ~22:57 (reset 01:20); all running agents stopped. Resumed W2-1, W3-2, W4-1 in their worktrees; W3-4 had no saved work and was restarted. Lesson: agents should commit early and often.
- 2026-10-20 22:55 IST — Merged W2-3 (panels), W1-C (renderer), W2-2 (ellipse editing); 344 tests pass, build green. Orchestrator: regions panel now uses tap-to-place; default distortion amplitude lowered 0.02 → 0.008; added shared src/state/masks.ts. Launched W2-1 integration (Opus) and W3-4 freehand/brush.

- 2026-10-20 22:20 IST — Merged W1-A, W1-B, W1-D, W1-E, W1-F, W1-G into develop: typecheck + build green, 230 tests pass. Re-ran `npm ci` in the main checkout (two agents' early `npm ci` ran there and damaged node_modules). Launched W2-2, W2-3, W2-4. W1-C (renderer) still running.

- 2026-10-20 21:50 IST — Scaffold verified (typecheck, 7 tests, build) and committed a88a281. Wave 1 launched: W1-A..W1-G, each in its own git worktree (.claude/worktrees). W1-C uses the built-in browser for its harness.

- 2026-10-20 21:40 IST — Branch `develop` created from `main`. Contracts written (`src/model/types.ts`, `coords.ts`, `defaults.ts`, `src/render/types.ts`). Scaffold agent (W0-2) started.

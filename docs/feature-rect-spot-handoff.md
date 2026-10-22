# Handoff — rectangle spot (Option B) build

HEARTBEAT: 2026-10-22T22:50
STATUS: IN PROGRESS

Plan: [feature-rect-spot-option-B.md](feature-rect-spot-option-B.md). Decisions for Saravana: [rect-spot-review.md](rect-spot-review.md).

## Resume here (new session after an interruption)

1. Read `CLAUDE.md`, the plan above, then this file. Work on branch **`feature/rect-spot`** (`git checkout feature/rect-spot`).
   Do not push; do not merge to `main` (Saravana reviews first).
2. `git log --oneline main..feature/rect-spot` and `git status` show what is committed / in progress.
3. For each work package below not marked `done`: check its files with `git diff` / `git status`. If the
   files are partly changed, finish them (do not start over); if untouched, start the package (agent
   or yourself). Agents run in this same checkout on **disjoint files**; never run `npm ci` / `npm install`.
4. Update this file (table + log + HEARTBEAT) after every step, and commit with it.

## Work packages

| ID | What | Files (owner only these) | Tier | Status |
| --- | --- | --- | --- | --- |
| P1 | Model: `RectShape`, `defaultRect`, validation, ops, `helpers.ts` names; `rectSampler` coverage + tests | src/model/{types,defaults,validate,ops}.ts, src/render/shapeCoverage.ts(+test), src/ui/panels/regions/helpers.ts | orchestrator | done (f617549) |
| P1t | Unit tests for validate/ops/helpers rect cases | src/model/validate.test.ts, src/model/ops.test.ts, src/ui/panels/regions/helpers.test.ts | orchestrator | done (9df83c9) |
| P2 | B2 Size change for rectangles (box lens) | src/render/types.ts, src/render/lenses.ts(+test), src/render/shaders/effects.ts, src/render/gl/pipeline.ts, src/render/gl/tiles.ts(+test), src/ui/panels/effects/effectDefs.ts(+test) | Opus agent | done (shader not yet compiled in a browser: P5) |
| P3 | UI: handles maths, overlay, placing, panel button + CSS | src/ui/edit/geometry.ts(+test), src/ui/edit/RegionOverlay.tsx, src/state/edit.ts, src/ui/panels/regions/Panel.tsx, src/ui/panels/regions/regions.css, src/ui/panels/regions/RegionsPanel.test.tsx, src/ui/edit/tools.test.tsx | Opus agent | done (0b40ebb) |
| P4 | Docs/Help/e2e text: help.html `#spot` + effects table + FAQ, README, e2e smoke test, help-capture `02b-rect` test | public/help.html, README.md, tests/e2e/smoke.spec.ts, scripts/help-capture/capture.spec.ts | Sonnet agent | done (text; clip + e2e run pending in P5) |
| P6 | Code review of committed P1+P2 (main..HEAD, src/model, src/render, effectDefs) — report only | none (read-only) | Sonnet agent | running (23:15) |
| P7 | Audit: other `'ellipse'` special cases outside P3's files — report only | none (read-only) | Sonnet agent | done: no live code gaps; follow-ups → P10 |
| P8 | Perf check: map build time for several large rotated rects vs ellipses (scratch script, not committed) | scratchpad only | Sonnet agent | done: rect within ~1.0–1.7x of ellipse (noisy, rect covers 4/π more area); interior early-out applied |
| P9 | Release-notes draft v1.1.0 | docs/release-notes-v1.1.0.md | Sonnet agent | done (draft) |
| P10 | Audit follow-ups: EffectsPanel test title, effectMaps rect tests, storage round-trip, preview lens test, CLAUDE.md/plan/roadmap/handoff wording | those test files + CLAUDE.md, docs/Vision-Simulator-Plan.md, docs/roadmap.md, docs/handoff.md | Sonnet agent | running (23:40) |
| P5 | Integrate: typecheck, all unit tests, build, e2e, browser check, help:capture (if ffmpeg), progress log, morning-review, commit | docs/*, CLAUDE.md | orchestrator | pending |

## Log

- 2026-10-22 22:40 — Branch `feature/rect-spot` from `main` (243f506). P1 done and committed. Starting P2, P3, P4 as parallel agents.
- 2026-10-22 22:50 — P1t done (9df83c9). Decisions doc started: docs/rect-spot-review.md. If agents were lost to an interruption, their uncommitted edits are still in the working tree: check `git status`, finish rather than redo.
- 2026-10-22 23:00 — P4 done: Help #spot/effects/FAQ, README, e2e smoke test, help-capture 02b-rect (GIF figure left commented in help.html until help:capture is run).
- 2026-10-22 23:05 — P2 done (box lens: types.ts `SizeChangeLens.box`, lenses, shader `uLensBox`, pipeline, tiles, math.lensRadius, effectDefs). Progress-log entry for the contract change still to write in P5. P3 still running.
- 2026-10-22 23:15 — Saravana asked for Sonnet where feasible and 5–7 parallel jobs: started P6–P9 on Sonnet (P3 still on Opus). If interrupted: P6/P7/P8 are read-only and can simply be re-run; P9 check docs/release-notes-v1.1.0.md.
- 2026-10-22 23:40 — P3 done and committed (0b40ebb). P7 audit: nothing missing in live code. Started P10 (Sonnet). Orchestrator now running full unit tests + build + e2e (P5).

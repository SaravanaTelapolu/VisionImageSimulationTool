# Development and Coding Progress

Plan: [incremental-ai-coding-detailed-plan.md](incremental-ai-coding-detailed-plan.md) · Resume guide: [handoff.md](handoff.md) · Questions: [morning-review.md](morning-review.md)

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
| W2-1 | Integration, live preview | Opus | running | worktree; interrupted by usage limit 22:57, resumed 01:28 |
| W2-2 | Ellipse editing | Sonnet | done | merged d8919ad; tap-to-place wired in 0822672 |
| W2-3 | Regions + Effects panels | Sonnet | done | merged (placement-mode TODO for W2-2 hook-up) |
| W2-4 | Storage | Sonnet | done | merged |
| W3-1 | Compare + present | Sonnet | todo | |
| W3-2 | Profiles + timeline | Sonnet | running | worktree; interrupted 22:57, resumed 01:28 (timeline takes a renderWithProfile prop) |
| W3-3 | Export panel | Sonnet | todo | |
| W3-4 | Freehand + brush | Sonnet | running | first attempt lost to usage limit; restarted 01:29 in a new worktree |
| W4-1 | PWA offline | Sonnet | done | merged; InstallPrompt to be mounted in App after W2-1 |
| W4-2 | Accessibility pass | Sonnet | todo | |
| W4-3 | Playwright smoke | Sonnet | todo | |
| W4-4 | Final review | Opus | todo | |

## Original-plan phases

| Phase | Status |
| --- | --- |
| 0 Scaffold and deploy | done locally; deploy deferred to Saravana |
| 1 Rendering core | renderer done; wiring in W2-1 |
| 2 Ellipse regions | editing + panels done; wiring in W2-1 |
| 3 All effects and undo | effects + undo done; wiring in W2-1 |
| 4 Calibrate, compare, present | todo |
| 5 Profiles and history | todo |
| 6 Freehand and brush | running (W3-4) |
| 7 Offline and polish | todo |

## Log (newest first)

- 2026-10-21 01:28 IST — Usage limit hit at ~22:57 (reset 01:20); all running agents stopped. Resumed W2-1, W3-2, W4-1 in their worktrees; W3-4 had no saved work and was restarted. Lesson: agents should commit early and often.
- 2026-10-20 22:55 IST — Merged W2-3 (panels), W1-C (renderer), W2-2 (ellipse editing); 344 tests pass, build green. Orchestrator: regions panel now uses tap-to-place; default distortion amplitude lowered 0.02 → 0.008; added shared src/state/masks.ts. Launched W2-1 integration (Opus) and W3-4 freehand/brush.

- 2026-10-20 22:20 IST — Merged W1-A, W1-B, W1-D, W1-E, W1-F, W1-G into develop: typecheck + build green, 230 tests pass. Re-ran `npm ci` in the main checkout (two agents' early `npm ci` ran there and damaged node_modules). Launched W2-2, W2-3, W2-4. W1-C (renderer) still running.

- 2026-10-20 21:50 IST — Scaffold verified (typecheck, 7 tests, build) and committed a88a281. Wave 1 launched: W1-A..W1-G, each in its own git worktree (.claude/worktrees). W1-C uses the built-in browser for its harness.

- 2026-10-20 21:40 IST — Branch `develop` created from `main`. Contracts written (`src/model/types.ts`, `coords.ts`, `defaults.ts`, `src/render/types.ts`). Scaffold agent (W0-2) started.

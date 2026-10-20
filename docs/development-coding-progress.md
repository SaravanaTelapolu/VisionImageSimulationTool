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
| W1-C | WebGL2 renderer | Opus | running | worktree, started 21:45 |
| W1-D | Test images | Haiku | done | merged 605d20a |
| W1-E | Export composer | Sonnet | done | merged 536ddd9 |
| W1-F | UI shell | Sonnet | done | merged 4aa6087 (UI not yet seen in a browser) |
| W1-G | Calibration guide | Sonnet | done | merged b5106f7 (not yet wired into App) |
| W2-1 | Integration, live preview | Opus | todo | waits for W1-C |
| W2-2 | Ellipse editing | Sonnet | running | worktree, started 22:20 |
| W2-3 | Regions + Effects panels | Sonnet | done | merged (placement-mode TODO for W2-2 hook-up) |
| W2-4 | Storage | Sonnet | done | merged |
| W3-1 | Compare + present | Sonnet | todo | |
| W3-2 | Profiles + timeline | Sonnet | running | worktree, started 22:35; timeline takes a renderWithProfile prop so it does not wait for W2-1 |
| W3-3 | Export panel | Sonnet | todo | |
| W3-4 | Freehand + brush | Sonnet | todo | |
| W4-1 | PWA offline | Sonnet | running | worktree, started 22:25 (independent of UI, started early) |
| W4-2 | Accessibility pass | Sonnet | todo | |
| W4-3 | Playwright smoke | Sonnet | todo | |
| W4-4 | Final review | Opus | todo | |

## Original-plan phases

| Phase | Status |
| --- | --- |
| 0 Scaffold and deploy | done locally; deploy deferred to Saravana |
| 1 Rendering core | todo |
| 2 Ellipse regions | todo |
| 3 All effects and undo | todo |
| 4 Calibrate, compare, present | todo |
| 5 Profiles and history | todo |
| 6 Freehand and brush | todo |
| 7 Offline and polish | todo |

## Log (newest first)

- 2026-10-20 22:20 IST — Merged W1-A, W1-B, W1-D, W1-E, W1-F, W1-G into develop: typecheck + build green, 230 tests pass. Re-ran `npm ci` in the main checkout (two agents' early `npm ci` ran there and damaged node_modules). Launched W2-2, W2-3, W2-4. W1-C (renderer) still running.

- 2026-10-20 21:50 IST — Scaffold verified (typecheck, 7 tests, build) and committed a88a281. Wave 1 launched: W1-A..W1-G, each in its own git worktree (.claude/worktrees). W1-C uses the built-in browser for its harness.

- 2026-10-20 21:40 IST — Branch `develop` created from `main`. Contracts written (`src/model/types.ts`, `coords.ts`, `defaults.ts`, `src/render/types.ts`). Scaffold agent (W0-2) started.

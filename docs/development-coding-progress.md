# Development and Coding Progress

Plan: [incremental-ai-coding-detailed-plan.md](incremental-ai-coding-detailed-plan.md) · Resume guide: [handoff.md](handoff.md) · Questions: [morning-review.md](morning-review.md)

Status values: `todo` · `running` · `done` (merged into `develop`) · `blocked` · `review` (merged, needs Saravana's check on a device)

## Task status

| ID | Task | Tier | Status | Branch / notes |
| --- | --- | --- | --- | --- |
| W0-1 | Contracts, docs, CLAUDE.md | Orchestrator | running | develop |
| W0-2 | Scaffold + photo load | Sonnet | running | develop (main checkout) |
| W1-A | Model ops, validation, undo | Sonnet | todo | |
| W1-B | Effect-map builder | Sonnet | todo | |
| W1-C | WebGL2 renderer | Opus | todo | |
| W1-D | Test images | Haiku | todo | |
| W1-E | Export composer | Sonnet | todo | |
| W1-F | UI shell | Sonnet | todo | |
| W1-G | Calibration guide | Sonnet | todo | |
| W2-1 | Integration, live preview | Opus | todo | |
| W2-2 | Ellipse editing | Sonnet | todo | |
| W2-3 | Regions + Effects panels | Sonnet | todo | |
| W2-4 | Storage | Sonnet | todo | |
| W3-1 | Compare + present | Sonnet | todo | |
| W3-2 | Profiles + timeline | Sonnet | todo | |
| W3-3 | Export panel | Sonnet | todo | |
| W3-4 | Freehand + brush | Sonnet | todo | |
| W4-1 | PWA offline | Haiku/Sonnet | todo | |
| W4-2 | Accessibility pass | Sonnet | todo | |
| W4-3 | Playwright smoke | Sonnet | todo | |
| W4-4 | Final review | Opus | todo | |

## Original-plan phases

| Phase | Status |
| --- | --- |
| 0 Scaffold and deploy | in progress (deploy deferred to Saravana) |
| 1 Rendering core | todo |
| 2 Ellipse regions | todo |
| 3 All effects and undo | todo |
| 4 Calibrate, compare, present | todo |
| 5 Profiles and history | todo |
| 6 Freehand and brush | todo |
| 7 Offline and polish | todo |

## Log (newest first)

- 2026-10-20 21:40 IST — Branch `develop` created from `main`. Contracts written (`src/model/types.ts`, `coords.ts`, `defaults.ts`, `src/render/types.ts`). Scaffold agent (W0-2) started.

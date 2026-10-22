# Rectangle spot (Option B) — decisions for your review

Built overnight 2026-10-22 without waiting for you, as asked. Each decision below was made by Claude;
tick it or write your answer next to it, and the next session acts on it.

Plan followed: [feature-rect-spot-option-B.md](feature-rect-spot-option-B.md). Live progress:
[feature-rect-spot-handoff.md](feature-rect-spot-handoff.md).

## Where it stands

_Updated at the end of the build: see "Result" at the bottom._

## Decisions

| # | Decision | Why | Your answer |
| --- | --- | --- | --- |
| 1 | **Branch `feature/rect-spot`**, not `main`. Nothing pushed, nothing merged. | The plan said "commit on main", but CLAUDE.md says to use a short-lived branch for bigger changes, and this touches both shared contracts. A branch lets you review before it reaches `main`. To accept: `git checkout main && git merge --ff-only feature/rect-spot`. | |
| 2 | **Profile version stays 1** (plan design 2). | The change is additive; every profile without a rectangle still opens in v1.0.x. Cost: a v1.0.x app shown a profile **with** a rectangle refuses it with "unknown shape type "rect"". The alternative (version 2) would make old apps refuse *every* new profile. Mention this in the release note. | |
| 3 | **All three phases built: B1 (shape), B2 (Size change for rectangles), B3 (docs, Help, e2e).** | B2 was optional; it was cheap enough and makes the rectangle behave like the oval. Size change on a rectangle uses a "box" lens (distance = max of the two axes), so the whole rectangle is magnified / shrunk evenly. | |
| 4 | **Separate "+ Spot (rectangle)" button** after "+ Spot (ellipse)"; existing labels unchanged. | Plan design 5; existing tests and the Help clips depend on the ellipse label. | |
| 5 | **Feather for rectangles = product of two per-axis fades** (plan design 3). Corners come out rounded and fade a bit more than the edge midpoints. | Avoids a visible diagonal crease from a plain box distance. Check by eye at 30 % and 100 % feather. | |
| 6 | **Row-span speed-up included** for rectangles (only the covered part of each map row is scanned). | Keeps several large rotated rectangles cheap on a phone. A unit test checks that it never drops a covered pixel (rotations 0–135°, hard and soft edges). | |
| 7 | **Parallel work through sub-agents in this one checkout** (each owns disjoint files), not separate sessions or git worktrees. | Separate sessions/worktrees each need their own `node_modules` (an earlier build damaged `node_modules` that way — see progress log 2026-10-20 22:20) and a merge afterwards. Disjoint files in one checkout gave the same parallelism with less risk. Renderer and UI agents ran on Opus, the docs agent on Sonnet. | |
| 8 | **Version number not bumped, no tag, no IIS package.** | Plan: only after your go-ahead. Suggested: `npm version 1.1.0 --no-git-tag-version`, tag `v1.1.0`. | |

## Result

_(filled in at the end)_

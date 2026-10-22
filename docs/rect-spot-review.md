# Rectangle spot (Option B) — decisions for your review

Built overnight 2026-10-22 without waiting for you, as asked. Each decision below was made by Claude;
tick it or write your answer next to it, and the next session acts on it.

Plan followed: [feature-rect-spot-option-B.md](feature-rect-spot-option-B.md). Live progress:
[feature-rect-spot-handoff.md](feature-rect-spot-handoff.md).

## Where it stands

**Done and checked; waiting for your review on branch `feature/rect-spot`** (not merged, not pushed). See "Result" at the bottom.

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
| 7b | **Model tiers after your 23:05 note ("use Sonnet when feasible"):** the editing-UI agent was already well along on Opus, so it was left to finish instead of being restarted (restarting would cost more). Every agent started after the note runs on Sonnet. | Saves tokens without throwing away work. | |
| 9 | **Only the new Help clip `02b-rect` was recorded**; the other clips were not re-recorded. | Re-recording everything changes ~10 large GIFs for no gain. Side effect: older clips that show the Regions panel show the previous 4-button layout (the new layout has 5 buttons, "Brush" spanning the row). Re-run `npm run help:capture` if you want them all current. | |
| 10 | **Rectangle outline keeps the app's round line joins** (corners of the yellow outline look very slightly rounded). | Matches the existing mask / whole-image outlines. One-line change to square corners if you prefer. | |
| 11 | **Size change feather on a rectangle uses the box distance** (plan design 4), so at high feather the *magnification* fades with straight edges and a faint diagonal at the corners, while blur/dark spot fade with rounded corners. | Plan design; only visible when comparing Size change against other effects at high feather. Could be matched later if it bothers you. | |
| 8 | **Version number not bumped, no tag, no IIS package.** | Plan: only after your go-ahead. Suggested: `npm version 1.1.0 --no-git-tag-version`, tag `v1.1.0`. | |

## Result

- **Built:** "+ Spot (rectangle)" in the Regions tab. You can place it by tapping, then move, resize and rotate it (with snapping) using the same dots as the oval, or nudge it with the arrow keys. The edge can be hard (anti-aliased) or soft (rounded corners), and every effect works inside it, including Size change. It also works with rename, hide, duplicate, reorder, delete, undo, save/load, JSON export/import, image export and full-resolution tiled export.
- **Checks (2026-10-23 ~00:15):**
  - `npm run typecheck` is clean.
  - `npm test` passes 725/725 (51 files).
  - `npm run build` is OK.
  - Playwright e2e passes 12/12, including a new rectangle test on desktop and phone size.
  - The Help clip `02b-rect` was recorded and embedded in Help → "Mark the affected area".
- **Checked by hand in the browser, at phone size:**
  - Placing a rectangle and rotating it (snaps to 45°).
  - Blur and Size change +30 % inside the rotated outline.
  - A dark spot with 100 % soft edge fades evenly with rounded corners.
  - No console errors.
  - At 360 px width, all buttons are 44 px tall and nothing scrolls sideways.
- **Reviews:**
  - An independent code review found no defects; it brute-force checked about 900 random rectangles for coverage gaps.
  - An audit for other oval-only code found nothing missing.
  - A speed check put rectangle maps within about 1–1.7× of ovals; they also cover 27 % more area at the same size.
- **Not checked:** a real phone (touch drag feel, speed), and full-resolution export of a rotated rectangle by eye. The tiling maths is unit-tested.
- **Release notes draft:** [release-notes-v1.1.0.md](release-notes-v1.1.0.md).
- **To ship (only on your go-ahead):**
  1. `git checkout main`
  2. `git merge --ff-only feature/rect-spot`
  3. `npm version 1.1.0 --no-git-tag-version`
  4. Commit, then tag `v1.1.0`.
  5. Push `main` and the tag. Pushing `main` deploys the live site.
  6. Optionally run `npm run package:iis`.

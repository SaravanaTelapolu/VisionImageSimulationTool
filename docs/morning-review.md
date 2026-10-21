# Morning Review — decisions, assumptions and questions

Everything the overnight build decided without you. Nothing here blocked the build.
Tick or answer inline; the next session reads this file.

## Where things stand (2026-10-21 07:07 IST)

- **The app is built.** Every feature in the plan (F1–F9) is on the local branch `develop`. Phases 0–7 are done.
- **Checks:** 592 unit tests, a production build and 8 end-to-end tests (Edge, desktop and phone size) all pass.
- **Verified by agents in a desktop browser:**
  - live preview, editing, flip, undo, wipe, side by side, present mode, profiles, timeline and export;
  - layout at phone width and at 150 % text.
- **Not verified yet:** anything on a real phone — speed, touch drawing, the share sheet, installing and working offline.
- Code review: 3 High and 5 Medium findings found and fixed. The Low items are fixed except where noted in docs/code-review-findings.md.
- To try it now on this PC: `npm run dev`, then open http://localhost:5173.

## Needs your action

- [x] **Push.** Done 2026-10-21: `develop` merged into `main`, tagged `v0.1` ("Initial Build"), and `main`, `develop` and the tag pushed to GitHub.
- [ ] **Deploy (needs a decision).** The repository is **private**. GitHub Pages for a private repo needs a paid GitHub plan, so the "Deploy to GitHub Pages" workflow will fail until one of these is done:
  - make the repo public — the code holds no photos, but the plan docs describe your eye condition; or
  - use a free host that deploys private repos (for example Cloudflare Pages or Netlify), building with `npm run build` and publishing `dist/`; or
  - a GitHub Pro plan.
  Then: GitHub → Settings → Pages → Source: "GitHub Actions".
- [ ] **Test on your phone** once deployed: each "Done when" line in docs/Vision-Simulator-Plan.md. Check ⋯ → Performance while dragging a slider (target under 50 ms), the Share button to WhatsApp, and Install app → airplane mode.
- [ ] **Clean up agent worktrees** when you're happy: they live in `.claude/worktrees/` (git-ignored) with branches `worktree-agent-*`. All of their work is merged into `develop`.
- [ ] The backup scheduled task "vision-sim-auto-resume" was disabled. Delete it from the app's Scheduled list if you don't need it.

## Your review (2026-10-21)

| Item | Your answer | Action |
| --- | --- | --- |
| D02 | Vite 6 is fine for now | Unchanged |
| D03 | Push now for safety; more pushes are fine | Done (v0.1) |
| D04 | "You are a better judge" | Kept: blur is defined at a 768 px shorter side and scaled, so preview and export match |
| D05 | Per-region dark-spot shade preferred | Being implemented (each region gets its own grey ↔ black setting) |
| D06 | Parked until you test | Unchanged |
| D01, D07–D27 | OK | Unchanged |
| Q1 | Android phone; iPhone is an optional roadmap item | Added to docs/roadmap.md |
| Q2 | All effects is a good start | Unchanged |
| Q3 | Editable is fine; near vision first, far vision later; want to change the default | Being implemented: a "default viewing distance" setting with Near / Computer / Far presets |
| Q4 | Current default is good | Unchanged |
| Q5 | Make it configurable, current default | Being implemented: export size setting — "Up to 4096 px" (default) or "Full resolution" |
| Q6 | Current default is good | Unchanged |

## Decisions made (change any you disagree with)

| # | Decision | Why |
| --- | --- | --- |
| D1 | Stack = option 3 (TypeScript, Vite, Preact, WebGL2, IndexedDB, PWA) | Your choice |
| D2 | Vite 6 / Vitest 3, not Vite 7 | This PC has Node 18.20.1; Vite 7 needs Node 20+. CI uses Node 20. |
| D3 | All work on local branch `develop`; nothing pushed | Pushing publishes to GitHub; left for you |
| D4 | Blur strength (0–40 px) is defined at a 768 px shorter side and scaled for other sizes | Same look on preview and full-size export |
| D5 | Dark-spot shade (grey ↔ black) is one setting per profile, not per region | Keeps shaders simple, like wave size and ghost offset in the plan |
| D6 | Distortion: per-region strength; wave size, direction and max amplitude (default 0.8% of shorter side, see D12) per profile | Matches the plan's "set once per profile" note |
| D7 | Size change applies to ellipse regions only, up to 8 | Plan's uniform-based design |
| D8 | Effect maps rasterised in TypeScript at ≤ 512 px and upscaled on the GPU | Fast, testable, maps are smooth anyway |
| D9 | Fixation point is per image (view state), not saved in the profile | Profiles stay image-independent; the crosshair defaults to the centre |
| D10 | Undo keeps 100 steps; a continuous slider drag is one step | Plan asks for ≥ 50 |
| D11 | +y is down in profile coordinates | Screen convention |
| D12 | Default max distortion lowered to 0.8% of the shorter side | At 2% the renderer agent found 100% distortion folds lines into a mess |
| D13 | Full-size export above 4096 px (or the GPU limit) is downscaled, not tiled | Simpler; phone photos are usually around 4000 px. See Q5 |
| D14 | "Spot" asks you to tap the photo where it goes; without a photo it lands on the crosshair | Faster than dragging from the centre |
| D15 | Profiles get a 5th tab ("Profiles"); the timeline opens from the Compare and Profiles tabs | Easier to find than a menu; still fits at 360 px |
| D16 | Effect maps are built in a Web Worker | Desktop showed frames close to 30 ms; a phone would miss the 50 ms target |
| D17 | Side-by-side export: square photos go side by side, only clearly landscape ones stack | Square-on-square stacked was tall and awkward to view |
| D18 | Test images are picked from the ⋯ menu, the empty screen and the Compare tab | No room in the top bar at 360 px |
| D19 | Sharing is two steps: "Prepare images", then "Share" | Android only opens the share sheet straight after a tap; rendering can take seconds |
| D20 | Present mode keeps the screen on while open, where the browser allows it | So the screen doesn't dim while the doctor looks |
| D21 | Side-by-side compare is view-only; editing switches back to Single | It replaces the editable view |
| D22 | Undo, Redo and Flip sit in a bar at the bottom of the image (thumb reach); the top bar keeps the name and menu | One-handed use on a phone |
| D23 | Imports are limited (5 MB file, 200 regions, 500 profiles per bundle) | Protects the app from huge or corrupt files |
| D24 | The app asks the browser to keep your data after your first save (not at startup) | Browsers grant this more readily after real use |
| D25 | Every export except "Original" carries the approximation note, even with the caption off | Honesty requirement |
| D26 | The live preview is rendered at the size it is shown on screen (up to 2048 px), and the original in Flip/Wipe/Side by side uses the same source | So the simulated image is never softer than the original outside the affected areas |
| D27 | Overlapping size-change spots blend instead of multiplying | Avoids extreme warping where two spots overlap |

## Questions (answer when convenient; the build continues on the assumption shown)

| # | Question | Assumed for now |
| --- | --- | --- |
| Q1 | Is your phone Android? Do you need iPhone support? | Android Chrome first; iOS Safari best effort |
| Q2 | Which effects match your right eye? | All effects built; none pre-set |
| Q3 | Standard viewing distance for comparable snapshots? | 40 cm default, editable |
| Q4 | Preferred export: PNG or JPEG, captions on or off? | PNG, caption on, side-by-side optional |
| Q5 | Should exports keep the full resolution of very large photos (> 4096 px) by tiling? | No: downscaled to 4096 px |
| Q6 | On a low-end phone, should the live preview use a lower resolution cap (e.g. 1280 px) for speed? | No: capped at 2048 px or the screen size, whichever is smaller. Check the ⋯ → Performance number on your phone; if it is often above 50 ms, say so |

## Overnight incidents

- ~22:57–01:20: the Claude usage limit stopped all agents; the build resumed automatically at 01:28.
- ~02:30–06:20: a second usage limit; the build resumed automatically at 06:28.

## Notes from agents

Choices the agents made, which you may want to change:

- **Model (W1-A):** profiles from future app versions are rejected; out-of-range values are clamped with a warning on import.
- **Effect maps (W1-B):** painting a mask ignores the feather slider (the brush itself is soft).
- **Export (W1-E):**
  - Side-by-side puts the original first. Portrait photos go side by side, landscape photos are stacked.
  - The caption always ends with "My own approximation — not a clinical measurement."
- **UI shell (W1-F):**
  - One finger on the photo is kept for editing; pan and zoom use two fingers (or the mouse on desktop).
  - Moving the crosshair is not an undo step.
  - The bottom sheet pushes the photo up rather than covering it.
- **Renderer (W1-C):** a blur of N px is a Gaussian with N px standard deviation (like CSS blur). Checked on a desktop GPU only; phone speed is untested.
- **Panels (W2-3):** effect sliders are grouped Sharpness / Spots / Shape / Tone; feather is disabled for whole-image regions.
- **Storage (W2-4):** deleting a profile also deletes its saved photo; a new check-up copies the eye map but not the photo.
- **Editing (W2-2):** tapping overlapping spots cycles through them; arrow keys nudge on desktop.
- **Integration (W2-1):** Ctrl+Z / Ctrl+Y undo and redo on desktop; the ⋯ menu shows the render time (Performance) for checking speed on your phone.
- **Profiles (W3-2):** Amsler is the default timeline picture. Opening a profile also loads its saved photo if you saved one. Delete, and leaving unsaved changes, both need a second tap.
- **PWA (W4-1):** the app colours are black (#000) for the install splash screen.
- **Freehand/brush (W3-4):** brush size is 1–30 % of the shorter side; a second finger cancels the current stroke. Freehand and Brush need a photo first.
- **Export (W3-3):** the caption and labels go on the Simulated and Side-by-side files; the Original file stays clean. Side-by-side is capped at 2048 px on the long side.
- **Compare (W3-1):** with no photo loaded, the timeline uses the Amsler grid.
- **Accessibility (W4-2):** ellipse handles can't be moved with the keyboard yet (the crosshair can). Failed shares don't fall back to a download automatically; use "Download instead".
- **State fixes (W5-3):** a photo in HEIC format that the browser can't open now shows a clear message with the iPhone setting to switch to JPEG.
- **Calibration (W1-G):** viewing distance is accepted from 10 to 150 cm. The guide has 5 steps; the last one is tips.

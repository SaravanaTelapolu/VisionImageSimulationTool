# Morning Review — decisions, assumptions and questions

Everything the overnight build decided without you. Nothing here blocked the build.
Tick or answer inline; the next session reads this file.

## Needs your action

- [ ] **Push and deploy.** Work is committed locally on branch `develop` only (not pushed). To publish: push `develop`, merge to `main`, then GitHub → Settings → Pages → Source: "GitHub Actions". The repo must be public for free Pages hosting (photos never go in the repo).
- [ ] **Test on your phone** once deployed: each "Done when" line in docs/Vision-Simulator-Plan.md.

## Decisions made (change any you disagree with)

| # | Decision | Why |
| --- | --- | --- |
| D1 | Stack = option 3 (TypeScript, Vite, Preact, WebGL2, IndexedDB, PWA) | Your choice |
| D2 | Vite 6 / Vitest 3, not Vite 7 | This PC has Node 18.20.1; Vite 7 needs Node 20+. CI uses Node 20. |
| D3 | All work on local branch `develop`; nothing pushed | Pushing publishes to GitHub; left for you |
| D4 | Blur strength (0–40 px) is defined at a 768 px shorter side and scaled for other sizes | Same look on preview and full-size export |
| D5 | Dark-spot shade (grey ↔ black) is one setting per profile, not per region | Keeps shaders simple, like wave size and ghost offset in the plan |
| D6 | Distortion: per-region strength; wave size, direction and max amplitude (default 2% of shorter side) per profile | Matches the plan's "set once per profile" note |
| D7 | Size change applies to ellipse regions only, up to 8 | Plan's uniform-based design |
| D8 | Effect maps rasterised in TypeScript at ≤ 512 px and upscaled on the GPU | Fast, testable, maps are smooth anyway |
| D9 | Fixation point is per image (view state), not saved in the profile | Profiles stay image-independent; the crosshair defaults to the centre |
| D10 | Undo keeps 100 steps; a continuous slider drag is one step | Plan asks for ≥ 50 |
| D11 | +y is down in profile coordinates | Screen convention |

## Questions (answer when convenient; the build continues on the assumption shown)

| # | Question | Assumed for now |
| --- | --- | --- |
| Q1 | Is your phone Android? Do you need iPhone support? | Android Chrome first; iOS Safari best effort |
| Q2 | Which effects match your right eye? | All effects built; none pre-set |
| Q3 | Standard viewing distance for comparable snapshots? | 40 cm default, editable |
| Q4 | Preferred export: PNG or JPEG, captions on or off? | PNG, caption on, side-by-side optional |

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
- **Calibration (W1-G):** viewing distance is accepted from 10 to 150 cm. The guide has 5 steps; the last one is tips.

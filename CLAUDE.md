# Vision Simulator

A free, private, phone-first web app (PWA) that recreates what Saravana's damaged right eye sees on any photo, so a doctor can see it. All processing stays on the device: no server, no analytics, no runtime third-party calls. It is a communication aid, never a diagnostic tool — keep the "my own approximation, not a clinical measurement" note visible.

## Read first

- `docs/Vision-Simulator-Plan.md` — requirements (F1–F9), NFRs, design, data model.
- `docs/incremental-ai-coding-detailed-plan.md` — waves, task IDs, file ownership, model tiers.
- `docs/development-coding-progress.md` — live status. `docs/handoff.md` — how to resume. `docs/morning-review.md` — open decisions.

## Stack

TypeScript (strict) · Vite 6 · Preact + @preact/signals · WebGL2 shaders · IndexedDB via idb · vite-plugin-pwa · Vitest · Playwright · GitHub Pages. Node 18 locally (hence Vite 6).

## Layout

- `src/model/` profile types (`types.ts` is the shared contract), coords, defaults, validation, ops, undo history
- `src/render/` effect-map builder (pure TS; `pathCoverage.ts` for freehand), map Web Worker (`mapWorker*.ts`), WebGL renderer (`createRenderer.ts`, `gl/`, `shaders/`; design notes at the top of createRenderer.ts), `types.ts` contract
- `src/state/` signals: `store.ts` (profile, image, undo), `render.ts` (live preview loop + export/timeline render API), `edit.ts`, `masks.ts`, `profiles.ts`, `ui.ts`
- `src/ui/` components: viewport, edit tools (ellipse, freehand, brush), panels (regions, effects, compare, export, profiles), calibration, present mode, controls
- `src/storage/` IndexedDB + JSON import/export · `src/export/` compose, caption, share · `src/assets/` test images · `src/image/` photo loading · `src/pwa/` service worker + install prompt
- `public/help.html` user Help page (static; keep it in step with UI changes); its GIFs/screenshots in `public/help/media/` are recorded by `scripts/help-capture/` (`npm run help:capture`, needs ffmpeg)
- `tests/e2e/` Playwright smoke tests; `dev/render-harness.html` is a WebGL effects harness (`npm run dev`, then /dev/render-harness.html)

## Rules

- Eye-map coordinates are relative to the fixation point in units of the image's shorter side; +y is down.
- Shared contracts (`src/model/types.ts`, `src/render/types.ts`) change only deliberately, with a progress-log entry.
- Unit tests next to code (`*.test.ts`) for all maths and data-model code.
- Before finishing any change: `npm run typecheck`, `npm test`, `npm run build`.
- Never commit photos. Work on `main` (the `develop` branch was merged and deleted after v1.0); use a short-lived branch for bigger changes. Do not push without Saravana's go-ahead; pushing `main` deploys the live site.
- Touch targets ≥ 44 px, works at 360 px width, high contrast.

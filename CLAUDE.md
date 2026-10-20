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
- `src/render/` effect-map builder, WebGL renderer (`gl/`, `shaders/`), `types.ts` contract
- `src/state/` signals store · `src/ui/` components · `src/storage/` IndexedDB + JSON · `src/export/` compose, caption, share · `src/assets/` test images · `src/image/` photo loading

## Rules

- Eye-map coordinates are relative to the fixation point in units of the image's shorter side; +y is down.
- Shared contracts (`src/model/types.ts`, `src/render/types.ts`) change only deliberately, with a progress-log entry.
- Unit tests next to code (`*.test.ts`) for all maths and data-model code.
- Before finishing any change: `npm run typecheck`, `npm test`, `npm run build`.
- Never commit photos. Work on `develop`; do not push without Saravana's go-ahead.
- Touch targets ≥ 44 px, works at 360 px width, high contrast.

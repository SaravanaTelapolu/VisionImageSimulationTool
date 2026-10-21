# Vision Simulator

A free, private web app that recreates what an affected eye sees on any photo, so a doctor can see it instead of hearing it described. Everything runs on your device: no server, no account, no analytics. It is a communication aid, not a diagnostic tool.

## Use it

1. Open the app (see "Deploy" below for the address) on your phone or computer. In Chrome or Edge, choose **Install app** to get an icon that works offline.
2. Choose a photo, take one with the camera, or try the built-in **Amsler grid** (⋯ menu or the start screen).
3. **Regions** tab → **Spot**, then tap where the affected area is. Drag the handles to move, resize and rotate it. **Freehand** traces an irregular outline; **Brush** paints a patchy area.
4. **Effects** tab: blur, dark spot, missing area, distortion, size change, contrast loss, dimming, colour fade and double image. Every slider updates the picture live.
5. **Calibration guide** (⋯ menu): cover your good eye, look at the crosshair, note what looks wrong, then match the simulation with the other eye. **Flip** (bottom bar) switches between original and simulated.
6. **Compare** tab: wipe, side by side, full-screen **Present** mode for the appointment, and the **Timeline** of dated check-ups.
7. **Export** tab → **Prepare images** → **Share** (WhatsApp, email) or **Download**. Images carry the note "My own approximation — not a clinical measurement."
8. **Profiles** tab: save the eye map, start a **New check-up** later, and export/import profiles as JSON to move between phone and laptop.

## Develop

Requires Node 18+ (Node 20 recommended).

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run typecheck
npm run build      # production build in dist/
npm run e2e        # Playwright smoke tests (uses installed Microsoft Edge locally)
```

Project guide for Claude Code sessions: [CLAUDE.md](CLAUDE.md). Requirements and design: [docs/Vision-Simulator-Plan.md](docs/Vision-Simulator-Plan.md). Build history: [docs/development-coding-progress.md](docs/development-coding-progress.md).

## Deploy (GitHub Pages)

1. Push the branch and merge it into `main`.
2. On GitHub: **Settings → Pages → Source: GitHub Actions**.
3. The `deploy.yml` workflow builds and publishes on every push to `main`. The address is `https://<user>.github.io/VisionImageSimulationTool/`.

No photos are ever stored in the repository or sent anywhere.

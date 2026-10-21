# Roadmap

Items for later versions. The current version is tracked in [development-coding-progress.md](development-coding-progress.md).

## Optional

- **iPhone support (iOS Safari).** The app is built for Android Chrome and desktop Chrome/Edge. iOS Safari is untested. Likely work:
  - test the WebGL shaders and the 2048 px preview cap on Safari;
  - HEIC photos (convert, or guide to "Most Compatible");
  - home-screen install and offline behaviour, which differ from Android;
  - Web Share with files;
  - storage that Safari may clear after 7 days without use.

## Planned features

- **Rectangle spot ("+ Spot (rectangle)").** Two ready-to-build plans; pick one:
  - [Option A](feature-rect-spot-option-A.md): quick, a four-corner freehand outline (1–2 h; does not stay rectangular, no rotate, no size change).
  - [Option B](feature-rect-spot-option-B.md): a real rectangle shape that edits like the oval (about half a day; recommended).

## After first phone tests

- **Far vision.** Once near vision (reading distance) has been simulated and tracked, add profiles for far vision. This needs larger viewing distances and test images suited to distance, such as a street scene or signage, viewed on a laptop or TV.
- **Distortion defaults (D06).** Revisit the default wave size, direction and amplitude after testing on the phone.
- **Low-end phone performance (Q6).** If ⋯ → Performance often shows more than 50 ms, add a lower preview cap.

## Known small gaps

- Ellipse handles can't be moved with the keyboard (the crosshair can).
- Remaining Low items in [code-review-findings.md](code-review-findings.md).

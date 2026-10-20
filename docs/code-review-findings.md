# Code review findings (W4-4)

Reviewed `develop` at f2302c5 (merge of W3-1). The whole of `src/` was read against CLAUDE.md, `docs/Vision-Simulator-Plan.md` (F1–F9, NFRs) and `docs/incremental-ai-coding-detailed-plan.md`. Typecheck, the 513 unit tests and `npm run build` all pass on this commit. Two findings were confirmed with throwaway Vitest experiments that were not committed: the path-map timing (H2) and the rename undo step (L1).

## Summary

The core maths is sound and consistent. That covers fixation-relative coordinates, y-down rotation, the effect-map channel layout, the blur-pyramid scaling, and the preview-to-export scaling of the fixation and lenses. Privacy also holds: there are no runtime network calls, and the service worker precaches only app assets. Most real problems sit at the seams between modules:

- **Timeline vs masks.** The timeline renders saved profiles with the *live* brush-mask cache, which is keyed by the current profile's region ids. Mask regions in other profiles disappear (H1).
- **Freehand performance.** Path regions are rasterised in O(map area × vertices) with no scanline pruning. One medium outline costs 4–9× a full set of 8 ellipses, and export and the timeline do this on the main thread (H2).
- **Preview resolution.** The simulated view is a 1024 px preview. Flip, wipe, side-by-side and present mode show it next to the 2048 px original, so the simulation looks softer everywhere, not only in the regions (H3).
- **Async races and platform limits.** The share sheet runs after a long render and loses the user gesture. Startup profile restore can overwrite what the user already did. Image loads are not latest-wins. Persistent storage is never requested.

Counts: **Critical 0 · High 3 · Medium 5 · Low 11.**

---

## High

### H1. Timeline drops brush-mask regions for every profile except the open one

- **Where:** `src/state/render.ts:413` (`renderWithProfile` → `buildMapsForFrame(p.regions, frame, maskData.peek(), …)`), with `src/ui/TimelineHost.tsx` and `src/state/masks.ts`.
- **What is wrong:** `maskData` holds decoded masks only for the **current** profile, keyed by region id. The timeline renders **saved** profiles from IndexedDB. A check-up made with "duplicate as check-up" gets new region ids (`duplicateProfile`), so its mask regions find no data. `maskSampler` then returns null and the region renders as nothing. For the saved copy of the open profile, the ids match, so the timeline shows the live, possibly unsaved mask instead of the saved one.
- **Failure scenario:** Saravana paints a patchy scar with the brush in October and saves. He duplicates it as a November check-up and edits it, then opens the timeline. The October tile shows no scar at all, and the doctor compares a wrong picture.
- **Fix:** `renderWithProfile` should decode masks from the given profile's own `shape.dataUrl`s. Reuse the `masks.ts` cache keyed by dataUrl through an exported async `decodeMasksFor(profile)`, and await it before building the maps. Do not read `maskData`.

### H2. Freehand (path) regions make effect-map builds very slow

- **Where:** `src/render/shapeCoverage.ts:128-195` (`pathSampler`).
- **Callers:**
  - `src/state/render.ts:151`: synchronous first frame and context restore.
  - `src/state/render.ts:342`: export, synchronous, 1024 px maps.
  - `src/state/render.ts:413`: timeline, synchronous.
  - Every worker build.
- **What is wrong:** `pathSampler` has no `rowSpan`, so every pixel in the bounding box runs an O(n) even-odd test. Every inside pixel then also runs an O(n) distance-to-edge loop, even when it is deep inside, where the result is fully saturated. Measured on this PC for one feathered outline of radius 0.35, at the same time as 8 ellipses took 44–50 ms:

  | Outline | 512 px preview map | 1024 px export map |
  | --- | --- | --- |
  | 150 points | 413 ms | 1.8 s |
  | 40 points | 179 ms | 0.4 s |

  A phone is 3–5× slower. Effect strengths are baked into the maps, so **every** slider tick on any region rebuilds the path too.
- **Failure scenario:** With one traced scar on the photo, each slider change shows its result 0.5–2 s later on a mid-range phone. That misses the 50 ms NFR by over 10×. Export freezes the UI for several seconds before the render even starts, and opening the timeline freezes once per profile.
- **Fix:**
  - Add a scanline `rowSpan`: compute edge crossings per row once (sorted x-intersections) and fill spans, instead of running the per-pixel point-in-polygon test.
  - Compute edge distance only for pixels within `featherWidth` (+1 px) of an edge, using a per-row candidate-edge list or a coarse grid of edges. Pixels further inside get coverage 1 directly.
  - Optionally cache each region's coverage raster by `(shape, feather, frame, map size)`, so strength-only changes do not re-rasterise geometry.
  - Move the export and timeline builds to the worker.

### H3. The simulated view is shown at half the resolution of the original it is compared with

- **Where:**
  - `src/state/render.ts:232`: preview source capped at 1024 px.
  - `src/ui/viewport/Viewport.tsx:97`: original drawn at working size, up to 2048 px.
  - `src/ui/viewport/Viewport.tsx:108`: preview canvas stretched over the same box.
  - `src/ui/panels/compare/useCopies.ts:51-60`, `src/ui/present/PresentMode.tsx:24-25`: same mismatch.
- **What is wrong:** "Original" is drawn from the 2048 px working image, but "Simulated" is the 1024 px WebGL canvas upscaled to the same CSS box. Whenever the displayed size exceeds about 1024 device px, the simulated layer is softer **everywhere**, including areas with no region. That happens on most phones at fit (≈400 CSS px × DPR 3), at any pinch zoom, and in full-screen present or side-by-side on a laptop or TV.
- **Failure scenario:** Saravana loads "reading text" and flips between original and simulated during calibration. All the text, not just the scar area, jumps from sharp to slightly blurred. In present mode on the doctor's monitor, the whole simulated image looks out of focus, which misrepresents the eye map. F5 relies on flip, and F6 depends on a faithful before/after.
- **Fix:** Show both layers at the same resolution. The cheapest option is to draw the "original" layer and copies from the preview source canvas (`source.canvas`, the same 1024 px pixels the renderer started from). A better option is to size the preview to the displayed device-pixel size: re-render at higher resolution when zoomed or presenting, or render present mode with `renderFullSize`-style params at screen size.

---

## Medium

### M1. Sharing after an export usually falls back to download on phones (F7)

- **Where:** `src/ui/panels/export/run.ts:73-111` → `src/export/share.ts:64-68`.
- **What is wrong:** `navigator.share()` needs transient user activation, which lasts about 5 s in Chromium and less in Safari. `runExportJob` first does a multi-second pipeline, then shares:
  1. Decode the full-size original.
  2. Render, PNG-encode, decode again (`blobToCanvas`), compose and encode again.
  3. For side-by-side, decode the original a second time and encode once more.

  The share then throws `NotAllowedError`, which is caught and silently turned into a download.
- **Failure scenario:** On a mid-range Android phone with the defaults (simulated + side by side, PNG, caption), the share sheet for WhatsApp or email never appears. Files land in Downloads with the status "Downloaded 2 files".
- **Fix:** Use two steps. Render first, then show a "Share" button whose click handler calls `navigator.share` synchronously with the ready files. Keep download as the fallback. Also avoid the PNG encode-then-decode round trip by rendering to a canvas, not a blob.

### M2. Startup profile restore can overwrite the user's first actions

- **Where:** `src/ui/App.tsx:99-102`, `src/state/profiles.ts:324-330` and `155-160`.
- **What is wrong:** `restoreLastProfile()` runs after first paint and awaits several IndexedDB round-trips: open the DB, list, read the setting, get the profile, get the photo. It then calls `resetProfile()` and `loadPhoto(savedPhoto)` unconditionally. Nothing checks whether the user loaded an image or made edits in the meantime. The dirty guard exists only in the Profiles panel.
- **Failure scenario:** On a cold PWA start, IndexedDB opening can take hundreds of ms. The user taps "Try the Amsler grid" and places a spot. The restore then completes: the spot and its undo history disappear, and the saved photo replaces the Amsler grid.
- **Fix:** At the start of restore, record `history` version, `image` and `profile.id`. Before applying, skip the restore (or ask) if any of them changed, or if `dirty` is true. Never replace an image that was loaded after startup.

### M3. Image loading is not latest-wins

- **Where:** `src/state/store.ts:103-134` (`loadPhoto`, `loadTestImage`), plus `openProfile` → `loadPhoto`.
- **What is wrong:** Concurrent loads each call `setWorkingImage` when they finish, so the *slowest* one wins, not the last one requested. `photoLoading` is cleared by whichever finishes first. Only the Compare tab's test-image buttons are disabled while loading. The top-bar photo picker, the ⋯ menu test-image picker and profile open are not.
- **Failure scenario:** The user picks a 12 MP photo (1–2 s decode), changes their mind and picks the Amsler grid from the ⋯ menu. The grid appears, then the photo replaces it a second later.
- **Fix:** Add a module-level load token: increment it per request, and apply the result only if the token is still current. Keep a loading counter instead of a boolean.

### M4. Persistent storage is never requested, so saved profiles can be evicted

- **Where:** `src/storage/persist.ts:4`: `requestPersistentStorage()` is exported but never called.
- **What is wrong:** Without `navigator.storage.persist()`, IndexedDB is "best effort" and can be evicted under storage pressure. Safari also deletes script-writable storage of non-installed sites after 7 days without use. Success criterion 4 ("snapshots taken months apart") depends on profiles surviving.
- **Failure scenario:** Months of dated check-ups disappear after the phone runs low on space, or after a few weeks without opening the site in Safari.
- **Fix:** Call `requestPersistentStorage()` after the first successful save, which is a user gesture. Surface the result in the Profiles tab, for example "Saved on this device — export a backup file". Suggest installing to the home screen on iOS.

### M5. Each preview frame blocks the main thread on the GPU, and each edit renders twice

- **Where:** `src/state/render.ts:207-221` (`renderFrame` → `r.finish()` at line 219) and `146-179` (`mapsFor`).
- **What is wrong:**
  - `finish()` does a synchronous `readPixels` after every frame, only to measure timing. This serialises CPU and GPU, and the main thread waits out the whole GPU frame on every slider tick.
  - For any edit that changes regions, `mapsFor` returns the *previous* maps while the worker builds new ones. Frame 1 therefore re-renders an image that looks unchanged; it is wasted GPU time plus a sync stall. Frame 2 follows when the maps arrive.
  - `useSimulatedCopy` and the export thumbnail then also `drawImage` the WebGL canvas, another readback, on every `renderTick`.
- **Failure scenario:** On a mid-range phone, a 20–30 ms GPU frame becomes 20–30 ms of main-thread blocking per input event, twice per edit. Slider dragging feels sticky even when the maps are cheap.
- **Fix:**
  - Measure GPU time only when the Performance line is visible, or use `EXT_disjoint_timer_query_webgl2` where available, and otherwise drop `finish()`.
  - When the only change is pending maps (same globals, lenses and fixation), skip the render until the maps arrive.

---

## Low

### L1. Two consecutive profile renames merge into one undo step (verified)

- **Where:** `src/state/profiles.ts:204` (`renameCurrent` uses coalesce key `'rename'`, and nothing calls `endEdit()`).
- **Scenario:** Rename "Original" → "First" (blur), then "First" → "Second". One Undo returns to "Original". A Vitest experiment confirmed it.
- **Fix:** Call `endEdit()` after the rename, or pass no coalesce key, because one blur is one step.

### L2. The feather slider is enabled for brush-mask regions but does nothing

- **Where:** `src/ui/panels/effects/effectDefs.ts:113` (`isFeatherEnabled` returns true for `'mask'`) vs `src/render/shapeCoverage.ts:256-257` (mask coverage ignores feather, by W1-B design).
- **Fix:** Disable it for masks with a note ("Use brush softness instead"), as is done for whole-image regions, or apply feather to masks.

### L3. Exports with "caption" off carry no approximation note

- **Where:** `src/ui/panels/export/run.ts:67`: the note exists only inside the caption lines.
- **Scenario:** A caption-less side-by-side PNG is forwarded on WhatsApp without the "my own approximation" disclaimer. This weakens the Honesty NFR and the "images read as clinical evidence" risk mitigation.
- **Fix:** Always burn a one-line approximation footer, even when the rest of the caption is off.

### L4. Image and GPU resource leaks

- **Where:** `src/state/store.ts:96` (`setWorkingImage`) and `src/state/render.ts:383-415`.
- **What is wrong:**
  - The previous `PhotoState.working` ImageBitmap is never `close()`d, which is about 12 MB of native memory per 2048 px photo and is reclaimed only by GC.
  - The timeline's `offscreen` WebGL renderer stays alive with its RGBA16F pyramid for the rest of the session once the timeline has been opened (tens of MB of GPU memory, plus a second live context).
  - `offscreenSource` keeps a reference to an old working image, so that image cannot be freed either.
- **Fix:** Close the old bitmap after the preview and viewport have switched, guarding against other holders. Dispose the offscreen renderer (or `setSource` a 1×1) when the timeline closes.

### L5. Import validation has no size bounds

- **Where:** `src/model/validate.ts:194-215` (path points), `217-231` (mask dataUrl) and `348` (viewingDistanceCm).
- **What is wrong:** A file can contain a path with 10⁵ points, a multi-megabyte or very large-dimension mask PNG, or `viewingDistanceCm: 1e9`. Combined with H2, one bad or corrupted backup can freeze the app on open, including at startup through `restoreLastProfile`.
- **Fix:** Cap the number of points (for example 2000, simplified with RDP on import) and the dataUrl length and decoded mask size. Clamp viewing distance to 10..150 like the UI, and cap string lengths.

### L6. Fallbacks for HEIC and undecodable originals are silent

- **Where:** `src/state/render.ts:307-322` and `346-353`, and `src/state/store.ts:111`.
- **What is wrong:**
  - If the original cannot be decoded at full size, which is common for HEIC in Chrome, export quietly uses the 2048 px working image. It reports `downscaled: false` because the renderer compares against the declared 2048 size.
  - When the photo itself cannot be opened, the message is generic ("Could not open that image."), with no hint that the format (for example HEIC) is unsupported.
- **Fix:** Set `downscaled` (or a new `fromWorking` flag) when the fallback is used, and show a format-specific error for `.heic` and `.heif` files.

### L7. A whole-image brush mask captures every tap

- **Where:** `src/ui/edit/geometry.ts:182-187` and `208-213`.
- **What is wrong:** A mask is hit-tested as its full rectangle. The default mask covers the whole image, and as a non-`full` shape it always wins `pickTapTarget`.
- **Scenario:** After adding a brush region, tapping bare image never deselects. Tapping other shapes cycles through the mask.
- **Fix:** Hit-test masks on painted pixels (`maskData` value > threshold), or treat them like `full` regions.

### L8. Overlapping size-change lenses compound

- **Where:** `src/render/shaders/effects.ts:92-101`. Each lens divides the already-warped `q`.
- **What is wrong:** Two overlapping +30% spots give about 1.69× magnification. This breaks F3's "stronger effect wins per effect type" and the ±30% range.
- **Fix:** Take the lens with the largest |amount × weight| per pixel, or combine amounts with max before warping.

### L9. Masks still decoding are ignored or overwritten

- **Where:** `src/state/render.ts:342` and `413`, and `src/ui/edit/brush/BrushLayer.tsx:79-81`.
- **What is wrong:**
  - Export and timeline read `maskData` synchronously, so right after startup restore or undo, a mask whose PNG is still decoding renders as missing or stale.
  - A brush stroke started while the region's new dataUrl is still decoding paints onto the previous buffer. This can resurrect an undone stroke when the cache entry was evicted (more than 8 spare masks).
- **Fix:** Expose a `masksReady()` promise for export and timeline. Block brush strokes while `pending` contains the region's dataUrl.

### L10. The timeline ignores the user's fixation on the current photo

- **Where:** `src/state/render.ts:412` (`centredFrame`).
- **What is wrong:** When the timeline source is the current photo and the crosshair was moved, the tiles differ from the live view and the export.
- **Fix:** Pass the current fixation, scaled to the source, when the source is the current photo.

### L11. "Original" export allocates a canvas at full camera resolution

- **Where:** `src/state/render.ts:361-371` (no cap when `maxLongSide` is undefined) and `src/ui/panels/export/run.ts:92`.
- **What is wrong:** A 24 or 48 MP photo exceeds iOS Safari's ~16.7 MP canvas limit, so the canvas fails or comes out blank. On Android it costs 100–200 MB. `decodeFullSize` also decodes at full resolution before the 4096 px export cap applies.
- **Fix:** Cap at `EXPORT_MAX_SIDE` and decode with `createImageBitmap(file, { resizeWidth/resizeHeight })` straight to the needed size.

---

## Looks good (checked and found sound)

- **Coordinate spaces:**
  - `model/coords.ts` uses shorter-side units with y down.
  - Working → preview fixation scaling (`scaleFrame`) and working → full-size scaling (`scaleRenderParams`, plus the pipeline's internal rescale when the GPU forces a downscale) are consistent.
  - Lenses use √(sx·sy) for radii.
  - Map pixel centres `(i+0.5)·W/mapW` match the shader's `gl_FragCoord/uSize` sampling with LINEAR filtering.
- **Rotation sign:** clockwise-on-screen everywhere. The ellipse sampler, `lensRadius`, the shader `applyLenses`, `ellipseAxes`/handles and SVG `rotate()` all agree.
- **Effect-map channel layout:** `EFFECT_MAP_A` (blur/40, distortion, contrast, dimming) and `EFFECT_MAP_B` (dark spot, fill-in, colour fade, double image) match `effectMaps.ts` and the shader (`A.r/g/b/a`, `B.r/g/b/a`, and `FILL_WEIGHT_FRAG` reading `B.g`). Overlaps combine with max, and hidden regions are skipped.
- **Effect semantics vs F4:**
  - Blur is a Gaussian σ in reference px at a 768 px shorter side.
  - Dark spot shade runs from grey to black.
  - Missing area uses a push-pull fill with no dark patch.
  - Contrast, dimming, colour fade and ghost offset/opacity all behave as specified, and size change applies to ellipses only (D7).
- **Preview vs export:** blur, distortion amplitude and wavelength, ghost offset and fill sigma are all resolution-independent, and the pyramid plan keeps kernels inside `MAX_KERNEL_PAIRS` at both 1024 px and 4096 px.
- **WebGL resource handling:**
  - The export context is disposed and lost after each export.
  - Pyramid and fill targets are freed on `setSource`.
  - Context loss and restore re-upload the last source and reset the maps.
  - The WebGL2 probe context is released.
- **Undo/redo:** 100 steps (F9 needs ≥ 50). Slider, handle and path drags and brush strokes each coalesce into one step with `endEdit()` on release. Undo and redo break chains, `resetProfile` clears history, and no-op edits are dropped.
- **Map worker:** the latest-wins queue, stale-generation drop on image change, mask re-send only on Map identity change, transferable result buffers, and the permanent sync fallback on worker error are all sound.
- **Mask cache:** dataUrl-keyed, with recency trimming, primed after strokes so undo and redo are instant, and the previous data shown while a decode is pending.
- **Storage:**
  - Profile delete and photo delete happen in one transaction.
  - A failed open is not cached.
  - Errors are mapped to friendly messages.
  - Import handles BOM, bundle versions and id collisions (fresh id plus warning) and validates every profile.
  - Duplicate region ids are re-issued.
  - Future versions are rejected.
- **Privacy:**
  - No `fetch`, XHR, beacons, WebSockets, external fonts or CDNs in `src/` or the built bundle; the only URLs are the SVG/MathML namespace strings.
  - The service worker (`dist/sw.js`) precaches only build assets, icons and the manifest, and has only a navigation fallback route with no runtime caching.
  - Photos are stored only through "Save photo with this profile".
  - Images leave the device only through user-initiated share or download.
  - Object URLs are revoked in `share.ts`, `image/load.ts` and the timeline.
- **Requirements present:** HEIC where the browser decodes it (F1), built-in test images (F1), the draggable crosshair (F2), all four shape types with duplicate, hide, reorder and delete (F3), every F4 effect, the calibration guide with flip and saved distance (F5), wipe, side-by-side and present modes (F6), PNG/JPEG export with captions, side-by-side export and share-or-download (F7), dated profiles with duplicate-as-check-up, timeline and JSON single and bundle import/export (F8), and undo/redo (F9). The approximation note is shown in the footer, in present mode, in captions and on the timeline image.

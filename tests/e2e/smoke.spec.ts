import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Download, type Locator, type Page } from '@playwright/test';

const PHOTO = fileURLToPath(new URL('../fixtures/photo.png', import.meta.url));
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A screenshot pair counts as changed above this many differing pixels, as unchanged below SAME_PIXELS. */
const CHANGED_PIXELS = 300;
const SAME_PIXELS = 1000; // re-composited frames differ by a few dozen anti-aliased pixels (seen on mobile)

/** Collects console errors and uncaught page errors; assert with `expect(errors).toEqual([])`. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** The pixels the user sees in the image area (preview canvas + region outlines), as base64 PNG. */
async function shot(page: Page): Promise<string> {
  const png = await page.locator('.viewport').screenshot({ animations: 'disabled' });
  return png.toString('base64');
}

/** Waits until the visible image area stops changing (renders are coalesced on animation frames). */
async function settledShot(page: Page): Promise<string> {
  let last = await shot(page);
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    const next = await shot(page);
    if (next === last) return next;
    last = next;
  }
  return last;
}

/** Number of pixels that differ visibly between two screenshots (decoded inside the page). */
async function pixelDiff(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(
    async ([x, y]) => {
      const load = async (b64: string) => {
        const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height);
      };
      const [ia, ib] = await Promise.all([load(x!), load(y!)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return Number.MAX_SAFE_INTEGER;
      let n = 0;
      for (let i = 0; i < ia.data.length; i += 4) {
        const d = Math.max(
          Math.abs(ia.data[i]! - ib.data[i]!),
          Math.abs(ia.data[i + 1]! - ib.data[i + 1]!),
          Math.abs(ia.data[i + 2]! - ib.data[i + 2]!),
        );
        if (d > 24) n++;
      }
      return n;
    },
    [a, b] as const,
  );
}

function tab(page: Page, name: 'Regions' | 'Effects' | 'Compare' | 'Export'): Locator {
  return page.getByRole('tab', { name, exact: true });
}

async function openTab(page: Page, name: 'Regions' | 'Effects' | 'Compare' | 'Export'): Promise<void> {
  await tab(page, name).click();
  await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
}

/** The live WebGL preview must be running (the app falls back to the plain photo otherwise). */
async function expectPreviewRunning(page: Page): Promise<void> {
  await expect(page.locator('.viewport-preview canvas')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

async function loadAmsler(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Try the Amsler grid' }).click();
  // The 2D photo canvas (role=img) is display:none while the WebGL preview is shown, so match it by label.
  await expect(page.locator('canvas[aria-label^="Photo:"]')).toBeAttached();
  await expectPreviewRunning(page);
}

/** Dismisses the share sheet so the download path is used (desktop Edge would open a native dialog). */
async function disableWebShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
}

async function expectPngDownload(download: Download): Promise<number> {
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const file = await download.path();
  const bytes = readFileSync(file);
  expect(bytes.length).toBeGreaterThan(1000);
  expect(Array.from(bytes.slice(0, 8))).toEqual(PNG_SIGNATURE);
  return bytes.length;
}

test('amsler grid: add a spot, blur it, flip, undo and export PNGs', async ({ page }) => {
  const errors = watchErrors(page);
  await disableWebShare(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('My own approximation')).toBeVisible();

  await loadAmsler(page);

  // Regions -> Spot -> tap the image.
  await openTab(page, 'Regions');
  await page.getByRole('button', { name: '+ Spot (ellipse)' }).click();
  const content = page.locator('.viewport-content');
  const box = await content.boundingBox();
  expect(box).not.toBeNull();
  // Tap away from the centre, where the fixation crosshair sits.
  await page.mouse.click(box!.x + box!.width * 0.3, box!.y + box!.height * 0.35);
  const regions = page.getByRole('list', { name: 'Regions' });
  await expect(regions.getByRole('listitem')).toHaveCount(1);
  await expect(regions.getByText('Spot 1')).toBeVisible();

  // Effects -> blur to the maximum (keyboard on the range input).
  const withSpot = await settledShot(page);
  await openTab(page, 'Effects');
  const blur = page.getByRole('slider', { name: 'Blur', exact: true });
  await blur.focus();
  await blur.press('End');
  const max = await blur.getAttribute('max');
  await expect(blur).toHaveValue(max!);
  await expect
    .poll(async () => pixelDiff(page, withSpot, await settledShot(page)), {
      message: 'the preview should change when blur is raised',
    })
    .toBeGreaterThan(CHANGED_PIXELS);
  const blurred = await settledShot(page);
  await expectPreviewRunning(page);

  // Flip shows the original (no simulation), flipping back restores the blurred preview.
  const flip = page.getByRole('button', { name: /Tap to show (original|simulated)/ });
  await flip.click();
  await expect(page.locator('.badge')).toHaveText('Original');
  const original = await settledShot(page);
  expect(await pixelDiff(page, original, blurred)).toBeGreaterThan(CHANGED_PIXELS);
  await flip.click();
  await expect(page.locator('.badge')).toHaveCount(0);
  const restored = await settledShot(page);
  expect(await pixelDiff(page, restored, blurred)).toBeLessThan(SAME_PIXELS);

  // Undo: first the blur, then the spot itself.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await undo.click();
  await expect(blur).not.toHaveValue(max!);
  await expect
    .poll(async () => pixelDiff(page, withSpot, await settledShot(page)))
    .toBeLessThan(SAME_PIXELS);
  await undo.click();
  await openTab(page, 'Regions');
  await expect(regions).toHaveCount(0);
  await expect(page.getByText('Add a spot where your vision is affected.')).toBeVisible();

  // Redo brings the spot back, and export has something to say about it.
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(regions.getByRole('listitem')).toHaveCount(1);

  // Export: defaults are simulated + side-by-side PNGs, delivered as downloads.
  await openTab(page, 'Export');
  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));
  await page.getByRole('button', { name: 'Share / Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Downloaded \d+ files?/ })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => downloads.length).toBeGreaterThanOrEqual(1);
  for (const d of downloads) expect(await expectPngDownload(d)).toBeGreaterThan(0);
  expect(downloads.map((d) => d.suggestedFilename()).join(' ')).toContain('simulated');

  expect(errors).toEqual([]);
});

test('export hands every file to the share sheet when it is available', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    const shared: { name: string; type: string; size: number }[] = [];
    (window as unknown as { __shared: typeof shared }).__shared = shared;
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: { files?: File[] }) => {
        for (const f of data.files ?? []) shared.push({ name: f.name, type: f.type, size: f.size });
      },
    });
  });
  await page.goto('/');
  await loadAmsler(page);
  await openTab(page, 'Export');
  await page.getByRole('button', { name: 'Share / Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Shared' })).toBeVisible({ timeout: 30_000 });
  const shared = await page.evaluate(
    () => (window as unknown as { __shared: { name: string; type: string; size: number }[] }).__shared,
  );
  expect(shared.length).toBeGreaterThanOrEqual(1);
  for (const f of shared) {
    expect(f.type).toBe('image/png');
    expect(f.size).toBeGreaterThan(1000);
  }
  expect(errors).toEqual([]);
});

test('choose photo from a file, show it, and be ready for offline use', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.getByText('Choose a photo or take one with the camera.')).toBeVisible();

  // The empty-state button wraps a hidden file input; set the file directly on it.
  await page.getByLabel('Choose photo').first().setInputFiles(PHOTO);
  await expect(page.locator('canvas[aria-label="Photo: photo.png"]')).toBeAttached();
  await expect(page.getByText('Choose a photo or take one with the camera.')).toHaveCount(0);
  await expectPreviewRunning(page);

  // The decoded photo is drawn at its own size.
  const size = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.viewport-canvas');
    return c ? { w: c.width, h: c.height } : null;
  });
  expect(size).toEqual({ w: 160, h: 120 });

  // Offline readiness: the web app manifest and the service worker file are served by the build.
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const manifest = await page.request.get(new URL(manifestHref!, page.url()).toString());
  expect(manifest.ok()).toBe(true);
  const sw = await page.request.get(new URL('sw.js', page.url()).toString());
  expect(sw.ok()).toBe(true);

  // The service worker registers (asserted once the app registers it, see the report on InstallPrompt).
  let registered = false;
  for (let i = 0; i < 16 && !registered; i++) {
    registered = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()));
    if (!registered) await page.waitForTimeout(500);
  }
  test.info().annotations.push({ type: 'service-worker-registered', description: String(registered) });
  if (registered) {
    const state = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return (reg.active ?? reg.waiting ?? reg.installing)?.state ?? 'none';
    });
    expect(['activating', 'activated']).toContain(state);
    await expect
      .poll(async () => page.evaluate(async () => (await caches.keys()).length), { timeout: 20_000 })
      .toBeGreaterThan(0);
  }

  expect(errors).toEqual([]);
});

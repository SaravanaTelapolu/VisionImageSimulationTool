// Records one short clip per feature (phone layout) plus a few still screenshots, for the Help page
// and the README. Not part of the test suite: run with `npm run help:capture`.
// Every clip shows a fake finger (the headless browser draws no pointer) and a caption per step;
// make-gifs.mjs turns the clips into captioned GIFs in public/help/media/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

const OUT = fileURLToPath(new URL('./out/', import.meta.url));
const MEDIA = fileURLToPath(new URL('../../public/help/media/', import.meta.url));
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

mkdirSync(OUT, { recursive: true });
mkdirSync(MEDIA, { recursive: true });

/** Draws a finger dot that follows the pointer and ripples on each press (recorded with the page). */
function fingerScript(): void {
  const css = `
    .__finger{position:fixed;left:0;top:0;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;
      border:3px solid rgba(255,255,255,.95);background:rgba(0,0,0,.25);box-shadow:0 0 0 2px rgba(0,0,0,.6);
      pointer-events:none;z-index:2147483647;transition:background .08s,transform .08s;opacity:0}
    .__finger.down{background:rgba(255,213,74,.85);transform:scale(.8)}
    .__ripple{position:fixed;width:60px;height:60px;margin:-30px 0 0 -30px;border-radius:50%;
      border:3px solid #ffd54a;pointer-events:none;z-index:2147483646;animation:__r .5s ease-out forwards}
    @keyframes __r{from{transform:scale(.3);opacity:1}to{transform:scale(1.2);opacity:0}}
    .pwa-toast{display:none!important}`;
  const install = () => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const dot = document.createElement('div');
    dot.className = '__finger';
    document.body.appendChild(dot);
    const at = (e: PointerEvent) => {
      dot.style.opacity = '1';
      dot.style.left = `${e.clientX}px`;
      dot.style.top = `${e.clientY}px`;
    };
    window.addEventListener('pointermove', at, true);
    window.addEventListener(
      'pointerdown',
      (e) => {
        at(e);
        dot.classList.add('down');
        const r = document.createElement('div');
        r.className = '__ripple';
        r.style.left = `${e.clientX}px`;
        r.style.top = `${e.clientY}px`;
        document.body.appendChild(r);
        setTimeout(() => r.remove(), 600);
      },
      true,
    );
    window.addEventListener('pointerup', () => dot.classList.remove('down'), true);
  };
  if (document.body) install();
  else document.addEventListener('DOMContentLoaded', install);
}

/** No share sheet, so Export ends in a plain Download (a native dialog would not record). */
function noShareScript(): void {
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
}

class Clip {
  readonly captions: { at: number; text: string }[] = [];
  private t0 = 0;
  private start = 0;
  constructor(
    readonly name: string,
    readonly context: BrowserContext,
    readonly page: Page,
  ) {}

  static async open(browser: Browser, name: string, viewport = PHONE): Promise<Clip> {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      recordVideo: { dir: `${OUT}tmp`, size: viewport },
      acceptDownloads: true,
    });
    await context.addInitScript(fingerScript);
    await context.addInitScript(noShareScript);
    const page = await context.newPage();
    const clip = new Clip(name, context, page);
    clip.t0 = Date.now();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    return clip;
  }

  private now(): number {
    return (Date.now() - this.t0) / 1000;
  }

  /** The clip starts here; everything before is set-up and is cut. */
  async begin(text: string): Promise<void> {
    await this.page.waitForTimeout(400);
    this.start = this.now();
    this.cap(text);
    await this.page.waitForTimeout(900);
  }

  cap(text: string): void {
    this.captions.push({ at: this.now(), text });
  }

  async pause(ms = 700): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  async moveTo(x: number, y: number, steps = 14): Promise<void> {
    await this.page.mouse.move(x, y, { steps });
  }

  async tapAt(x: number, y: number): Promise<void> {
    await this.moveTo(x, y);
    await this.pause(150);
    await this.page.mouse.down();
    await this.pause(110);
    await this.page.mouse.up();
    await this.pause(350);
  }

  async tap(target: Locator): Promise<void> {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error(`${this.name}: nothing to tap`);
    await this.tapAt(box.x + box.width / 2, box.y + box.height / 2);
  }

  async drag(from: { x: number; y: number }, to: { x: number; y: number }, steps = 24): Promise<void> {
    await this.moveTo(from.x, from.y);
    await this.pause(150);
    await this.page.mouse.down();
    await this.page.mouse.move(to.x, to.y, { steps });
    await this.pause(120);
    await this.page.mouse.up();
    await this.pause(300);
  }

  /** Drags a range input's thumb to `value`. */
  async slide(slider: Locator, value: number): Promise<void> {
    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    if (!box) throw new Error(`${this.name}: slider not visible`);
    const [min, max, cur] = await slider.evaluate((el: HTMLInputElement) => [Number(el.min), Number(el.max), Number(el.value)]);
    const thumb = 10; // half the thumb width: the thumb centre travels between box.x + thumb and box.right - thumb
    const xOf = (v: number) => box.x + thumb + ((v - min) / (max - min)) * (box.width - 2 * thumb);
    const y = box.y + box.height / 2;
    await this.drag({ x: xOf(cur), y }, { x: xOf(value), y }, 30);
    // A drag can miss the thumb when the panel scrolls under it; set the value so the clip still ends right.
    const now = await slider.evaluate((el: HTMLInputElement) => Number(el.value));
    if (Math.abs(now - value) > (max - min) * 0.1) await slider.fill(String(value));
  }

  /** Centre of the photo area, and a point at fractions (fx, fy) of it. */
  async imagePoint(fx: number, fy: number): Promise<{ x: number; y: number }> {
    const box = await this.page.locator('.viewport-content').boundingBox();
    if (!box) throw new Error('no image');
    return { x: box.x + box.width * fx, y: box.y + box.height * fy };
  }

  async end(holdMs = 1800): Promise<void> {
    await this.pause(holdMs);
    const end = this.now();
    const video = this.page.video();
    await this.context.close();
    if (video) await video.saveAs(`${OUT}${this.name}.webm`);
    writeFileSync(`${OUT}${this.name}.json`, JSON.stringify({ start: this.start, end, captions: this.captions }, null, 2));
  }
}

// --- helpers on app state (fast set-up before a clip begins) -------------------------------

async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name, exact: true }).click();
}

async function loadTestImage(page: Page, id: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Load a test image' }).first().selectOption(id);
  await expect(page.locator('.viewport-preview canvas')).toHaveCount(1);
  await page.waitForTimeout(500);
}

async function addSpot(clip: Clip, fx: number, fy: number, fast = false): Promise<void> {
  const page = clip.page;
  await openTab(page, 'Regions');
  const btn = page.getByRole('button', { name: '+ Spot (ellipse)' });
  const at = await clip.imagePoint(fx, fy);
  if (fast) {
    await btn.click();
    await page.mouse.click(at.x, at.y);
  } else {
    await clip.tap(btn);
    await clip.tapAt(at.x, at.y);
  }
}

/** Opens the bottom sheet fully (phone layout), so long panels are visible. */
async function expandSheet(clip: Clip, animate = true): Promise<void> {
  const btn = clip.page.getByRole('button', { name: 'Expand panel' });
  if (!(await btn.count())) return;
  if (animate) await clip.tap(btn);
  else await btn.click();
  await clip.pause(400);
}

function slider(page: Page, label: string): Locator {
  return page.getByRole('slider', { name: label, exact: true });
}

async function handle(page: Page, name: string): Promise<{ x: number; y: number }> {
  const box = await page.getByRole('application', { name }).boundingBox();
  if (!box) throw new Error(`no handle ${name}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// --- clips --------------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test('01-start', async ({ browser }) => {
  const clip = await Clip.open(browser, '01-start');
  const page = clip.page;
  await clip.begin('Open a photo or the camera');
  await clip.moveTo(120, 460);
  await clip.moveTo(270, 460);
  await clip.pause(500);
  clip.cap('…or try a built-in test image');
  const pick = page.getByRole('combobox', { name: 'Load a test image' }).first();
  const box = (await pick.boundingBox())!;
  await clip.tapAt(box.x + box.width / 2, box.y + box.height / 2);
  await pick.selectOption('street');
  await expect(page.locator('.viewport-preview canvas')).toHaveCount(1);
  await clip.pause(900);
  clip.cap('The crosshair = where you look');
  const c = await clip.imagePoint(0.5, 0.5);
  await clip.moveTo(c.x + 40, c.y + 40);
  await clip.end(2200);
});

test('02-spot', async ({ browser }) => {
  const clip = await Clip.open(browser, '02-spot');
  const page = clip.page;
  await loadTestImage(page, 'reading');
  await openTab(page, 'Regions');
  await clip.begin('Regions → + Spot');
  await clip.tap(page.getByRole('button', { name: '+ Spot (ellipse)' }));
  clip.cap('Tap where vision is affected');
  const at = await clip.imagePoint(0.4, 0.33);
  await clip.tapAt(at.x, at.y);
  // Give the new spot a visible effect so its outline and result show.
  await openTab(page, 'Effects');
  await slider(page, 'Blur').fill('25');
  await openTab(page, 'Regions');
  await clip.pause(600);
  clip.cap('Drag the middle to move it');
  let h = await handle(page, 'Move the ellipse');
  await clip.drag(h, { x: h.x + 30, y: h.y + 20 });
  clip.cap('Yellow dots change the size');
  h = await handle(page, 'Change the ellipse width');
  await clip.drag(h, { x: h.x + 35, y: h.y });
  h = await handle(page, 'Change the ellipse height');
  await clip.drag(h, { x: h.x, y: h.y + 25 });
  clip.cap('Blue dot rotates it');
  h = await handle(page, 'Rotate the ellipse');
  await clip.drag(h, { x: h.x + 35, y: h.y + 15 });
  await clip.end();
});

test('03-effects', async ({ browser }) => {
  const clip = await Clip.open(browser, '03-effects');
  const page = clip.page;
  await loadTestImage(page, 'reading');
  await addSpot(clip, 0.42, 0.38, true);
  // A bigger spot reads better in a small animation.
  for (const [name, dx, dy] of [['Change the ellipse width', 40, 0], ['Change the ellipse height', 0, 30]] as const) {
    const h = await handle(page, name);
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + dx, h.y + dy, { steps: 4 });
    await page.mouse.up();
  }
  await openTab(page, 'Regions');
  await clip.begin('Effects tab: one slider per effect');
  await clip.tap(page.getByRole('tab', { name: 'Effects', exact: true }));
  clip.cap('Blur: out of focus');
  await clip.slide(slider(page, 'Blur'), 30);
  clip.cap('Dark spot: a dark patch');
  await clip.slide(slider(page, 'Dark spot'), 0.8);
  clip.cap('Dark spot shade: black to grey');
  await clip.slide(slider(page, 'Dark spot shade'), 0.45);
  clip.cap('Distortion: wavy lines');
  await clip.slide(slider(page, 'Distortion'), 0.8);
  clip.cap('Flip: original / simulated');
  const flip = page.getByRole('toolbar', { name: 'Quick actions' }).getByRole('button', { name: /Tap to show/ });
  await clip.tap(flip);
  await clip.pause(900);
  await clip.tap(flip);
  await clip.end();
});

test('04-freehand', async ({ browser }) => {
  const clip = await Clip.open(browser, '04-freehand');
  const page = clip.page;
  await loadTestImage(page, 'amsler');
  await openTab(page, 'Regions');
  await clip.begin('Regions → Freehand');
  await clip.tap(page.getByRole('button', { name: 'Freehand' }));
  clip.cap('Draw around the area');
  const c = await clip.imagePoint(0.5, 0.5);
  const r = (await page.locator('.viewport-content').boundingBox())!.width * 0.2;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const k = 1 + 0.25 * Math.sin(3 * a);
    pts.push({ x: c.x + 0.25 * r + Math.cos(a) * r * k, y: c.y - 0.2 * r + Math.sin(a) * r * 0.8 * k });
  }
  await clip.moveTo(pts[0]!.x, pts[0]!.y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.up();
  await clip.pause(600);
  clip.cap('Then pick its effects');
  await clip.tap(page.getByRole('tab', { name: 'Effects', exact: true }));
  await clip.slide(slider(page, 'Distortion'), 1);
  await clip.slide(slider(page, 'Blur'), 12);
  await clip.end();
});

test('05-brush', async ({ browser }) => {
  const clip = await Clip.open(browser, '05-brush');
  const page = clip.page;
  await loadTestImage(page, 'street');
  await openTab(page, 'Regions');
  await clip.begin('Regions → Brush');
  await clip.tap(page.getByRole('button', { name: 'Brush' }));
  clip.cap('Set the brush size');
  await clip.slide(slider(page, 'Brush size'), 0.16);
  clip.cap('Paint patchy areas');
  const strokes = [
    [0.55, 0.3, 0.7, 0.36],
    [0.58, 0.42, 0.74, 0.47],
    [0.62, 0.55, 0.68, 0.6],
  ] as const;
  for (const [x1, y1, x2, y2] of strokes) {
    const a = await clip.imagePoint(x1, y1);
    const b = await clip.imagePoint(x2, y2);
    await clip.drag(a, b, 20);
  }
  clip.cap('Done, then choose effects');
  await clip.tap(page.getByRole('button', { name: 'Done' }).first());
  await clip.tap(page.getByRole('tab', { name: 'Effects', exact: true }));
  await slider(page, 'Dark spot').scrollIntoViewIfNeeded();
  await clip.pause(500);
  await clip.slide(slider(page, 'Dark spot'), 0.85);
  await clip.end();
});

test('06-compare', async ({ browser }) => {
  const clip = await Clip.open(browser, '06-compare');
  const page = clip.page;
  await loadTestImage(page, 'street');
  await addSpot(clip, 0.45, 0.45, true);
  await openTab(page, 'Effects');
  await slider(page, 'Blur').fill('40');
  await slider(page, 'Dark spot').fill('0.6');
  await openTab(page, 'Regions');
  await clip.begin('Compare tab');
  await clip.tap(page.getByRole('tab', { name: 'Compare', exact: true }));
  clip.cap('Wipe: drag the divider');
  await clip.tap(page.getByRole('radio', { name: 'Wipe' }));
  await clip.pause(500);
  const l = await clip.imagePoint(0.2, 0.5);
  const m = await clip.imagePoint(0.5, 0.5);
  const rr = await clip.imagePoint(0.8, 0.5);
  await clip.drag(m, l, 25);
  await clip.drag(l, rr, 40);
  await clip.drag(rr, m, 25);
  clip.cap('Side by side');
  await clip.tap(page.getByRole('radio', { name: 'Side by side' }));
  await clip.pause(1500);
  clip.cap('Present full screen for the doctor');
  await clip.tap(page.getByRole('button', { name: 'Present full screen' }));
  await clip.pause(1200);
  clip.cap('Tap to switch views');
  await clip.tapAt(PHONE.width / 2, PHONE.height / 2);
  await clip.pause(1000);
  await clip.tapAt(PHONE.width / 2, PHONE.height / 2);
  await clip.end(1500);
});

test('07-calibration', async ({ browser }) => {
  const clip = await Clip.open(browser, '07-calibration');
  const page = clip.page;
  await clip.begin('More menu → Calibration guide');
  await clip.tap(page.getByRole('button', { name: 'More options', exact: true }));
  await clip.tap(page.getByRole('button', { name: 'Calibration guide', exact: true }));
  const next = page.locator('.cal-footer').getByRole('button', { name: 'Next' });
  for (let i = 0; i < 6; i++) {
    const title = (await page.locator('#cal-title').textContent()) ?? '';
    clip.cap(title.length > 34 ? `${title.slice(0, 33)}…` : title);
    await clip.pause(1400);
    if (!(await next.isVisible())) break;
    await clip.tap(next);
  }
  await clip.end(1200);
});

test('08-export', async ({ browser }) => {
  const clip = await Clip.open(browser, '08-export');
  const page = clip.page;
  await loadTestImage(page, 'street');
  await addSpot(clip, 0.45, 0.45, true);
  await openTab(page, 'Effects');
  await slider(page, 'Blur').fill('40');
  await slider(page, 'Dark spot').fill('0.6');
  await clip.begin('Export tab');
  await clip.tap(page.getByRole('tab', { name: 'Export', exact: true }));
  await expandSheet(clip);
  clip.cap('Choose what to save');
  await clip.pause(1500);
  clip.cap('Prepare images');
  await clip.tap(page.getByRole('button', { name: 'Prepare images' }));
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible({ timeout: 60_000 });
  clip.cap('Then Share or Download');
  await clip.tap(page.getByRole('button', { name: 'Download', exact: true }));
  await clip.end(2000);
});

test('09-profiles', async ({ browser }) => {
  const clip = await Clip.open(browser, '09-profiles');
  const page = clip.page;
  await loadTestImage(page, 'amsler');
  await addSpot(clip, 0.4, 0.4, true);
  await openTab(page, 'Effects');
  await slider(page, 'Blur').fill('20');
  await slider(page, 'Dark spot').fill('0.7');
  await openTab(page, 'Regions');
  await clip.begin('Profiles tab');
  await clip.tap(page.getByRole('tab', { name: 'Profiles', exact: true }));
  await expandSheet(clip);
  clip.cap('Pick the affected eye');
  await clip.tap(page.getByRole('radio', { name: 'Left' }).first());
  await clip.pause(700);
  clip.cap('Save keeps it on this device');
  await clip.tap(page.getByRole('button', { name: 'Save', exact: true }));
  await clip.pause(800);
  clip.cap('New check-up: a dated copy');
  await clip.tap(page.getByRole('button', { name: /New check-up/ }));
  await clip.pause(1000);
  clip.cap('Compare over time');
  await clip.tap(page.getByRole('button', { name: 'Compare over time' }));
  await expect(page.getByText('Drawing…')).toHaveCount(0, { timeout: 60_000 });
  await clip.end(2500);
});

// --- stills -------------------------------------------------------------------------------

test('stills', async ({ browser }) => {
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    const hide = () => {
      const st = document.createElement('style');
      st.textContent = '.pwa-toast{display:none!important}';
      document.head.appendChild(st);
    };
    if (document.head) hide();
    else document.addEventListener('DOMContentLoaded', hide);
  });
  const page = await context.newPage();
  await page.goto('/');
  await loadTestImage(page, 'street');
  await openTab(page, 'Regions');
  await page.getByRole('button', { name: '+ Spot (ellipse)' }).click();
  const box = (await page.locator('.viewport-content').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.47, box.y + box.height * 0.42);
  for (const [name, dx, dy] of [['Change the ellipse width', 60, 0], ['Change the ellipse height', 0, 45]] as const) {
    const h = await handle(page, name);
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + dx, h.y + dy, { steps: 4 });
    await page.mouse.up();
  }
  await openTab(page, 'Effects');
  await slider(page, 'Blur').fill('30');
  await slider(page, 'Dark spot').fill('0.7');
  await slider(page, 'Distortion').fill('0.6');
  await slider(page, 'Blur').scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${MEDIA}desktop-editing.png` });
  await openTab(page, 'Compare');
  await page.getByRole('radio', { name: 'Side by side' }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${MEDIA}desktop-side-by-side.png` });
  await context.close();
});

// Dev harness for the WebGL renderer (served at /dev/render-harness.html by `npx vite`).
// Builds its own test image and effect maps so it does not depend on other modules.
import { MAX_BLUR_PX, MAX_SIZE_CHANGE } from '../../model/types';
import { defaultGlobals } from '../../model/defaults';
import type { ProfileGlobals } from '../../model/types';
import type { EffectMaps, RenderParams, SizeChangeLens } from '../types';
import { createRenderer, isWebGL2Supported, type WebGLRenderer } from '../createRenderer';
import { lensWeight, scaleRenderParams } from '../gl/math';

interface State {
  size: number; // long side of the test image
  whole: boolean;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation: number; // degrees
  feather: number;
  blur: number;
  darkSpot: number;
  fillIn: number;
  distortion: number;
  sizeChange: number;
  contrastLoss: number;
  dimming: number;
  colourFade: number;
  doubleImage: number;
  globals: ProfileGlobals;
  bypass: boolean;
  fix: { x: number; y: number } | null; // fraction of width/height; null = centre
}

const state: State = {
  size: 1024,
  whole: false,
  cx: 0,
  cy: 0,
  rx: 0.18,
  ry: 0.12,
  rotation: 0,
  feather: 0.4,
  blur: 0,
  darkSpot: 0,
  fillIn: 0,
  distortion: 0,
  sizeChange: 0,
  contrastLoss: 0,
  dimming: 0,
  colourFade: 0,
  doubleImage: 0,
  globals: defaultGlobals(),
  bypass: false,
  fix: null,
};

// ---------------------------------------------------------------- test image

function makeTestImage(longSide: number): HTMLCanvasElement {
  const W = longSide;
  const H = Math.round((longSide * 3) / 4);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const s = Math.min(W, H);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  // Amsler-style grid centred on the image.
  const step = s / 20;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(1, s / 500);
  ctx.beginPath();
  for (let x = W / 2 % step; x <= W; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H * 0.72);
  }
  for (let y = H / 2 % step; y <= H * 0.72; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, s / 120, 0, Math.PI * 2);
  ctx.fill();

  // Text at several sizes.
  ctx.fillStyle = '#111';
  ctx.textBaseline = 'top';
  const sizes = [0.018, 0.026, 0.038, 0.055];
  let ty = H * 0.035;
  for (const fs of sizes) {
    ctx.font = `${Math.round(fs * s)}px Georgia, serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const text = 'The quick brown fox jumps over the lazy dog 0123456789';
    ctx.fillRect(W * 0.03, ty - 2, ctx.measureText(text).width + 8, fs * s * 1.25);
    ctx.fillStyle = '#111';
    ctx.fillText(text, W * 0.03 + 4, ty);
    ty += fs * s * 1.5;
  }

  // Colour bars.
  const bars = ['#ff0000', '#ff9900', '#ffff00', '#00cc00', '#00ccff', '#0033ff', '#9900ff', '#ff66cc'];
  const bw = W / bars.length;
  bars.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(i * bw, H * 0.74, bw + 1, H * 0.13);
  });
  // Grey ramp.
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#000');
  g.addColorStop(1, '#fff');
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.87, W, H * 0.13);

  // A couple of coloured discs near the centre (to see colour fade and fill-in).
  const disc = (x: number, y: number, r: number, col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  disc(W * 0.62, H * 0.42, s * 0.05, '#e33');
  disc(W * 0.4, H * 0.58, s * 0.04, '#33c');
  return c;
}

// ---------------------------------------------------------------- effect maps

function fixationPx(W: number, H: number): { x: number; y: number } {
  return state.fix ? { x: state.fix.x * W, y: state.fix.y * H } : { x: W / 2, y: H / 2 };
}

/** Feathered region weight at image pixel (x, y); same profile as the lens weight. */
function regionWeight(x: number, y: number, W: number, H: number): number {
  if (state.whole) return 1;
  const s = Math.min(W, H);
  const f = fixationPx(W, H);
  const dx = (x - f.x) / s - state.cx;
  const dy = (y - f.y) / s - state.cy;
  const a = (state.rotation * Math.PI) / 180;
  const u = (Math.cos(a) * dx + Math.sin(a) * dy) / state.rx;
  const v = (-Math.sin(a) * dx + Math.cos(a) * dy) / state.ry;
  return lensWeight(Math.hypot(u, v), state.feather);
}

function buildMaps(W: number, H: number): EffectMaps {
  const long = Math.max(W, H);
  const mw = Math.max(1, Math.round((512 * W) / long));
  const mh = Math.max(1, Math.round((512 * H) / long));
  const a = new Uint8Array(mw * mh * 4);
  const b = new Uint8Array(mw * mh * 4);
  const c = new Uint8Array(mw * mh * 4).fill(0);
  const shade = Math.round(255 * Math.min(Math.max(state.globals.darkSpotShade, 0), 1));
  for (let i = 0; i < c.length; i += 4) c[i] = shade; // one region: its shade everywhere
  const ch = (v: number, w: number) => Math.round(255 * Math.min(Math.max(v * w, 0), 1));
  for (let j = 0; j < mh; j++) {
    for (let i = 0; i < mw; i++) {
      const w = regionWeight(((i + 0.5) / mw) * W, ((j + 0.5) / mh) * H, W, H);
      const o = (j * mw + i) * 4;
      if (w <= 0) continue;
      a[o] = ch(state.blur / MAX_BLUR_PX, w);
      a[o + 1] = ch(state.distortion, w);
      a[o + 2] = ch(state.contrastLoss, w);
      a[o + 3] = ch(state.dimming, w);
      b[o] = ch(state.darkSpot, w);
      b[o + 1] = ch(state.fillIn, w);
      b[o + 2] = ch(state.colourFade, w);
      b[o + 3] = ch(state.doubleImage, w);
    }
  }
  return { width: mw, height: mh, a, b, c };
}

function buildLenses(W: number, H: number): SizeChangeLens[] {
  if (state.whole || state.sizeChange === 0) return [];
  const s = Math.min(W, H);
  const f = fixationPx(W, H);
  return [
    {
      cx: f.x + state.cx * s,
      cy: f.y + state.cy * s,
      rx: state.rx * s,
      ry: state.ry * s,
      rotation: (state.rotation * Math.PI) / 180,
      amount: state.sizeChange,
      feather: state.feather,
    },
  ];
}

// ---------------------------------------------------------------- app

const statsEl = document.getElementById('stats') as HTMLDivElement;
const panel = document.getElementById('panel') as HTMLDivElement;
const host = document.getElementById('canvasHost') as HTMLDivElement;
const exportOut = document.getElementById('exportOut') as HTMLDivElement;

if (!isWebGL2Supported()) {
  statsEl.textContent = 'WebGL2 is not supported in this browser.';
  throw new Error('WebGL2 unsupported');
}

const renderer: WebGLRenderer = createRenderer();
host.appendChild(renderer.canvas);

let image = makeTestImage(state.size);
let maps: EffectMaps = buildMaps(image.width, image.height);
let mapsDirty = false;
let setSourceMs = 0;
const times: number[] = [];
let lastMs = 0;

function loadImage(): void {
  image = makeTestImage(state.size);
  const t0 = performance.now();
  renderer.setSource(image, image.width, image.height);
  renderer.finish();
  setSourceMs = performance.now() - t0;
  mapsDirty = true;
  times.length = 0;
}

function params(): RenderParams {
  return {
    maps,
    globals: state.globals,
    lenses: buildLenses(image.width, image.height),
    fixation: fixationPx(image.width, image.height),
    bypass: state.bypass,
  };
}

function renderNow(): number {
  if (mapsDirty) {
    maps = buildMaps(image.width, image.height);
    mapsDirty = false;
  }
  const p = params();
  const t0 = performance.now();
  renderer.render(p);
  renderer.finish();
  const ms = performance.now() - t0;
  lastMs = ms;
  times.push(ms);
  if (times.length > 30) times.shift();
  showStats();
  return ms;
}

function showStats(extra = ''): void {
  const avg = times.length ? times.reduce((s, x) => s + x, 0) / times.length : 0;
  const info = renderer.sourceInfo;
  statsEl.textContent =
    `image ${image.width}x${image.height}  texture ${info?.width}x${info?.height}  maxTex ${renderer.maxTextureSize}\n` +
    `render ${lastMs.toFixed(1)} ms (avg ${avg.toFixed(1)} of ${times.length})  setSource ${setSourceMs.toFixed(1)} ms` +
    (renderer.contextLost ? '  CONTEXT LOST' : '') +
    (extra ? `\n${extra}` : '');
}

let queued = false;
function schedule(rebuildMaps: boolean): void {
  if (rebuildMaps) mapsDirty = true;
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    renderNow();
  });
}

// ---------------------------------------------------------------- controls

function heading(text: string): void {
  const h = document.createElement('h2');
  h.textContent = text;
  panel.appendChild(h);
}

function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  get: () => number,
  set: (v: number) => void,
  maps = true,
): void {
  const row = document.createElement('label');
  row.className = 'row';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(get());
  input.dataset.key = label;
  const out = document.createElement('output');
  out.textContent = String(get());
  input.addEventListener('input', () => {
    set(Number(input.value));
    out.textContent = input.value;
    schedule(maps);
  });
  row.append(span, input, out);
  panel.appendChild(row);
}

function checkbox(label: string, get: () => boolean, set: (v: boolean) => void, maps = true): void {
  const row = document.createElement('label');
  row.className = 'check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = get();
  input.dataset.key = label;
  input.addEventListener('change', () => {
    set(input.checked);
    schedule(maps);
  });
  row.append(input, document.createTextNode(label));
  panel.appendChild(row);
}

function button(label: string, onClick: () => void): void {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  panel.appendChild(b);
}

type NumKey = Exclude<
  { [K in keyof State]: State[K] extends number ? K : never }[keyof State],
  undefined
>;
const num = (k: NumKey, label: string, min: number, max: number, step: number, maps = true) =>
  slider(label, min, max, step, () => state[k], (v) => (state[k] = v), maps);

heading('View');
checkbox('bypass (original)', () => state.bypass, (v) => (state.bypass = v), false);
const sel = document.createElement('select');
for (const s of [512, 1024, 2048]) {
  const o = document.createElement('option');
  o.value = String(s);
  o.textContent = `test image ${s} px`;
  o.selected = s === state.size;
  sel.appendChild(o);
}
sel.addEventListener('change', () => {
  state.size = Number(sel.value);
  loadImage();
  schedule(true);
});
panel.appendChild(sel);
button('Benchmark x30', () => {
  times.length = 0;
  for (let i = 0; i < 30; i++) renderNow();
  const sorted = [...times].sort((a, b) => a - b);
  showStats(`benchmark median ${(sorted[15] ?? 0).toFixed(1)} ms, max ${(sorted[29] ?? 0).toFixed(1)} ms`);
});
button('Export 2x (PNG)', () => void runExport());
button('Reset effects', () => {
  for (const k of ['blur', 'darkSpot', 'fillIn', 'distortion', 'sizeChange', 'contrastLoss', 'dimming', 'colourFade', 'doubleImage'] as const)
    state[k] = 0;
  panel.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((i) => {
    const key = i.dataset.key ?? '';
    if (/^(blur|dark|missing|distortion|size|contrast|dimming|colour|double)/.test(key)) {
      i.value = '0';
      const out = i.nextElementSibling;
      if (out) out.textContent = '0';
    }
  });
  schedule(true);
});

heading('Region (shorter-side units from fixation)');
checkbox('whole image', () => state.whole, (v) => (state.whole = v));
num('cx', 'centre x', -0.6, 0.6, 0.01);
num('cy', 'centre y', -0.5, 0.5, 0.01);
num('rx', 'radius x', 0.02, 0.6, 0.01);
num('ry', 'radius y', 0.02, 0.6, 0.01);
num('rotation', 'rotation °', -180, 180, 1);
num('feather', 'feather', 0, 1, 0.01);

heading('Effects');
num('blur', 'blur px', 0, MAX_BLUR_PX, 0.5);
num('darkSpot', 'dark spot', 0, 1, 0.01);
num('fillIn', 'missing area', 0, 1, 0.01);
num('distortion', 'distortion', 0, 1, 0.01);
num('sizeChange', 'size change', -MAX_SIZE_CHANGE, MAX_SIZE_CHANGE, 0.01, false);
num('contrastLoss', 'contrast loss', 0, 1, 0.01);
num('dimming', 'dimming', 0, 1, 0.01);
num('colourFade', 'colour fade', 0, 1, 0.01);
num('doubleImage', 'double image', 0, 1, 0.01);

heading('Profile globals');
const gl = state.globals;
slider('wave size', 0.01, 0.3, 0.005, () => gl.distortWaveSize, (v) => (gl.distortWaveSize = v), false);
slider('wave angle °', 0, 180, 1, () => gl.distortAngle, (v) => (gl.distortAngle = v), false);
slider('max amplitude', 0, 0.06, 0.001, () => gl.distortMaxAmplitude, (v) => (gl.distortMaxAmplitude = v), false);
slider('ghost x', -0.05, 0.05, 0.001, () => gl.ghostOffset[0], (v) => (gl.ghostOffset = [v, gl.ghostOffset[1]]), false);
slider('ghost y', -0.05, 0.05, 0.001, () => gl.ghostOffset[1], (v) => (gl.ghostOffset = [gl.ghostOffset[0], v]), false);
// Per-region shade (map C) since v0.2; the harness has one region, so the old global field holds it.
slider('dark shade', 0, 1, 0.01, () => gl.darkSpotShade, (v) => (gl.darkSpotShade = v), true);

// Click / tap on the image moves the fixation point.
renderer.canvas.addEventListener('pointerdown', (e) => {
  const r = renderer.canvas.getBoundingClientRect();
  state.fix = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  schedule(true);
});

async function runExport(): Promise<void> {
  const big = makeTestImage(state.size * 2);
  const p = scaleRenderParams(params(), big.width / image.width);
  try {
    const blob = await renderer.exportFullSize(big, big.width, big.height, p, 'image/png');
    const info = renderer.lastExport;
    const url = URL.createObjectURL(blob);
    exportOut.innerHTML = '';
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'exported image';
    exportOut.appendChild(img);
    showStats(
      `export ${info?.width}x${info?.height} in ${info?.ms.toFixed(0)} ms, ${(blob.size / 1024).toFixed(0)} KB` +
        (info?.downscaled ? ' (downscaled to fit the GPU)' : ''),
    );
  } catch (err) {
    showStats(`export failed: ${String(err)}`);
  }
}

// Hooks for automated checks from the console.
const w = window as unknown as Record<string, unknown>;
w.__harness = { renderer, state, renderNow, schedule, loadImage, runExport };

loadImage();
renderNow();

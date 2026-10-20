// One-off icon generator: `node scripts/make-icons.mjs`
// Writes public/icons/*.png and public/icons/favicon.svg using only Node built-ins.
// Design: a stylised eye on a dark-blue background with a soft blurred patch over it.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// ---- PNG encoder (RGBA, 8-bit, no interlace) -------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Drawing -------------------------------------------------------------------------------
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const BG_TOP = hex(0x12306b);
const BG_BOTTOM = hex(0x061230);
const SCLERA = hex(0xf2f5fa);
const IRIS_EDGE = hex(0x1b4f93);
const IRIS_MID = hex(0x3d8be0);
const PUPIL = hex(0x03060f);
const RING = hex(0xffd54a);
const SMUDGE = hex(0x2a3550);

// Eye geometry in a [-1, 1] square, before scaling. The lens is the intersection of two circles.
function lens(a, b) {
  const r = (a * a + b * b) / (2 * b);
  const d = r - b;
  return (x, y) => Math.hypot(x, y + d) < r && Math.hypot(x, y - d) < r;
}
const inOuter = lens(0.82, 0.46);
const inInner = lens(0.775, 0.415);

/** Colour [r,g,b,a(0-255)] at (u,v) in [-1,1]. `s` scales the eye (smaller for maskable). */
function shade(u, v, { s, rounded }) {
  let col = mix(BG_TOP, BG_BOTTOM, (v + 1) / 2);
  let alpha = 1;
  if (rounded) {
    const rad = 0.36; // corner radius, in units of half-size
    const qx = Math.abs(u) - (1 - rad);
    const qy = Math.abs(v) - (1 - rad);
    if (Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) > rad) alpha = 0;
  }
  const x = u / s;
  const y = v / s;
  if (inOuter(x, y)) {
    col = RING;
    if (inInner(x, y)) {
      col = SCLERA;
      const irisR = 0.34;
      const dr = Math.hypot(x, y);
      if (dr < irisR) {
        col = mix(IRIS_MID, IRIS_EDGE, Math.pow(dr / irisR, 1.6));
        if (dr > irisR - 0.03) col = mix(col, IRIS_EDGE, 0.6);
        if (dr < 0.15) col = PUPIL;
        if (Math.hypot(x + 0.07, y + 0.08) < 0.045) col = [255, 255, 255];
      }
      // Soft blurred patch (the damaged region): a gaussian smudge right of centre.
      const g = Math.exp(-(((x - 0.22) / 0.3) ** 2 + ((y + 0.02) / 0.26) ** 2));
      col = mix(col, SMUDGE, g * 0.88);
    }
  }
  return [col[0], col[1], col[2], alpha * 255];
}

function render(size, opts) {
  const SS = 3; // supersampling per axis
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((px + (sx + 0.5) / SS) / size) * 2 - 1;
          const v = ((py + (sy + 0.5) / SS) / size) * 2 - 1;
          const c = shade(u, v, opts);
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        buf[i] = Math.round(r / a);
        buf[i + 1] = Math.round(g / a);
        buf[i + 2] = Math.round(b / a);
      }
      buf[i + 3] = Math.round(a / (SS * SS));
    }
  }
  return encodePng(size, size, buf);
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#12306b"/><stop offset="1" stop-color="#061230"/></linearGradient>
    <radialGradient id="iris"><stop offset="0" stop-color="#3d8be0"/><stop offset="1" stop-color="#1b4f93"/></radialGradient>
    <clipPath id="eye"><path d="M -76 0 Q 0 -86 76 0 Q 0 86 -76 0 Z"/></clipPath>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
  </defs>
  <rect x="-100" y="-100" width="200" height="200" rx="36" fill="url(#bg)"/>
  <path d="M -82 0 Q 0 -92 82 0 Q 0 92 -82 0 Z" fill="#f2f5fa" stroke="#ffd54a" stroke-width="5" stroke-linejoin="round"/>
  <circle r="34" fill="url(#iris)"/>
  <circle r="15" fill="#03060f"/>
  <circle cx="-7" cy="-8" r="4.5" fill="#fff"/>
  <g clip-path="url(#eye)"><ellipse cx="22" cy="-2" rx="32" ry="27" fill="#2a3550" opacity="0.88" filter="url(#blur)"/></g>
</svg>
`;

mkdirSync(outDir, { recursive: true });
const targets = [
  ['icon-192.png', 192, { s: 0.92, rounded: true }],
  ['icon-512.png', 512, { s: 0.92, rounded: true }],
  // Maskable: full-bleed background, artwork inside the central 80% safe zone.
  ['icon-maskable-512.png', 512, { s: 0.68, rounded: false }],
  // Apple touch icon: opaque, iOS applies its own rounding.
  ['apple-touch-icon.png', 180, { s: 0.8, rounded: false }],
];
for (const [name, size, opts] of targets) {
  writeFileSync(join(outDir, name), render(size, opts));
  console.log('wrote', name);
}
writeFileSync(join(outDir, 'favicon.svg'), FAVICON_SVG);
console.log('wrote favicon.svg');

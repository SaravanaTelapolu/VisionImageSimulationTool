/**
 * Built-in, deterministic test images. Each one is an SVG string generated
 * from fixed numbers only: no randomness, no external fonts, no URLs. They
 * let the simulator be tried without uploading a photo.
 */

export interface TestImage {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  svg: string;
}

const FONT = 'system-ui, sans-serif';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svgDocument(width: number, height: number, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">${body}</svg>`
  );
}

function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** 1200 x 1200: 20 x 20 square grid, centre dot, thin border. */
function amslerSvg(): string {
  const size = 1200;
  const cells = 20;
  const step = size / cells;
  const lines: string[] = [];
  for (let i = 0; i <= cells; i++) {
    const p = num(i * step);
    lines.push(`<line x1="0" y1="${p}" x2="${size}" y2="${p}"/>`);
    lines.push(`<line x1="${p}" y1="0" x2="${p}" y2="${size}"/>`);
  }
  const body =
    `<rect x="0" y="0" width="${size}" height="${size}" fill="#ffffff"/>` +
    `<g stroke="#000000" stroke-width="2">${lines.join('')}</g>` +
    `<rect x="2" y="2" width="${size - 4}" height="${size - 4}" fill="none" stroke="#000000" stroke-width="4"/>` +
    `<circle cx="${size / 2}" cy="${size / 2}" r="7" fill="#000000"/>`;
  return svgDocument(size, size, body);
}

/** Short plain sentences at decreasing sizes, each labelled with its size. */
const READING_LINES: ReadonlyArray<readonly [number, string]> = [
  [64, 'The sun is warm today.'],
  [56, 'We walk to the park.'],
  [48, 'A dog runs on the grass.'],
  [40, 'Children play near the lake.'],
  [36, 'Birds sing in the tall trees.'],
  [32, 'Ducks swim across the pond.'],
  [28, 'A kind man feeds the ducks.'],
  [24, 'We sit on a bench and talk.'],
  [20, 'The path winds past the old oak tree.'],
  [18, 'Flowers bloom along the path in spring.'],
  [16, 'A small boy waves at his friend across the field.'],
  [14, 'We bring a red blanket and eat sandwiches under the big maple tree near the water.'],
  [12, 'Later we follow the path home as the light turns gold and the evening becomes cool.'],
];

/** 1200 x 1600: white page of reading text at 64 px down to 12 px. */
function readingSvg(): string {
  const width = 1200;
  const height = 1600;
  const parts: string[] = [`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`];
  let baseline = 150;
  for (const [size, sentence] of READING_LINES) {
    parts.push(
      `<text x="40" y="${num(baseline)}" font-family="${FONT}" font-size="16" fill="#7a7a7a">${size} px</text>`,
      `<text x="200" y="${num(baseline)}" font-family="${FONT}" font-size="${size}" fill="#111111">${escapeXml(sentence)}</text>`,
    );
    baseline += size * 1.8 + 24;
  }
  return svgDocument(width, height, parts.join(''));
}

/** 1200 x 1200: friendly stylised face made of simple shapes. */
function faceSvg(): string {
  const size = 1200;
  const body = [
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#cfe8ff"/><stop offset="1" stop-color="#fbf1e4"/>' +
      '</linearGradient></defs>',
    `<rect x="0" y="0" width="${size}" height="${size}" fill="url(#bg)"/>`,
    // Hair behind the head.
    '<ellipse cx="600" cy="560" rx="365" ry="345" fill="#4a2f1d"/>',
    // Ears, drawn before the head so only their outer edges show.
    '<ellipse cx="282" cy="650" rx="55" ry="80" fill="#f2bf96" stroke="#8a5a3c" stroke-width="6"/>',
    '<ellipse cx="918" cy="650" rx="55" ry="80" fill="#f2bf96" stroke="#8a5a3c" stroke-width="6"/>',
    // Head.
    '<ellipse cx="600" cy="640" rx="320" ry="370" fill="#f6c9a0" stroke="#8a5a3c" stroke-width="6"/>',
    // Fringe across the forehead.
    '<path d="M285 600 C300 400 420 340 600 340 C790 340 905 410 915 600 ' +
      'C860 480 780 440 690 430 C600 470 470 450 380 440 C330 480 300 530 285 600 Z" fill="#4a2f1d"/>',
    // Eye whites and pupils with highlights.
    '<ellipse cx="480" cy="620" rx="58" ry="64" fill="#ffffff" stroke="#3b2a20" stroke-width="5"/>',
    '<ellipse cx="720" cy="620" rx="58" ry="64" fill="#ffffff" stroke="#3b2a20" stroke-width="5"/>',
    '<circle cx="490" cy="630" r="30" fill="#2b5d8a"/>',
    '<circle cx="730" cy="630" r="30" fill="#2b5d8a"/>',
    '<circle cx="500" cy="618" r="9" fill="#ffffff"/>',
    '<circle cx="740" cy="618" r="9" fill="#ffffff"/>',
    // Eyebrows.
    '<path d="M412 520 Q480 482 548 512" fill="none" stroke="#4a2f1d" stroke-width="18" stroke-linecap="round"/>',
    '<path d="M652 512 Q720 482 788 520" fill="none" stroke="#4a2f1d" stroke-width="18" stroke-linecap="round"/>',
    // Nose.
    '<path d="M600 640 Q582 706 606 720 Q620 726 632 716" fill="none" stroke="#8a5a3c" stroke-width="6" stroke-linecap="round"/>',
    // Cheeks.
    '<circle cx="398" cy="735" r="42" fill="#f08a7a" opacity="0.55"/>',
    '<circle cx="802" cy="735" r="42" fill="#f08a7a" opacity="0.55"/>',
    // Smiling mouth.
    '<path d="M485 790 Q600 890 715 790 Q600 830 485 790 Z" fill="#a33d3d" stroke="#7a2a2a" stroke-width="6" stroke-linejoin="round"/>',
  ].join('');
  return svgDocument(size, size, body);
}

/** 1600 x 1200: stylised street scene with a street sign reading "MAIN ST". */
function streetSvg(): string {
  const width = 1600;
  const height = 1200;
  const base = 640; // top of the pavement, and building bases
  const kerb = 760;
  const parts: string[] = [
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
    // Sky and sun.
    `<rect x="0" y="0" width="${width}" height="${base}" fill="#9fd4f5"/>`,
    '<circle cx="1420" cy="130" r="70" fill="#ffe27a"/>',
  ];

  const buildings = [
    { x: 0, w: 230, h: 400, color: '#d9a27a' },
    { x: 230, w: 260, h: 300, color: '#8fb3c9' },
    { x: 490, w: 200, h: 430, color: '#e8d4a8' },
    { x: 690, w: 240, h: 340, color: '#b7a6c9' },
    { x: 930, w: 210, h: 410, color: '#c98b7a' },
    { x: 1140, w: 250, h: 320, color: '#9ccfa8' },
    { x: 1390, w: 210, h: 390, color: '#e0c27a' },
  ];
  for (const b of buildings) {
    const top = base - b.h;
    parts.push(
      `<rect x="${b.x}" y="${top}" width="${b.w}" height="${b.h}" fill="${b.color}" stroke="#4a4a4a" stroke-width="4"/>`,
    );
    // Rows of windows, centred on the building; some lit in a fixed pattern.
    const cols = Math.max(1, Math.floor((b.w - 24) / 50));
    const startX = b.x + (b.w - ((cols - 1) * 50 + 28)) / 2;
    for (let row = 0, y = top + 30; y + 40 <= base - 20; row++, y += 64) {
      for (let col = 0; col < cols; col++) {
        const lit = (row + col) % 3 === 0;
        parts.push(
          `<rect x="${num(startX + col * 50)}" y="${y}" width="28" height="40" fill="${lit ? '#fff3b0' : '#3e5566'}"/>`,
        );
      }
    }
  }

  // Pavement with paving joints, kerb, then the road.
  parts.push(`<rect x="0" y="${base}" width="${width}" height="${kerb - base}" fill="#cfcac0"/>`);
  for (let x = 160; x < width; x += 160) {
    parts.push(`<line x1="${x}" y1="${base}" x2="${x}" y2="${kerb}" stroke="#b5b0a6" stroke-width="3"/>`);
  }
  parts.push(`<rect x="0" y="${kerb}" width="${width}" height="14" fill="#9e988c"/>`);
  parts.push(`<rect x="0" y="774" width="${width}" height="${height - 774}" fill="#3f3f46"/>`);
  parts.push(
    `<line x1="0" y1="987" x2="${width}" y2="987" stroke="#f4f4f4" stroke-width="12" stroke-dasharray="90 60"/>`,
  );

  // Tree on the pavement.
  parts.push(
    '<rect x="180" y="520" width="24" height="240" fill="#6b4a2e"/>',
    '<g fill="#3f8f4e">' +
      '<circle cx="192" cy="470" r="90"/><circle cx="130" cy="530" r="70"/>' +
      '<circle cx="254" cy="530" r="70"/><circle cx="192" cy="400" r="70"/>' +
      '</g>',
  );

  // Lamp post.
  parts.push(
    '<rect x="1000" y="300" width="14" height="460" fill="#3a3a3a"/>',
    '<rect x="944" y="296" width="62" height="10" rx="4" fill="#3a3a3a"/>',
    '<rect x="940" y="306" width="60" height="16" rx="5" fill="#3a3a3a"/>',
    '<ellipse cx="970" cy="330" rx="34" ry="8" fill="#fff6b0"/>',
  );

  // Street sign on a post.
  parts.push(
    '<rect x="770" y="430" width="10" height="330" fill="#5a5a5a"/>',
    '<rect x="640" y="380" width="270" height="90" rx="10" fill="#1d6b3a" stroke="#ffffff" stroke-width="6"/>',
    `<text x="775" y="441" font-family="${FONT}" font-size="46" font-weight="700" fill="#ffffff" text-anchor="middle">MAIN ST</text>`,
  );

  return svgDocument(width, height, parts.join(''));
}

/** 1200 x 1200: high-contrast checkerboard (left) and Siemens star (right). */
function patternSvg(): string {
  const size = 1200;
  const square = 75;
  const boardCols = 8; // 8 * 75 = 600, the left half
  const boardRows = size / square;

  let checks = '';
  for (let r = 0; r < boardRows; r++) {
    for (let c = 0; c < boardCols; c++) {
      if ((r + c) % 2 === 0) {
        checks += `M${c * square} ${r * square}h${square}v${square}h-${square}Z`;
      }
    }
  }

  // Siemens star centred in the right half: 36 wedges of 10 degrees each,
  // with the even-indexed wedges black.
  const cx = 900;
  const cy = 600;
  const radius = 280;
  const wedges = 36;
  const step = (2 * Math.PI) / wedges;
  const star: string[] = [];
  for (let i = 0; i < wedges; i += 2) {
    const a0 = i * step;
    const a1 = (i + 1) * step;
    const x0 = cx + radius * Math.cos(a0);
    const y0 = cy + radius * Math.sin(a0);
    const x1 = cx + radius * Math.cos(a1);
    const y1 = cy + radius * Math.sin(a1);
    star.push(
      `<path d="M${cx} ${cy} L${num(x0)} ${num(y0)} A${radius} ${radius} 0 0 1 ${num(x1)} ${num(y1)} Z" fill="#000000"/>`,
    );
  }

  const body =
    `<rect x="0" y="0" width="${size}" height="${size}" fill="#ffffff"/>` +
    `<path d="${checks}" fill="#000000"/>` +
    star.join('');
  return svgDocument(size, size, body);
}

export const testImages: TestImage[] = [
  {
    id: 'amsler',
    name: 'Amsler grid',
    description: 'A 20 by 20 square grid with a central dot, for checking straight lines and blind spots.',
    width: 1200,
    height: 1200,
    svg: amslerSvg(),
  },
  {
    id: 'reading',
    name: 'Reading text',
    description: 'Short sentences at sizes from 64 px down to 12 px, each labelled with its size.',
    width: 1200,
    height: 1600,
    svg: readingSvg(),
  },
  {
    id: 'face',
    name: 'Friendly face',
    description: 'A simple, friendly face illustration with eyes, nose and smile.',
    width: 1200,
    height: 1200,
    svg: faceSvg(),
  },
  {
    id: 'street',
    name: 'Street scene',
    description: 'A stylised street with buildings, a tree, a lamp post and a "MAIN ST" sign.',
    width: 1600,
    height: 1200,
    svg: streetSvg(),
  },
  {
    id: 'pattern',
    name: 'High-contrast pattern',
    description: 'A black and white checkerboard beside a 36-wedge Siemens star, for strong edges.',
    width: 1200,
    height: 1200,
    svg: patternSvg(),
  },
];

/** A data: URL that embeds the image's SVG source. */
export function testImageDataUrl(img: TestImage): string {
  return `data:image/svg+xml,${encodeURIComponent(img.svg)}`;
}

function loadSvgImage(url: string, label: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load test image "${label}"`));
    image.src = url;
  });
}

/**
 * Browser only. Draws a test image onto a canvas whose long side is at most
 * `maxLongSide` pixels. Images are scaled down only, never up.
 */
export async function rasterizeTestImage(img: TestImage, maxLongSide = 2048): Promise<HTMLCanvasElement> {
  if (!(maxLongSide > 0)) {
    throw new RangeError('maxLongSide must be a positive number');
  }
  const scale = Math.min(1, maxLongSide / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const source = await loadSvgImage(testImageDataUrl(img), img.id);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context is unavailable');
  }
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

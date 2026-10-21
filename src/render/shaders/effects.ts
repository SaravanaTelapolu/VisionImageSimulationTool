// The single per-render pass: warp (lenses + distortion) -> variable blur -> missing area ->
// double image -> contrast loss -> dimming -> colour fade -> dark spot.
import { MAX_BLUR_PX, MAX_SIZE_CHANGE_LENSES } from '../../model/types';
import { BLUR_LEVELS_REF, CONTRAST_MEAN_LEVEL } from '../gl/math';

const LEVELS = BLUR_LEVELS_REF;
const N = LEVELS.length;

function f(x: number): string {
  const s = String(x);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
}

/** GLSL for the tent weight of pyramid level i at blur b (reference px); matches levelWeights(). */
function levelWeightExpr(i: number): string {
  const L = (k: number) => f(LEVELS[k] ?? 0);
  if (i === 0) return `clamp(1.0 - b / ${L(1)}, 0.0, 1.0)`;
  if (i === N - 1) return `clamp((b - ${L(N - 2)}) / (${L(N - 1)} - ${L(N - 2)}), 0.0, 1.0)`;
  return `(b < ${L(i)} ? clamp((b - ${L(i - 1)}) / (${L(i)} - ${L(i - 1)}), 0.0, 1.0) : clamp((${L(i + 1)} - b) / (${L(i + 1)} - ${L(i)}), 0.0, 1.0))`;
}

const samplerDecls = LEVELS.map((_, i) => `uniform sampler2D uL${i};`).join('\n');
const pyramidBody = LEVELS.map(
  (_, i) =>
    `  w = ${levelWeightExpr(i)};\n  if (w > 0.0) c += w * textureLod(uL${i}, ${i} < uSharedFrom ? uvT : uvF, 0.0).rgb;`,
).join('\n');

export const EFFECTS_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
#define MAX_LENSES ${MAX_SIZE_CHANGE_LENSES}

${samplerDecls}
uniform sampler2D uFill;   // missing-area fill colour, whole image (same orientation as the image)
uniform sampler2D uMapA;   // blur / MAX_BLUR_PX (${MAX_BLUR_PX}), distortion, contrastLoss, dimming
uniform sampler2D uMapB;   // darkSpot, fillIn, colourFade, doubleImage
uniform sampler2D uMapC;   // r: dark-spot shade of the strongest spot (0 = black, 1 = mid grey)
uniform vec2 uSize;        // output (tile) size in px
uniform vec2 uOrigin;      // tile's top-left in full-image px (0, 0 when not tiled)
uniform vec2 uFull;        // full image size in px (= uSize when not tiled)
uniform int uSharedFrom;   // levels >= this cover the whole image (tiled export), the rest this tile
uniform bool uFlipY;       // true when drawing to the canvas (bottom-up framebuffer)
uniform bool uBypass;
uniform bool uHasFill;
uniform vec2 uFix;         // fixation, full-image px
uniform vec2 uWaveDir;     // unit vector of the distortion direction
uniform float uWaveLen;    // px
uniform float uDistAmp;    // px at distortion = 1
uniform vec2 uGhost;       // px
uniform int uLensCount;
uniform vec4 uLensA[MAX_LENSES]; // cx, cy (px), 1/rx, 1/ry (1/px)
uniform vec4 uLensB[MAX_LENSES]; // cos(rot), sin(rot), amount, feather
out vec4 outColor;

// Blur at full-image position q: tile levels are read at (q - uOrigin) / uSize, shared
// whole-image levels at q / uFull (identical when not tiled).
vec3 pyramid(vec2 q, float b) {
  vec2 uvT = (q - uOrigin) / uSize;
  vec2 uvF = q / uFull;
  vec3 c = vec3(0.0);
  float w;
${pyramidBody}
  return c;
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Displacement (px) of the metamorphopsia field, anchored at the fixation point.
vec2 distortion(vec2 p, float strength) {
  vec2 d = (p - uFix) / uWaveLen;          // in wavelengths
  vec2 dir = uWaveDir;
  vec2 perp = vec2(-dir.y, dir.x);
  float a = dot(d, dir);
  float c = dot(d, perp);
  const float TAU = 6.2831853;
  // Low-frequency value noise (period ~3 wavelengths) keeps the waves from looking machine-made.
  vec2 n = vec2(vnoise(d * 0.35 + vec2(3.1, 7.7)), vnoise(d * 0.35 + vec2(11.3, 1.9))) * 2.0 - 1.0;
  vec2 disp = perp * sin(TAU * a + 0.8 * n.x) + dir * 0.25 * sin(TAU * 0.61 * c + 1.3) + 0.25 * n;
  return disp * (strength * uDistAmp / 1.15);
}

float lensWeight(float r, float feather) {
  if (r >= 1.0) return 0.0;
  if (feather <= 1e-4) return 1.0;
  return smoothstep(0.0, 1.0, (1.0 - r) / feather);
}

// Overlapping lenses do not compound (L8): each lens's own displacement is blended with weight
// |amount * w|^4, a continuous "strongest lens wins". Mirrors warpByLenses() in render/lenses.ts.
vec2 applyLenses(vec2 p) {
  vec2 sum = vec2(0.0);
  float wsum = 0.0;
  for (int i = 0; i < MAX_LENSES; i++) {
    if (i >= uLensCount) break;
    vec4 A = uLensA[i];
    vec4 B = uLensB[i];
    vec2 d = p - A.xy;
    vec2 local = vec2(B.x * d.x + B.y * d.y, -B.y * d.x + B.x * d.y) * A.zw;
    float w = lensWeight(length(local), B.w);
    float s = abs(B.z * w);
    if (s > 0.0) {
      float k = s * s;
      k *= k;
      sum += d * (1.0 / (1.0 + B.z * w) - 1.0) * k;
      wsum += k;
    }
  }
  return wsum > 0.0 ? p + sum / wsum : p;
}

// Pixel positions p and q are in full-image px; pyramid levels cover only this tile, so they are
// read at (q - uOrigin) / uSize. Effect maps and the fill cover the whole image: q / uFull.
void main() {
  vec2 pl = vec2(gl_FragCoord.x, uFlipY ? uSize.y - gl_FragCoord.y : gl_FragCoord.y);
  if (uBypass) {
    outColor = vec4(textureLod(uL0, pl / uSize, 0.0).rgb, 1.0);
    return;
  }
  vec2 p = pl + uOrigin;
  vec2 uv0 = p / uFull;
  vec4 A = textureLod(uMapA, uv0, 0.0);
  vec4 B = textureLod(uMapB, uv0, 0.0);
  float b = A.r * ${f(MAX_BLUR_PX)};

  vec2 q = applyLenses(p);
  if (A.g > 0.0 && uDistAmp > 0.0) q += distortion(p, A.g);
  vec2 uv = (q - uOrigin) / uSize;

  vec3 col = pyramid(q, b);

  if (uHasFill && B.g > 0.0) col = mix(col, textureLod(uFill, q / uFull, 0.0).rgb, B.g);

  if (B.a > 0.0) {
    vec3 ghost = pyramid(q - uGhost, b);
    col = mix(col, ghost, B.a * 0.5);
  }

  if (A.b > 0.0) {
    vec3 m = textureLod(uL${CONTRAST_MEAN_LEVEL}, ${CONTRAST_MEAN_LEVEL} < uSharedFrom ? uv : q / uFull, 0.0).rgb;
    col = m + (col - m) * (1.0 - 0.85 * A.b);
    col = mix(col, vec3(0.82), 0.3 * A.b);
  }

  if (A.a > 0.0) col *= 1.0 - 0.9 * A.a;

  if (B.b > 0.0) {
    float y = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, vec3(y), B.b);
  }

  if (B.r > 0.0) {
    float shade = textureLod(uMapC, uv0, 0.0).r;
    col = mix(col, vec3(0.5 * shade), B.r);
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export const PYRAMID_LEVEL_COUNT = N;

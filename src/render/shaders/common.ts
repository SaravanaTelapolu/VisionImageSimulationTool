// GLSL ES 3.00 sources shared by the renderer passes. Kept as TS strings so they need no loader
// and can be generated from the constants in ../gl/math.ts.
import { MAX_KERNEL_PAIRS } from '../gl/math';

/** Full-screen triangle from gl_VertexID; no vertex buffers needed. */
export const FULLSCREEN_VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * Separable Gaussian along one axis, with merged bilinear taps. Taps are offsets in INPUT texels
 * (uStep = one input texel in uv along the axis), so the pass can also decimate: the output may be
 * smaller than the input and the kernel then acts as the anti-alias prefilter.
 * Images are stored top row first everywhere; uv = gl_FragCoord / size keeps that orientation.
 */
export const BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
#define MAX_PAIRS ${MAX_KERNEL_PAIRS}
uniform sampler2D uSrc;
uniform vec2 uOutSize;
uniform vec2 uStep;
uniform float uCentre;
uniform int uCount;
uniform vec4 uTaps[${MAX_KERNEL_PAIRS / 2}]; // (offset, weight, offset, weight)
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uOutSize;
  vec4 c = uCentre * textureLod(uSrc, uv, 0.0);
  for (int i = 0; i < MAX_PAIRS; i++) {
    if (i >= uCount) break;
    vec4 t = uTaps[i / 2];
    vec2 ow = (i % 2 == 0) ? t.xy : t.zw;
    vec2 d = uStep * ow.x;
    c += ow.y * (textureLod(uSrc, uv + d, 0.0) + textureLod(uSrc, uv - d, 0.0));
  }
  outColor = c;
}
`;

/**
 * Missing-area step 1: premultiply a lightly blurred copy of the image by a validity weight that
 * is ~0 inside "missing area" regions, so the following normalised blurs only gather colour
 * from the surroundings.
 */
export const FILL_WEIGHT_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform sampler2D uMapB;
uniform vec2 uOutSize;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uOutSize;
  vec3 c = textureLod(uSrc, uv, 0.0).rgb;
  float m = textureLod(uMapB, uv, 0.0).g;
  float w = pow(1.0 - m, 4.0);
  outColor = vec4(c * w, w);
}
`;

/**
 * Missing-area step 2 (push-pull style compose): normalised convolution at three scales; use the
 * finest scale that has enough valid surroundings, falling back to the heaviest pyramid level.
 */
export const FILL_COMPOSE_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uF0;
uniform sampler2D uF1;
uniform sampler2D uF2;
uniform sampler2D uBase;
uniform vec2 uOutSize;
out vec4 outColor;
vec3 est(vec4 f) { return f.rgb / max(f.a, 1e-5); }
void main() {
  vec2 uv = gl_FragCoord.xy / uOutSize;
  vec3 col = textureLod(uBase, uv, 0.0).rgb;
  vec4 f2 = textureLod(uF2, uv, 0.0);
  vec4 f1 = textureLod(uF1, uv, 0.0);
  vec4 f0 = textureLod(uF0, uv, 0.0);
  col = mix(col, est(f2), clamp(f2.a * 20.0, 0.0, 1.0));
  col = mix(col, est(f1), smoothstep(0.08, 0.4, f1.a));
  col = mix(col, est(f0), smoothstep(0.15, 0.5, f0.a));
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

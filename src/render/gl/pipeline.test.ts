// GLPipeline against a recording fake WebGL2 context: checks which uniforms and textures the
// effects pass uses (no GPU in Node, so pixels are covered by the e2e tests and the dev harness).
import { describe, expect, it } from 'vitest';
import { defaultGlobals } from '../../model/defaults';
import type { EffectMaps, RenderParams } from '../types';
import { EFFECTS_FRAG, PYRAMID_LEVEL_COUNT } from '../shaders/effects';
import { GLPipeline } from './pipeline';

interface Call {
  name: string;
  args: unknown[];
}

/** A WebGL2 stand-in: every method exists, returns something sensible and is recorded. */
function fakeGl(): { gl: WebGL2RenderingContext; calls: Call[] } {
  const calls: Call[] = [];
  const consts: Record<string, number> = {
    FRAMEBUFFER_COMPLETE: 36053,
    MAX_TEXTURE_SIZE: 3379,
    MAX_RENDERBUFFER_SIZE: 34024,
    MAX_VIEWPORT_DIMS: 3386,
    TEXTURE0: 33984,
  };
  const canvas = { width: 1, height: 1 };
  let id = 0;
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, prop: string) {
      if (prop === 'canvas') return canvas;
      if (prop in consts) return consts[prop];
      if (/^[A-Z0-9_]+$/.test(prop)) return 1000 + prop.length; // any other GL enum
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
        switch (prop) {
          case 'getParameter':
            return args[0] === consts.MAX_VIEWPORT_DIMS ? new Int32Array([8192, 8192]) : 8192;
          case 'getShaderParameter':
          case 'getProgramParameter':
            return true;
          case 'getExtension':
            return null;
          case 'checkFramebufferStatus':
            return consts.FRAMEBUFFER_COMPLETE;
          case 'getUniformLocation':
            return args[1]; // the uniform's name, so uniform calls are readable
          case 'isContextLost':
            return false;
          default:
            return prop.startsWith('create') ? { id: ++id } : undefined;
        }
      };
    },
  };
  return { gl: new Proxy({}, handler) as unknown as WebGL2RenderingContext, calls };
}

function maps(): EffectMaps {
  const n = 2 * 2 * 4;
  return { width: 2, height: 2, a: new Uint8Array(n), b: new Uint8Array(n).fill(200), c: new Uint8Array(n).fill(128) };
}

function params(m: EffectMaps): RenderParams {
  return { maps: m, globals: { ...defaultGlobals(), darkSpotShade: 0.77 }, lenses: [], fixation: { x: 4, y: 3 } };
}

describe('effects shader (D05)', () => {
  it('reads the dark-spot shade from map C, not from a uniform', () => {
    expect(EFFECTS_FRAG).toContain('uniform sampler2D uMapC;');
    expect(EFFECTS_FRAG).not.toContain('uShade');
    expect(EFFECTS_FRAG).toMatch(/textureLod\(uMapC, uv0, 0\.0\)\.r/);
  });
});

describe('GLPipeline with a fake context', () => {
  it('uploads map C and binds it for the effects pass; never sets a shade uniform', () => {
    const { gl, calls } = fakeGl();
    const pipe = new GLPipeline(gl);
    const source = { width: 8, height: 6 } as unknown as TexImageSource;
    pipe.setSource(source, 8, 6);
    const m = maps();
    calls.length = 0;
    expect(pipe.render(params(m))).toBe(true);

    const uploads = calls.filter((c) => c.name === 'texImage2D').map((c) => c.args[8]);
    expect(uploads.some((u) => u instanceof Uint8Array && u.length === 16 && u.every((v) => v === 128))).toBe(true);

    const ints = calls.filter((c) => c.name === 'uniform1i').map((c) => [c.args[0], c.args[1]]);
    expect(ints).toContainEqual(['uMapC', PYRAMID_LEVEL_COUNT + 3]);
    const named = calls.filter((c) => c.name.startsWith('uniform')).map((c) => c.args[0]);
    expect(named).not.toContain('uShade');
  });

  it('re-uploads the maps when only map C changes', () => {
    const { gl, calls } = fakeGl();
    const pipe = new GLPipeline(gl);
    pipe.setSource({ width: 8, height: 6 } as unknown as TexImageSource, 8, 6);
    const m = maps();
    pipe.render(params(m));
    calls.length = 0;
    pipe.render(params(m));
    expect(calls.filter((c) => c.name === 'texImage2D')).toHaveLength(0);
    pipe.render(params({ ...m, c: new Uint8Array(16).fill(7) }));
    const uploads = calls.filter((c) => c.name === 'texImage2D').map((c) => c.args[8]);
    expect(uploads.some((u) => u instanceof Uint8Array && u.every((v) => v === 7))).toBe(true);
  });
});

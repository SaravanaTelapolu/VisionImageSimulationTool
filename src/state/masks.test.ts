import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newProfile, newRegion } from '../model/defaults';
import { addRegion, removeRegion, setRegionVisible, updateShape } from '../model/ops';
import type { MaskShape } from '../model/types';
import type { MaskData } from '../render/shapeCoverage';
import { maskCacheSize, maskData, primeMaskCache, resetMaskCache, setLiveMask, setMaskCodec, type MaskCodec } from './masks';
import { applyEdit, resetProfile } from './store';

function data(v: number): MaskData {
  return { width: 2, height: 2, data: new Uint8Array(4).fill(v) };
}

function maskShape(url: string): MaskShape {
  return { type: 'mask', dataUrl: url, x: 0, y: 0, width: 1, height: 1 };
}

let decodeCalls: string[] = [];
let resolvers: Array<() => void> = [];

function fakeCodec(): MaskCodec {
  return {
    decode(url) {
      decodeCalls.push(url);
      return new Promise((resolve) => {
        resolvers.push(() => resolve(url.includes('bad') ? null : data(url.length % 256)));
      });
    },
    encode: () => 'data:image/png;base64,AAAA',
  };
}

async function flush(): Promise<void> {
  const rs = resolvers;
  resolvers = [];
  rs.forEach((r) => r());
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  decodeCalls = [];
  resolvers = [];
  setMaskCodec(fakeCodec());
  resetMaskCache();
  resetProfile(newProfile());
});

afterEach(() => {
  setMaskCodec();
});

describe('mask cache sync', () => {
  it('decodes a new visible mask region and publishes it', async () => {
    const url = 'data:image/png;base64,AAA';
    const r = newRegion(maskShape(url));
    applyEdit((p) => addRegion(p, r));
    expect(decodeCalls).toEqual([url]);
    await flush();
    expect(maskData.value.get(r.id)?.data[0]).toBe(url.length % 256);
  });

  it('does not decode twice for the same dataUrl', async () => {
    const a = newRegion(maskShape('data:image/png;base64,SAME'));
    const b = newRegion(maskShape('data:image/png;base64,SAME'));
    applyEdit((p) => addRegion(addRegion(p, a), b));
    await flush();
    expect(decodeCalls).toHaveLength(1);
    expect(maskData.value.get(a.id)).toBe(maskData.value.get(b.id));
  });

  it('uses primed data without decoding', () => {
    const d = data(7);
    primeMaskCache('data:image/png;base64,PRIMED', d);
    const r = newRegion(maskShape('data:image/png;base64,PRIMED'));
    applyEdit((p) => addRegion(p, r));
    expect(decodeCalls).toEqual([]);
    expect(maskData.value.get(r.id)).toBe(d);
  });

  it('re-decodes when the dataUrl changes, keeping old data meanwhile', async () => {
    const r = newRegion(maskShape('data:image/png;base64,ONE'));
    applyEdit((p) => addRegion(p, r));
    await flush();
    const first = maskData.value.get(r.id);
    expect(first).toBeDefined();
    applyEdit((p) => updateShape(p, r.id, maskShape('data:image/png;base64,TWO22')));
    expect(maskData.value.get(r.id)).toBe(first);
    await flush();
    expect(maskData.value.get(r.id)).not.toBe(first);
  });

  it('drops entries for removed and hidden regions', async () => {
    const r = newRegion(maskShape('data:image/png;base64,ONE'));
    applyEdit((p) => addRegion(p, r));
    await flush();
    applyEdit((p) => setRegionVisible(p, r.id, false));
    expect(maskData.value.has(r.id)).toBe(false);
    applyEdit((p) => setRegionVisible(p, r.id, true));
    expect(maskData.value.has(r.id)).toBe(true); // cached, no new decode
    expect(decodeCalls).toHaveLength(1);
    applyEdit((p) => removeRegion(p, r.id));
    expect(maskData.value.size).toBe(0);
  });

  it('trims unreferenced cache entries beyond a small spare count', async () => {
    const r = newRegion(maskShape('data:image/png;base64,U0'));
    applyEdit((p) => addRegion(p, r));
    for (let i = 1; i <= 20; i++) {
      applyEdit((p) => updateShape(p, r.id, maskShape(`data:image/png;base64,U${i}`)));
      await flush();
    }
    expect(maskCacheSize()).toBeLessThanOrEqual(9);
  });

  it('does not retry an undecodable image forever', async () => {
    const r = newRegion(maskShape('data:image/png;base64,bad'));
    applyEdit((p) => addRegion(p, r));
    await flush();
    applyEdit((p) => ({ ...p, name: 'x' }));
    await flush();
    expect(decodeCalls).toHaveLength(1);
    expect(maskData.value.has(r.id)).toBe(false);
  });

  it('setLiveMask publishes immediately', () => {
    const d = data(9);
    setLiveMask('abc', d);
    expect(maskData.value.get('abc')).toBe(d);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newProfile, newRegion } from '../model/defaults';
import { addRegion, removeRegion, setRegionVisible, updateShape } from '../model/ops';
import type { MaskShape } from '../model/types';
import type { MaskData } from '../render/shapeCoverage';
import type { Profile } from '../model/types';
import {
  decodeMasksFor,
  isMaskPending,
  maskCacheSize,
  maskData,
  masksReady,
  primeMaskCache,
  resetMaskCache,
  setLiveMask,
  setMaskCodec,
  type MaskCodec,
} from './masks';
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

function profileOf(...regions: ReturnType<typeof newRegion>[]): Profile {
  return { ...newProfile(), regions };
}

describe('decodeMasksFor (H1, L9)', () => {
  it("decodes another profile's masks from its own dataUrls, keyed by its region ids", async () => {
    const live = newRegion(maskShape('data:image/png;base64,LIVE'));
    applyEdit((p) => addRegion(p, live));
    await flush();
    const saved = newRegion(maskShape('data:image/png;base64,SAVED1'));
    const promise = decodeMasksFor(profileOf(saved));
    await flush();
    const out = await promise;
    expect([...out.keys()]).toEqual([saved.id]);
    expect(out.get(saved.id)?.data[0]).toBe('data:image/png;base64,SAVED1'.length % 256);
    // The live profile's published data is untouched.
    expect(maskData.value.get(live.id)?.data[0]).toBe('data:image/png;base64,LIVE'.length % 256);
  });

  it('uses the saved data even when region ids match the live profile', async () => {
    const r = newRegion(maskShape('data:image/png;base64,NEW_UNSAVED'));
    applyEdit((p) => addRegion(p, r));
    await flush();
    const promise = decodeMasksFor(profileOf({ ...r, shape: maskShape('data:image/png;base64,OLD') }));
    await flush();
    expect((await promise).get(r.id)?.data[0]).toBe('data:image/png;base64,OLD'.length % 256);
  });

  it('joins a decode in flight instead of starting another, and waits for it', async () => {
    const url = 'data:image/png;base64,SHARED';
    const r = newRegion(maskShape(url));
    applyEdit((p) => addRegion(p, r));
    expect(isMaskPending(url)).toBe(true);
    let done = false;
    const promise = decodeMasksFor(profileOf(r)).then((m) => {
      done = true;
      return m;
    });
    await Promise.resolve();
    expect(done).toBe(false); // not answered with missing data while decoding
    await flush();
    const out = await promise;
    expect(decodeCalls).toEqual([url]);
    expect(out.get(r.id)).toBe(maskData.value.get(r.id));
    expect(isMaskPending(url)).toBe(false);
  });

  it('skips hidden and undecodable regions', async () => {
    const bad = newRegion(maskShape('data:image/png;base64,bad'));
    const hidden = { ...newRegion(maskShape('data:image/png;base64,OK')), visible: false };
    const promise = decodeMasksFor(profileOf(bad, hidden));
    await flush();
    expect((await promise).size).toBe(0);
    expect(decodeCalls).toEqual(['data:image/png;base64,bad']);
  });

  it('masksReady resolves after pending decodes finish', async () => {
    applyEdit((p) => addRegion(p, newRegion(maskShape('data:image/png;base64,WAIT'))));
    let ready = false;
    const promise = masksReady().then(() => (ready = true));
    await Promise.resolve();
    expect(ready).toBe(false);
    await flush();
    await promise;
    expect(ready).toBe(true);
  });
});

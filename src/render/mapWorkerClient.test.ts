import { afterEach, describe, expect, it, vi } from 'vitest';
import { centredFrame } from '../model/coords';
import { emptyEffects, newRegion } from '../model/defaults';
import type { Region } from '../model/types';
import { buildEffectMaps, type MaskData } from './effectMaps';
import {
  createMapWorkerState,
  processMapRequest,
  type MapWorkerRequest,
  type MapWorkerResponse,
} from './mapWorker';
import { createLatestWinsQueue, createMapBuilder, type MapBuildRequest, type WorkerLike } from './mapWorkerClient';

afterEach(() => vi.restoreAllMocks());

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createLatestWinsQueue', () => {
  it('runs one request at a time and resolves superseded ones with null', async () => {
    const started: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred<string>>>();
    const q = createLatestWinsQueue<string, string>((req) => {
      started.push(req);
      const d = deferred<string>();
      gates.set(req, d);
      return d.promise;
    });

    const a = q.submit('a');
    const b = q.submit('b');
    const c = q.submit('c');
    const d = q.submit('d');
    expect(started).toEqual(['a']);
    await expect(b).resolves.toBeNull();
    await expect(c).resolves.toBeNull();

    gates.get('a')!.resolve('A');
    await expect(a).resolves.toBe('A'); // the running request still delivers its result
    await tick();
    expect(started).toEqual(['a', 'd']);
    gates.get('d')!.resolve('D');
    await expect(d).resolves.toBe('D');
  });

  it('starts immediately again when idle', async () => {
    const started: number[] = [];
    const q = createLatestWinsQueue<number, number>(async (n) => {
      started.push(n);
      return n * 2;
    });
    await expect(q.submit(1)).resolves.toBe(2);
    await expect(q.submit(2)).resolves.toBe(4);
    expect(started).toEqual([1, 2]);
  });

  it('a failing run rejects only itself and the queue carries on', async () => {
    const gate = deferred<number>();
    let calls = 0;
    const q = createLatestWinsQueue<number, number>((n) => {
      calls++;
      return n === 1 ? gate.promise : Promise.resolve(n);
    });
    const a = q.submit(1);
    const b = q.submit(2);
    gate.reject(new Error('boom'));
    await expect(a).rejects.toThrow('boom');
    await expect(b).resolves.toBe(2);
    expect(calls).toBe(2);
  });

  it('clearPending drops the waiting request but not the running one', async () => {
    const gate = deferred<string>();
    const q = createLatestWinsQueue<string, string>((r) => (r === 'a' ? gate.promise : Promise.resolve(r)));
    const a = q.submit('a');
    const b = q.submit('b');
    q.clearPending();
    await expect(b).resolves.toBeNull();
    gate.resolve('A');
    await expect(a).resolves.toBe('A');
  });
});

// --- Builder ---------------------------------------------------------------------------------

const frame = centredFrame(200, 100);

function reg(): Region {
  return {
    ...newRegion({ type: 'ellipse', cx: 0, cy: 0, rx: 0.3, ry: 0.2, rotation: 0 }),
    effects: { ...emptyEffects(), darkSpot: 0.8 },
  };
}

function request(masks?: Map<string, MaskData>): MapBuildRequest {
  return { regions: [reg()], frame, mapWidth: 100, mapHeight: 50, masks };
}

/** A fake worker that answers via the real handler, only when told to. */
function fakeWorker(opts: { autoReply?: boolean } = {}) {
  const state = createMapWorkerState();
  const posted: MapWorkerRequest[] = [];
  const w: WorkerLike & { reply(i?: number): void; terminated: boolean } = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminated: false,
    postMessage(msg) {
      posted.push(msg);
      if (opts.autoReply) setTimeout(() => w.reply(posted.length - 1), 0);
    },
    terminate() {
      w.terminated = true;
    },
    reply(i = posted.length - 1) {
      const res: MapWorkerResponse = processMapRequest(posted[i]!, state);
      w.onmessage?.({ data: res });
    },
  };
  return { w, posted };
}

describe('createMapBuilder with a worker', () => {
  it('returns the worker maps and its build time', async () => {
    const { w, posted } = fakeWorker({ autoReply: true });
    const b = createMapBuilder({ createWorker: () => w });
    expect(b.usesWorker).toBe(true);
    const maps = await b.build(request());
    expect(posted).toHaveLength(1);
    const expected = buildEffectMaps([reg()], frame, 100, 50);
    expect(maps?.width).toBe(100);
    expect(maps?.a.length).toBe(expected.a.length);
    expect(b.lastMs).not.toBeNull();
  });

  it('keeps only the newest pending request; superseded ones resolve null', async () => {
    const { w, posted } = fakeWorker();
    const b = createMapBuilder({ createWorker: () => w });
    const r1 = b.build({ ...request(), mapWidth: 10 });
    const r2 = b.build({ ...request(), mapWidth: 20 });
    const r3 = b.build({ ...request(), mapWidth: 30 });
    expect(posted.map((p) => p.mapWidth)).toEqual([10]);
    await expect(r2).resolves.toBeNull();
    w.reply();
    expect((await r1)?.width).toBe(10);
    await tick();
    expect(posted.map((p) => p.mapWidth)).toEqual([10, 30]);
    w.reply();
    expect((await r3)?.width).toBe(30);
  });

  it('ignores stale replies', async () => {
    const { w } = fakeWorker();
    const b = createMapBuilder({ createWorker: () => w });
    const p = b.build(request());
    w.onmessage?.({ data: { id: 999, maps: buildEffectMaps([], frame, 1, 1), ms: 1 } });
    let done = false;
    void p.then(() => (done = true));
    await tick();
    expect(done).toBe(false);
    w.reply();
    await expect(p).resolves.not.toBeNull();
  });

  it('sends the masks only when the Map changes and the worker reuses them', async () => {
    const { w, posted } = fakeWorker({ autoReply: true });
    const b = createMapBuilder({ createWorker: () => w });
    const masks = new Map<string, MaskData>([['m1', { width: 2, height: 2, data: new Uint8Array(4).fill(255) }]]);
    await b.build(request(masks));
    await b.build(request(masks));
    await b.build(request(new Map(masks)));
    await b.build(request(undefined));
    expect(posted.map((p) => p.masks !== undefined)).toEqual([true, false, true, true]);
  });

  it('dispose terminates the worker and resolves outstanding builds with null', async () => {
    const { w } = fakeWorker();
    const b = createMapBuilder({ createWorker: () => w });
    const running = b.build(request());
    const waiting = b.build(request());
    b.dispose();
    await expect(running).resolves.toBeNull();
    await expect(waiting).resolves.toBeNull();
    await expect(b.build(request())).resolves.toBeNull();
    expect(w.terminated).toBe(true);
  });
});

describe('createMapBuilder fallback', () => {
  it('builds synchronously when there is no Worker (Node)', async () => {
    const b = createMapBuilder(); // Worker is undefined under Vitest/Node
    expect(b.usesWorker).toBe(false);
    const maps = await b.build(request());
    const expected = buildEffectMaps([reg()], frame, 100, 50);
    expect(Array.from(maps!.a)).toEqual(Array.from(expected.a));
    expect(Array.from(maps!.b)).toEqual(Array.from(expected.b));
    expect(b.lastMs).not.toBeNull();
  });

  it('falls back when worker construction throws, logging once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const b = createMapBuilder({
      createWorker: () => {
        throw new Error('no workers here');
      },
    });
    expect(b.usesWorker).toBe(false);
    expect((await b.build(request()))?.width).toBe(100);
    expect((await b.build(request()))?.width).toBe(100);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a worker error mid-build finishes that build on the main thread and stays there', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { w, posted } = fakeWorker();
    const b = createMapBuilder({ createWorker: () => w });
    const running = b.build(request());
    const waiting = b.build({ ...request(), mapWidth: 40 });
    w.onerror?.(new Error('worker crashed'));
    expect((await running)?.width).toBe(100);
    expect((await waiting)?.width).toBe(40);
    expect(b.usesWorker).toBe(false);
    expect(w.terminated).toBe(true);
    expect(posted).toHaveLength(1); // nothing more went to the worker
    w.onerror?.(new Error('again')); // detached: ignored
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a worker-reported build error also falls back', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { w } = fakeWorker();
    const b = createMapBuilder({ createWorker: () => w });
    const p = b.build(request());
    w.onmessage?.({ data: { id: 1, error: 'bad' } });
    expect((await p)?.width).toBe(100);
    expect(b.usesWorker).toBe(false);
  });
});

describe('processMapRequest', () => {
  it('accepts masks as pairs or a Map, caches them, and reports an error instead of throwing', () => {
    const state = createMapWorkerState();
    const m: MaskData = { width: 1, height: 1, data: new Uint8Array([255]) };
    const base = { id: 1, regions: [], frame, mapWidth: 4, mapHeight: 2 };
    expect('maps' in processMapRequest({ ...base, masks: [['x', m]] }, state)).toBe(true);
    expect(state.masks?.get('x')).toBe(m);
    processMapRequest({ ...base, id: 2 }, state);
    expect(state.masks?.get('x')).toBe(m); // reused
    processMapRequest({ ...base, id: 3, masks: new Map() }, state);
    expect(state.masks?.size).toBe(0);
    const bad = processMapRequest({ ...base, id: 4, regions: null as unknown as Region[] }, state);
    expect(bad).toMatchObject({ id: 4, error: expect.any(String) });
  });
});

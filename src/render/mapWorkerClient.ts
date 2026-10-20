// Main-thread client for the effect-map worker (W3-6): latest-wins queue, worker with a permanent
// synchronous fallback. In Node (Vitest) there is no Worker, so builds run synchronously.
import type { ImageFrame, Region } from '../model/types';
import { buildEffectMaps, type MaskData } from './effectMaps';
import type { MapWorkerRequest, MapWorkerResponse } from './mapWorker';
import type { EffectMaps } from './types';

export interface MapBuildRequest {
  regions: Region[];
  frame: ImageFrame;
  mapWidth: number;
  mapHeight: number;
  masks?: Map<string, MaskData>;
}

export interface MapBuilder {
  /**
   * Builds maps. Latest wins: while a build is in flight only the newest later request is kept;
   * requests superseded before they start resolve to null. The in-flight build is never cancelled
   * (it resolves with its maps, which are still a valid intermediate result).
   */
  build(req: MapBuildRequest): Promise<EffectMaps | null>;
  /** True while a worker is in use; false once the builder works synchronously on the main thread. */
  readonly usesWorker: boolean;
  /** Build time (ms) of the most recently resolved non-null result. */
  readonly lastMs: number | null;
  /** Stops the worker and resolves everything outstanding with null. */
  dispose(): void;
}

/** The slice of the Worker API the client uses (so tests can fake it). */
export interface WorkerLike {
  postMessage(msg: MapWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: { data: MapWorkerResponse }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessageerror: ((e: unknown) => void) | null;
}

// --- Latest-wins queue -----------------------------------------------------------------------

interface Waiter<Req, Res> {
  req: Req;
  resolve: (r: Res | null) => void;
  reject: (e: unknown) => void;
}

/**
 * Runs one request at a time. Requests that arrive while one is running replace each other; every
 * replaced request resolves with null. A run that fails rejects only its own promise.
 */
export function createLatestWinsQueue<Req, Res>(run: (req: Req) => Promise<Res>) {
  let busy = false;
  let pending: Waiter<Req, Res> | null = null;

  function start(w: Waiter<Req, Res>): void {
    busy = true;
    let p: Promise<Res>;
    try {
      p = run(w.req);
    } catch (err) {
      p = Promise.reject(err);
    }
    const next = (): void => {
      busy = false;
      const n = pending;
      pending = null;
      if (n) start(n);
    };
    p.then(
      (r) => {
        w.resolve(r);
        next();
      },
      (e) => {
        w.reject(e);
        next();
      },
    );
  }

  return {
    submit(req: Req): Promise<Res | null> {
      return new Promise<Res | null>((resolve, reject) => {
        const w: Waiter<Req, Res> = { req, resolve, reject };
        if (!busy) {
          start(w);
          return;
        }
        pending?.resolve(null); // superseded
        pending = w;
      });
    },
    /** Drops the waiting request (resolves it with null); the running one is left to finish. */
    clearPending(): void {
      pending?.resolve(null);
      pending = null;
    },
  };
}

// --- Builder ---------------------------------------------------------------------------------

function defaultCreateWorker(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('./mapWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

const NOT_SENT = Symbol('masks-not-sent');

interface InFlight {
  id: number;
  req: MapBuildRequest;
  resolve: (m: EffectMaps | null) => void;
  reject: (e: unknown) => void;
}

export function createMapBuilder(opts: { createWorker?: () => WorkerLike | null } = {}): MapBuilder {
  const createWorker = opts.createWorker ?? defaultCreateWorker;
  let worker: WorkerLike | null = null;
  let disposed = false;
  let nextId = 1;
  let lastMs: number | null = null;
  let sentMasks: Map<string, MaskData> | undefined | typeof NOT_SENT = NOT_SENT;
  let inFlight: InFlight | null = null;

  function buildSync(req: MapBuildRequest): EffectMaps {
    const t0 = performance.now();
    const maps = buildEffectMaps(req.regions, req.frame, req.mapWidth, req.mapHeight, req.masks);
    lastMs = performance.now() - t0;
    return maps;
  }

  function detachWorker(): void {
    const w = worker;
    worker = null;
    if (!w) return;
    w.onmessage = w.onerror = w.onmessageerror = null;
    try {
      w.terminate();
    } catch {
      /* ignore */
    }
  }

  /** Permanently switches to the main thread (logs once) and finishes the running request there. */
  function fallBack(reason: unknown): void {
    if (!worker) return;
    console.warn('[maps] The map worker is not usable; building effect maps on the main thread instead.', reason);
    detachWorker();
    const f = inFlight;
    inFlight = null;
    if (f) {
      try {
        f.resolve(buildSync(f.req));
      } catch (err) {
        f.reject(err);
      }
    }
  }

  try {
    worker = createWorker();
  } catch (err) {
    console.warn('[maps] Could not start the map worker; building effect maps on the main thread instead.', err);
    worker = null;
  }
  if (worker) {
    worker.onmessage = (e) => {
      const res = e.data;
      const f = inFlight;
      if (!f || !res || res.id !== f.id) return; // stale or unknown
      if ('maps' in res) {
        inFlight = null;
        lastMs = res.ms;
        f.resolve(res.maps);
      } else {
        fallBack(res.error); // retries this request on the main thread and stays there
      }
    };
    worker.onerror = (e) => fallBack(e);
    worker.onmessageerror = (e) => fallBack(e);
  }

  function run(req: MapBuildRequest): Promise<EffectMaps | null> {
    if (!worker) {
      try {
        return Promise.resolve(buildSync(req));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return new Promise<EffectMaps | null>((resolve, reject) => {
      const id = nextId++;
      inFlight = { id, req, resolve, reject };
      const msg: MapWorkerRequest = {
        id,
        regions: req.regions,
        frame: req.frame,
        mapWidth: req.mapWidth,
        mapHeight: req.mapHeight,
      };
      // Masks can be large; send them only when the Map changed since the last post.
      if (req.masks !== sentMasks) {
        msg.masks = req.masks ? [...req.masks] : [];
        sentMasks = req.masks;
      }
      try {
        worker!.postMessage(msg);
      } catch (err) {
        fallBack(err); // settles this request on the main thread
      }
    });
  }

  const queue = createLatestWinsQueue<MapBuildRequest, EffectMaps | null>(run);

  return {
    build(req) {
      if (disposed) return Promise.resolve(null);
      return queue.submit(req).then((r) => r ?? null);
    },
    get usesWorker() {
      return worker !== null;
    },
    get lastMs() {
      return lastMs;
    },
    dispose() {
      disposed = true;
      queue.clearPending();
      detachWorker();
      const f = inFlight;
      inFlight = null;
      f?.resolve(null);
    },
  };
}

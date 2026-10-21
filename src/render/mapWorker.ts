// Web Worker entry: builds effect maps off the main thread (W3-6).
// Pure TypeScript only (effectMaps has no DOM dependencies). The request/response shapes live here
// so the client (mapWorkerClient.ts) and tests share them.
import type { ImageFrame, Region } from '../model/types';
import { buildEffectMaps, type MaskData } from './effectMaps';
import type { EffectMaps } from './types';

export interface MapWorkerRequest {
  id: number;
  regions: Region[];
  frame: ImageFrame;
  mapWidth: number;
  mapHeight: number;
  /**
   * Brush masks as a Map or as [id, MaskData] pairs. When omitted the worker reuses the masks it
   * received last, so the client only has to send them when they change.
   */
  masks?: Map<string, MaskData> | Array<[string, MaskData]>;
}

export type MapWorkerResponse =
  | { id: number; maps: EffectMaps; ms: number }
  | { id: number; error: string };

export interface MapWorkerState {
  masks: Map<string, MaskData> | undefined;
}

export function createMapWorkerState(): MapWorkerState {
  return { masks: undefined };
}

/** Handles one request. Pure apart from `state` (the cached masks); used by the worker and by tests. */
export function processMapRequest(req: MapWorkerRequest, state: MapWorkerState): MapWorkerResponse {
  try {
    if (req.masks) state.masks = req.masks instanceof Map ? req.masks : new Map(req.masks);
    const t0 = performance.now();
    const maps = buildEffectMaps(req.regions, req.frame, req.mapWidth, req.mapHeight, state.masks);
    return { id: req.id, maps, ms: performance.now() - t0 };
  } catch (err) {
    return { id: req.id, error: err instanceof Error ? err.message : String(err) };
  }
}

interface WorkerScope {
  onmessage: ((e: { data: MapWorkerRequest }) => void) | null;
  postMessage(msg: MapWorkerResponse, transfer?: Transferable[]): void;
}

// Only wire up the message handler when running as a worker, so importing this module elsewhere
// (tests) has no side effects.
declare const WorkerGlobalScope: (new () => object) | undefined;
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof (WorkerGlobalScope as new () => object)) {
  const scope = self as unknown as WorkerScope;
  const state = createMapWorkerState();
  scope.onmessage = (e) => {
    const res = processMapRequest(e.data, state);
    if ('maps' in res) scope.postMessage(res, [res.maps.a.buffer, res.maps.b.buffer, res.maps.c.buffer]);
    else scope.postMessage(res);
  };
}

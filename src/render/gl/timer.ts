// Non-blocking GPU timing with EXT_disjoint_timer_query_webgl2 (M5). Results arrive a frame or
// more later and are polled; nothing here waits for the GPU. Where the extension is missing
// (most mobile browsers, and Chrome without the flag) `supported` is false.

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export interface GpuTimer {
  readonly supported: boolean;
  /** Starts timing the GL commands that follow. False when unsupported or a query is already open. */
  begin(): boolean;
  /** Ends the query begun by begin(). */
  end(): void;
  /**
   * The GPU time (ms) of the newest finished query, or null when none has finished since the last
   * poll (or the result was invalidated by a disjoint event). Never blocks.
   */
  poll(): number | null;
  /** True while queries are still waiting for their results. */
  readonly pending: boolean;
  dispose(): void;
}

/** At most this many queries in flight; begin() refuses more (a slow GPU would only pile them up). */
const MAX_IN_FLIGHT = 4;

export function createGpuTimer(gl: WebGL2RenderingContext): GpuTimer {
  let ext: TimerExt | null = null;
  try {
    ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  } catch {
    ext = null;
  }
  const queue: WebGLQuery[] = [];
  let open: WebGLQuery | null = null;

  const clear = () => {
    for (const q of queue) gl.deleteQuery(q);
    queue.length = 0;
    if (open) {
      gl.deleteQuery(open);
      open = null;
    }
  };

  return {
    supported: !!ext,
    get pending() {
      return queue.length > 0;
    },
    begin() {
      if (!ext || open || queue.length >= MAX_IN_FLIGHT) return false;
      const q = gl.createQuery();
      if (!q) return false;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      open = q;
      return true;
    },
    end() {
      if (!ext || !open) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      queue.push(open);
      open = null;
    },
    poll() {
      if (!ext || queue.length === 0) return null;
      let result: number | null = null;
      while (queue.length > 0) {
        const q = queue[0] as WebGLQuery;
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
        queue.shift();
        gl.deleteQuery(q);
        result = disjoint ? null : ns / 1e6;
      }
      return result;
    },
    dispose: clear,
  };
}

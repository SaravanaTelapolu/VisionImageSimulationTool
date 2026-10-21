// Screen Wake Lock (keeps the display on while presenting). Every call is best-effort.

export interface WakeLockHandle {
  release(): Promise<void>;
}

interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockHandle>;
}

/** Asks for a screen wake lock; resolves null when unsupported, refused or failed. */
export async function requestWakeLock(): Promise<WakeLockHandle | null> {
  try {
    const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
    if (!api) return null;
    return await api.request('screen');
  } catch {
    return null;
  }
}

export async function releaseWakeLock(lock: WakeLockHandle | null): Promise<void> {
  if (!lock) return;
  try {
    await lock.release();
  } catch {
    // already released
  }
}

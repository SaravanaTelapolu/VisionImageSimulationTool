import { signal } from '@preact/signals';

/** True when a new service worker is waiting to take over (a new version is available). */
export const needRefresh = signal(false);
/** True once the app has been fully cached and can work offline. Dismissed by the UI. */
export const offlineReady = signal(false);

let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;

/** Internal: wired by register.ts. */
export function setUpdater(fn: ((reloadPage?: boolean) => Promise<void>) | null): void {
  applyUpdate = fn;
}

/** Activate the waiting service worker and reload the page. No-op if nothing is waiting. */
export async function updateApp(): Promise<void> {
  if (!applyUpdate) return;
  await applyUpdate(true);
}

export function dismissNeedRefresh(): void {
  needRefresh.value = false;
}

export function dismissOfflineReady(): void {
  offlineReady.value = false;
}

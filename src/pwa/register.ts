import { registerSW } from 'virtual:pwa-register';
import { needRefresh, offlineReady, setUpdater } from './signals';

export { needRefresh, offlineReady, updateApp } from './signals';

let registered = false;

/** Register the service worker (idempotent). Safe to call from any component's mount. */
export function registerPwa(): void {
  if (registered) return;
  registered = true;
  const update = registerSW({
    onNeedRefresh() {
      needRefresh.value = true;
    },
    onOfflineReady() {
      offlineReady.value = true;
    },
    onRegisterError(error) {
      console.warn('Service worker registration failed', error);
    },
  });
  setUpdater(update);
}

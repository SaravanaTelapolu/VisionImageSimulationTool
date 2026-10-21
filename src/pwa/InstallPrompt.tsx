import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { captureInstallPrompt, installEvent, promptInstall } from './install';
import { registerPwa } from './register';
import { dismissNeedRefresh, dismissOfflineReady, needRefresh, offlineReady, updateApp } from './signals';
import './pwa.css';

const installDismissed = signal(false);

/**
 * Registers the service worker and shows: an "Install app" button (when the browser offers
 * installation), an "Update available" toast and a one-off "Ready to work offline" toast.
 * Mount once, anywhere in the app tree; it renders as a fixed overlay at the bottom.
 */
export function InstallPrompt() {
  useEffect(() => {
    registerPwa();
    return captureInstallPrompt();
  }, []);

  const offline = offlineReady.value;
  // Auto-hide the offline toast after a while; the update toast stays until acted on.
  useEffect(() => {
    if (!offline) return;
    const t = setTimeout(dismissOfflineReady, 8000);
    return () => clearTimeout(t);
  }, [offline]);

  const canInstall = installEvent.value !== null && !installDismissed.value;

  return (
    <div class="pwa-toasts" role="region" aria-label="App notifications">
      <div class="pwa-live" aria-live="polite" aria-atomic="false">
        {needRefresh.value && (
          <div class="pwa-toast" role="status">
            <span class="pwa-msg">Update available</span>
            <button type="button" class="pwa-btn pwa-btn-primary" onClick={() => void updateApp()}>
              Reload
            </button>
            <button type="button" class="pwa-btn" aria-label="Dismiss update notice" onClick={dismissNeedRefresh}>
              Later
            </button>
          </div>
        )}
        {offline && (
          <div class="pwa-toast" role="status">
            <span class="pwa-msg">Ready to work offline</span>
            <button type="button" class="pwa-btn" aria-label="Dismiss" onClick={dismissOfflineReady}>
              OK
            </button>
          </div>
        )}
      </div>
      {canInstall && (
        <div class="pwa-toast">
          <button type="button" class="pwa-btn pwa-btn-primary" onClick={() => void promptInstall()}>
            Install app
          </button>
          <button
            type="button"
            class="pwa-btn"
            aria-label="Hide install button"
            onClick={() => (installDismissed.value = true)}
          >
            Not now
          </button>
        </div>
      )}
    </div>
  );
}

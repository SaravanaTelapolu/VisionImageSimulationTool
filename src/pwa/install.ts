import { signal } from '@preact/signals';

/** The non-standard event Chromium fires when the app is installable. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

/** The captured install event, or null when not installable / already installed / used. */
export const installEvent = signal<BeforeInstallPromptEvent | null>(null);

/**
 * Start capturing `beforeinstallprompt`. Returns a cleanup function.
 * `target` is injectable for tests; defaults to `window`.
 */
export function captureInstallPrompt(target: EventTarget = window): () => void {
  const onBefore = (e: Event) => {
    e.preventDefault(); // suppress the mini-infobar; we show our own button
    installEvent.value = e as BeforeInstallPromptEvent;
  };
  const onInstalled = () => {
    installEvent.value = null;
  };
  target.addEventListener('beforeinstallprompt', onBefore);
  target.addEventListener('appinstalled', onInstalled);
  return () => {
    target.removeEventListener('beforeinstallprompt', onBefore);
    target.removeEventListener('appinstalled', onInstalled);
  };
}

/** Show the browser's install dialog. Returns the outcome, or null if not installable. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | null> {
  const ev = installEvent.value;
  if (!ev) return null;
  installEvent.value = null; // the event can only be used once
  await ev.prompt();
  const choice = await ev.userChoice;
  return choice.outcome;
}

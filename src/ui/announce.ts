// A brief message shown over the image and read out by screen readers (role="status").
import { signal } from '@preact/signals';

export const announcement = signal('');

let timer: ReturnType<typeof setTimeout> | undefined;

/** How long a message stays on screen. */
export const ANNOUNCE_MS = 5000;

/** Shows `text` for a few seconds. An empty string clears it. */
export function announce(text: string): void {
  clearTimeout(timer);
  announcement.value = text;
  if (text) timer = setTimeout(() => (announcement.value = ''), ANNOUNCE_MS);
}

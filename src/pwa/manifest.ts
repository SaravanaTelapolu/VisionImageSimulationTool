import type { ManifestOptions } from 'vite-plugin-pwa';

/** Matches `--bg` in src/ui/app.css. */
export const THEME_COLOR = '#000000';
/** Matches `--bg` in src/ui/app.css (splash screen background). */
export const BACKGROUND_COLOR = '#000000';

/**
 * Web app manifest. All URLs are relative (`./`, `icons/...`) so the app works when hosted
 * under a sub-path such as https://user.github.io/repo/. No `orientation` is set, so desktop
 * and rotated phones are not forced into portrait.
 */
export const manifestConfig: Partial<ManifestOptions> = {
  name: 'Vision Simulator',
  short_name: 'Vision Sim',
  description:
    'Private, on-device simulator that shows what one damaged eye sees on any photo. A communication aid, not a diagnostic tool.',
  start_url: './',
  scope: './',
  display: 'standalone',
  theme_color: THEME_COLOR,
  background_color: BACKGROUND_COLOR,
  categories: ['health', 'utilities'],
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: 'icons/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
};

/** Glob patterns of build output that the service worker precaches. */
export const PRECACHE_GLOBS = ['**/*.{js,css,html,svg,png,woff2}'];

/** Help-page screenshots and animations are large and only useful online, so they are not precached. */
export const PRECACHE_IGNORES = ['help/media/**'];

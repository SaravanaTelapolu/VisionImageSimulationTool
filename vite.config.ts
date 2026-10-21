/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
// @ts-ignore -- @types/node is not installed (and no dependency may be added)
import { webcrypto } from 'node:crypto';
import { manifestConfig, PRECACHE_GLOBS } from './src/pwa/manifest';

// Node 18 has no global Web Crypto, which workbox's minifier needs (serialize-javascript).
// Polyfill it in this process; the minifier's worker threads cannot be polyfilled, so on such a
// Node the service worker is emitted unminified instead of failing the build.
const g = globalThis as { crypto?: { getRandomValues?: unknown } };
const canMinifySw = typeof g.crypto?.getRandomValues === 'function';
if (!canMinifySw) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

export default defineConfig({
  // Relative base: the build works under any sub-path (e.g. GitHub Pages /repo/).
  base: './',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null, // registered by src/pwa/register.ts
      manifest: manifestConfig,
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
      workbox: {
        globPatterns: PRECACHE_GLOBS,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        mode: canMinifySw ? 'production' : 'development',
        disableDevLogs: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
  },
});

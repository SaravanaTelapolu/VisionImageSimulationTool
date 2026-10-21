// Records the how-to clips and screenshots for the Help page and the README (not a test suite).
// Run: npm run help:capture   (builds the app, records, then makes the GIFs with ffmpeg)
import { defineConfig } from '@playwright/test';

const PORT = 4176;
const channel = process.env.CI ? undefined : 'msedge';
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: '.',
  testMatch: 'capture.spec.ts',
  outputDir: './out/test-results',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    channel,
    launchOptions: { args },
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    cwd: '../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});

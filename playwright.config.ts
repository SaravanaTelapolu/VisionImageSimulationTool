import { defineConfig, devices } from '@playwright/test';

const PORT = 4175;
// Locally the installed Microsoft Edge is used (no browser download); CI installs Playwright's chromium.
const channel = process.env.CI ? undefined : 'msedge';
// Headless Chromium has no GPU: software WebGL (SwiftShader) keeps the WebGL2 preview working.
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'on-first-retry',
    channel,
    launchOptions: { args },
    acceptDownloads: true,
  },
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      // Pixel 7 descriptor (touch, 412x915, mobile UA), same Edge channel locally.
      use: { ...devices['Pixel 7'], channel, launchOptions: { args } },
    },
  ],
  webServer: {
    // Test the production build, including the service worker and the map Web Worker.
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});

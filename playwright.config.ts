import { defineConfig, devices } from '@playwright/test';

/** Same base path as GitHub Pages so asset URLs are exercised exactly as deployed. */
const BASE = '/neurodrive-city/';
const PORT = 4173;
const ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * WebGL in headless Chromium: the default GPU path is tried first. Set ND_SWIFTSHADER=1
 * to force the SwiftShader software rasterizer (see DECISIONS.md for which one CI uses).
 */
const swiftshader = process.env.ND_SWIFTSHADER === '1';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `${ORIGIN}${BASE}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        launchOptions: {
          args: swiftshader
            ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
            : ['--ignore-gpu-blocklist'],
        },
      },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `${ORIGIN}${BASE}`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { VITE_BASE: BASE },
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

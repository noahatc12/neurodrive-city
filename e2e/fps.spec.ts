import type { Page } from '@playwright/test';
import { test, expect, waitForApp } from './fixtures.ts';
import { waitForGeometry } from './nd.ts';

interface StatsHook {
  avgFrameMs: number;
  avgRenderMs: number;
  avgSimMs: number;
  fps: number;
}

/** Samples the app's rolling frame statistics every 250 ms for `ms` milliseconds. */
async function sample(page: Page, ms: number): Promise<StatsHook> {
  const samples: StatsHook[] = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await page.waitForTimeout(250);
    samples.push(await page.evaluate(() => ({ ...(window.__ND__.stats as unknown as StatsHook) })));
  }
  const avg = (k: keyof StatsHook): number =>
    samples.reduce((a, s) => a + s[k], 0) / samples.length;
  return {
    avgFrameMs: avg('avgFrameMs'),
    avgRenderMs: avg('avgRenderMs'),
    avgSimMs: avg('avgSimMs'),
    fps: avg('fps'),
  };
}

test('2D frame time stays under 33 ms in headless Chromium (smoke threshold)', async ({ page }) => {
  await page.goto('./');
  await waitForApp(page);
  await page.evaluate(() => window.__ND__.actions.loadBundled('worlds/grid-town.world.json'));
  await waitForGeometry(page);
  await page.evaluate(() => window.__ND__.actions.setMode('simulate'));
  await page.waitForTimeout(1500);
  const sim = await sample(page, 5000);
  console.info(
    `2D Simulate (Grid Town, 14 traffic + your car + AI demo car), headless: frame ${sim.avgFrameMs.toFixed(1)} ms, render ${sim.avgRenderMs.toFixed(1)} ms, sim ${sim.avgSimMs.toFixed(2)} ms`,
  );
  expect(sim.avgFrameMs).toBeLessThan(33);

  // informational: 300-car training in 2D (software rendering is not the target hardware)
  await page.evaluate(() => window.__ND__.actions.setMode('train'));
  await page.waitForTimeout(1500);
  const train = await sample(page, 3000);
  console.info(
    `2D Train (300 AI cars + 14 traffic), headless: frame ${train.avgFrameMs.toFixed(1)} ms, render ${train.avgRenderMs.toFixed(1)} ms, sim ${train.avgSimMs.toFixed(2)} ms per frame`,
  );
  expect(train.avgRenderMs).toBeLessThan(16.7);
});

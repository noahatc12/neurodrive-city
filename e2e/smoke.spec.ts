import { test, expect, shot, canvasVariance, waitForApp } from './fixtures.ts';
import { nd, waitForGeometry } from './nd.ts';

test('app boots with zero console errors and a non-blank canvas', async ({ page }) => {
  await page.goto('./');
  await waitForApp(page);
  await expect(page.locator('canvas').first()).toBeVisible();
  // let a few frames render
  await page.waitForTimeout(300);
  expect(await canvasVariance(page), 'empty editor canvas variance').toBeGreaterThan(2);
  // load the demo city for the hero screenshot
  await nd(page, () => window.__ND__.actions.loadDemo(42));
  await waitForGeometry(page);
  await page.waitForTimeout(500);
  const variance = await canvasVariance(page);
  expect(variance, 'canvas pixel variance (0 = blank)').toBeGreaterThan(50);
  await shot(page, 'editor-2d');
});

import { test, expect, shot, canvasVariance, waitForApp } from './fixtures.ts';

test('app boots with zero console errors and a non-blank canvas', async ({ page }) => {
  await page.goto('./');
  await waitForApp(page);
  await expect(page.locator('canvas').first()).toBeVisible();
  // let a few frames render
  await page.waitForTimeout(500);
  const variance = await canvasVariance(page);
  expect(variance, 'canvas pixel variance (0 = blank)').toBeGreaterThan(20);
  await shot(page, 'editor-2d');
});

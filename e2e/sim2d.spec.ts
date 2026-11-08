import type { Page } from '@playwright/test';
import { test, expect, shot, canvasVariance, waitForApp } from './fixtures.ts';
import { nd, waitForGeometry } from './nd.ts';

interface SimHooks {
  stepCount: number;
  time: number;
  carPositions: number[][];
  manual: { x: number; y: number; speed: number; damaged: boolean } | null;
  traffic: { active: number; arrivals: number; damageEvents: number };
}

const simState = (page: Page): Promise<SimHooks | null> =>
  page.evaluate(() => (window.__ND__ as unknown as { sim: SimHooks | null }).sim);

test('Simulate mode: traffic moves, the manual car drives with the keyboard', async ({ page }) => {
  await page.goto('./');
  await waitForApp(page);
  await page.evaluate(() => window.__ND__.actions.loadBundled('worlds/grid-town.world.json'));
  await waitForGeometry(page);
  await page.locator('.stage').click({ position: { x: 700, y: 450 } });
  await page.keyboard.press('Tab');
  await expect.poll(() => nd(page, () => window.__ND__.mode)).toBe('simulate');
  await expect.poll(async () => (await simState(page))?.stepCount ?? 0).toBeGreaterThan(0);
  const first = await simState(page);
  await page.waitForTimeout(3000);
  const later = await simState(page);
  expect(later?.stepCount ?? 0).toBeGreaterThan(first?.stepCount ?? 0);
  // traffic cars moved
  const moved = (later?.carPositions ?? []).filter((p, i) => {
    const q = first?.carPositions[i];
    return q && Math.hypot((p[0] ?? 0) - (q[0] ?? 0), (p[1] ?? 0) - (q[1] ?? 0)) > 30;
  }).length;
  expect(moved).toBeGreaterThan(5);
  expect(later?.traffic.active).toBeGreaterThan(10);

  // drive the manual car forward with the arrow key
  const m0 = later?.manual;
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(900);
  await page.keyboard.up('ArrowUp');
  const m1 = (await simState(page))?.manual;
  expect(m0 && m1 && Math.hypot(m1.x - m0.x, m1.y - m0.y)).toBeGreaterThan(50);
  await page.waitForTimeout(300);
  // frame time while simulating (rAF intervals measured in the page)
  const frameMs = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const xs: number[] = [];
        let last = performance.now();
        const tick = (t: number): void => {
          xs.push(t - last);
          last = t;
          if (xs.length < 90) requestAnimationFrame(tick);
          else resolve(xs.slice(5).reduce((a, b) => a + b, 0) / (xs.length - 5));
        };
        requestAnimationFrame(tick);
      }),
  );
  console.info(
    `simulate mode (2D, 14 traffic cars + manual car): avg frame ${frameMs.toFixed(1)} ms`,
  );
  expect(await canvasVariance(page)).toBeGreaterThan(50);
  await shot(page, 'sim-2d');

  // Tab returns to Edit mode and the simulation stops
  await page.keyboard.press('Tab');
  await expect.poll(() => nd(page, () => window.__ND__.mode)).toBe('edit');
  expect(await simState(page)).toBeNull();
});

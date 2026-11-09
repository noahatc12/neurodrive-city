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
  // the neural network panel is visible and animating (two captures differ)
  const panel = page.locator('.nn-canvas');
  await expect(panel).toBeVisible();
  const a1 = await panel.screenshot();
  await page.waitForTimeout(250);
  const a2 = await panel.screenshot();
  expect(a1.equals(a2)).toBe(false);
  await shot(page, 'sim-2d');

  // Tab returns to Edit mode and the simulation stops
  await page.keyboard.press('Tab');
  await expect.poll(() => nd(page, () => window.__ND__.mode)).toBe('edit');
  expect(await simState(page)).toBeNull();
});

interface LaneHooks {
  roadWidth: number;
  path: number[];
  from: number;
  to: number;
  cars: { x: number; y: number; damaged: boolean; eliminated: boolean }[];
}

/** Signed distance of (x, y) from the lane path, positive to the right of travel. */
function signedLateral(path: readonly number[], x: number, y: number): number {
  let best = Infinity;
  let signed = 0;
  for (let i = 0; i + 3 < path.length; i += 2) {
    const ax = path[i] as number;
    const ay = path[i + 1] as number;
    const dx = (path[i + 2] as number) - ax;
    const dy = (path[i + 3] as number) - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
    if (d < best) {
      best = d;
      // right of a direction (dx, dy) in y-down space is (−dy, dx)
      signed = (x - ax) * -dy + (y - ay) * dx < 0 ? -d : d;
    }
  }
  return signed;
}

test('Simulate: the AI demo car follows the route right of the centre line', async ({ page }) => {
  await page.goto('./');
  await waitForApp(page);
  await expect
    .poll(() => nd(page, () => (window.__ND__ as unknown as { cityBrain: boolean }).cityBrain))
    .toBe(true);
  await page.evaluate(() => window.__ND__.actions.loadBundled('worlds/grid-town.world.json'));
  await waitForGeometry(page);
  await page.evaluate(() => window.__ND__.actions.setMode('simulate'));
  const lane = (): Promise<LaneHooks | null> =>
    page.evaluate(() => (window.__ND__ as unknown as { lane: LaneHooks | null }).lane);
  await expect.poll(async () => (await lane())?.cars.length ?? 0).toBe(1);
  // the demo car drives the bundled city brain (12 inputs)
  await expect(page.locator('.nn-canvas')).toBeVisible();
  const samples: { lat: number; x: number; y: number }[] = [];
  const first = await lane();
  expect(first).not.toBeNull();
  const centreLine = -(first?.roadWidth ?? 100) / 4; // the lane centre is w/4 right of it
  for (let k = 0; k < 40; k++) {
    const l = await lane();
    const car = l?.cars[0];
    if (l && car) samples.push({ lat: signedLateral(l.path, car.x, car.y), x: car.x, y: car.y });
    await page.waitForTimeout(250);
  }
  const worst = Math.min(...samples.map((s) => s.lat));
  let travelled = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a && b) travelled += Math.hypot(b.x - a.x, b.y - a.y);
  }
  console.info(
    `demo car over 10 s: ${samples.length} samples, ${travelled.toFixed(0)} units driven, lateral offset from ${worst.toFixed(1)} to ${Math.max(...samples.map((s) => s.lat)).toFixed(1)} (centre line at ${centreLine})`,
  );
  expect(samples.length).toBeGreaterThanOrEqual(30);
  expect(travelled).toBeGreaterThan(300); // it actually drives
  for (const s of samples) expect(s.lat).toBeGreaterThan(centreLine);
  // follow the demo car (F) for the screenshot
  await page.evaluate(() => window.__ND__.actions.run('view.focusBest'));
  await expect.poll(() => nd(page, () => window.__ND__.focusCar?.kind ?? null)).toBe('ai');
  await page.waitForTimeout(1200);
  await shot(page, 'sim-city');
});

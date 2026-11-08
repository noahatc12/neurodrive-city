import { test, expect, shot, canvasVariance, waitForApp } from './fixtures.ts';
import { at, nd, waitForGeometry } from './nd.ts';

test('demo city: generated geometry, pseudo-3D and minimap navigation', async ({ page }) => {
  await page.goto('./');
  await waitForApp(page);
  await nd(page, () => window.__ND__.actions.loadDemo(42));
  await waitForGeometry(page);
  const geo = await nd(page, () => window.__ND__.geometry);
  expect(geo?.roads).toBeGreaterThan(30);
  expect(geo?.borders).toBeGreaterThan(100);
  expect(geo?.buildings).toBeGreaterThan(20);
  expect(geo?.trees).toBeGreaterThan(10);
  console.info(`demo city generated in ${geo?.genMs.toFixed(1)} ms`, geo?.timings);
  await page.waitForTimeout(400);
  expect(await canvasVariance(page)).toBeGreaterThan(50);
  await shot(page, 'demo-city');

  // Minimap: clicking a corner moves the camera there (eased).
  const before = await nd(page, () => window.__ND__.viewport.center);
  const box = await page.locator('.minimap-canvas').boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.2);
  await expect
    .poll(async () => {
      const c = await nd(page, () => window.__ND__.viewport.center);
      return Math.hypot(c.x - before.x, c.y - before.y);
    })
    .toBeGreaterThan(300);
  // the static minimap layer was drawn once for this world, not every frame
  const redraws = await nd(page, () => window.__ND__.minimap.staticRedraws);
  await page.waitForTimeout(300);
  expect(await nd(page, () => window.__ND__.minimap.staticRedraws)).toBe(redraws);
});

test('dragging a point in a 325-segment world keeps frames flowing', async ({ page }) => {
  await page.goto('./');
  await waitForApp(page);
  await nd(page, () =>
    window.__ND__.actions.loadDemo(7, { cols: 16, rows: 11, removeFraction: 0 }),
  );
  await waitForGeometry(page);
  const segs = await nd(page, () => window.__ND__.world.graph.segmentCount);
  expect(segs).toBeGreaterThanOrEqual(300);
  await nd(page, () => window.__ND__.actions.setView(0, 0, 0.5));
  await page.waitForTimeout(200);
  const pt = await nd(page, () => {
    const p = window.__ND__.world.graph.points[80];
    return p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
  });
  const start = await at(page, pt.x, pt.y);
  // sample frame intervals in the page while dragging
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __sampling: boolean };
    w.__frames = [];
    w.__sampling = true;
    let last = performance.now();
    const tick = (t: number): void => {
      w.__frames.push(t - last);
      last = t;
      if (w.__sampling) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(start.x + i * 4, start.y + i * 3);
    await page.waitForTimeout(16);
  }
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __sampling: boolean };
    w.__sampling = false;
    return w.__frames.slice(2);
  });
  await page.mouse.up();
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  const max = Math.max(...frames);
  console.info(
    `drag in ${segs}-segment world: ${frames.length} frames, avg ${avg.toFixed(1)} ms, max ${max.toFixed(1)} ms`,
  );
  expect(frames.length).toBeGreaterThan(10);
  expect(avg).toBeLessThan(50); // headless software rendering: generous smoke threshold
  // full regeneration happens on drop
  await waitForGeometry(page);
});

test('worlds over 400 segments generate in a worker while the UI keeps rendering', async ({
  page,
}) => {
  await page.goto('./');
  await waitForApp(page);
  const framesBefore = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const tick = (): void => {
          n++;
          if (performance.now() - t0 < 300) requestAnimationFrame(tick);
          else resolve(n);
        };
        requestAnimationFrame(tick);
      }),
  );
  await nd(page, () =>
    window.__ND__.actions.loadDemo(11, { cols: 22, rows: 14, removeFraction: 0 }),
  );
  const segs = await nd(page, () => window.__ND__.world.graph.segmentCount);
  expect(segs).toBeGreaterThan(400);
  // frames keep coming while the worker runs
  const framesDuring = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const tick = (): void => {
          n++;
          if (performance.now() - t0 < 300) requestAnimationFrame(tick);
          else resolve(n);
        };
        requestAnimationFrame(tick);
      }),
  );
  expect(framesDuring).toBeGreaterThan(framesBefore * 0.3);
  await waitForGeometry(page, 60_000);
  const geo = await nd(page, () => window.__ND__.geometry);
  console.info(`${segs}-segment world generated in a worker in ${geo?.genMs.toFixed(0)} ms`);
  expect(geo?.buildings).toBeGreaterThan(100);
});

import type { Page } from '@playwright/test';
import { test, expect, shot, canvasVariance, waitForApp } from './fixtures.ts';
import { nd, waitForGeometry } from './nd.ts';

const r3 = (page: Page): Promise<Window['__ND__']['render3d']> =>
  nd(page, () => window.__ND__.render3d);

test('3D view: lazy load, instanced city, camera modes, picking, draw calls, memory', async ({
  page,
}) => {
  test.setTimeout(150_000); // software WebGL in headless Chromium renders a few frames a second
  await page.goto('./');
  await waitForApp(page);
  await page.evaluate(() => window.__ND__.actions.loadDemo(20251107));
  await waitForGeometry(page);
  expect((await r3(page)).loaded).toBe(false); // nothing 3D loaded up front

  // V toggles the 3D view (dynamic import), crossfading the canvases
  await page.keyboard.press('v');
  await expect.poll(async () => (await r3(page)).ready, { timeout: 30_000 }).toBe(true);
  expect(await nd(page, () => window.__ND__.view)).toBe('3d');
  const info = await r3(page);
  console.info(`WebGL renderer: ${info.glRenderer ?? 'unknown'}`);
  console.info(`3D scene build for the demo city: ${(info.buildMs ?? 0).toFixed(0)} ms`);
  await expect(page.locator('.stage-3d')).toHaveCSS('opacity', '1');
  await expect(page.locator('.stage-2d')).toHaveCSS('opacity', '0');
  await expect(page.locator('.camera-chips')).toBeVisible();
  await expect(page.locator('.view-settings')).toBeVisible();
  // fixed settings for comparable screenshots (software rendering would auto-downgrade)
  await page.evaluate(() => {
    window.__ND__.actions.setQuality('high', false);
    window.__ND__.actions.setTimeOfDay(0.42);
  });
  await expect(page.locator('.view-settings [data-quality="high"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Simulate mode puts traffic and the manual car into the 3D city
  await page.evaluate(() => window.__ND__.actions.setMode('simulate'));
  await expect
    .poll(async () => (await nd(page, () => window.__ND__.sim))?.stepCount ?? 0)
    .toBeGreaterThan(30);
  await page.waitForTimeout(1500); // camera settles after the fade
  expect(await canvasVariance(page, '.stage-3d')).toBeGreaterThan(50);
  const dc = await nd(page, () => window.__ND__.stats.drawCalls);
  console.info(
    `3D draw calls (demo city, simulate): ${dc}, triangles: ${(await r3(page)).triangles ?? 0}`,
  );
  expect(dc).toBeGreaterThan(5);
  expect(dc).toBeLessThanOrEqual(150);

  // camera chips and the C key; mode changes tween (no hard cut)
  await page.locator('.camera-chips [data-camera="chase"]').click();
  await expect.poll(async () => (await r3(page)).cameraMode).toBe('chase');
  await page.keyboard.press('c');
  await expect.poll(async () => (await r3(page)).cameraMode).toBe('orbit');
  await expect(page.locator('.camera-chips [data-camera="orbit"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('c');
  await expect.poll(async () => (await r3(page)).cameraMode).toBe('top');
  await page.waitForTimeout(1200);
  await page.locator('.camera-chips [data-camera="orbit"]').click();
  await page.waitForTimeout(1200);

  // picking: clicking a traffic car makes it the focused car
  const picked = await page.evaluate(() => {
    const s = window.__ND__.sim;
    if (!s) return null;
    for (const [x, y] of s.carPositions) {
      const p = window.__ND__.actions.project3d(x ?? 0, y ?? 0);
      if (!p || p.x < 40 || p.y < 80 || p.x > 1000 || p.y > 820) continue;
      const hit = window.__ND__.actions.pick3d(p.x, p.y);
      if (hit?.kind === 'car') return hit.id;
    }
    return null;
  });
  expect(picked).not.toBeNull();
  await expect.poll(() => nd(page, () => window.__ND__.focusCarId)).toBe(picked);

  // chase camera on the picked car, then the day screenshot
  await page.evaluate(() => window.__ND__.actions.setCameraMode('chase'));
  await page.waitForTimeout(1600);
  expect(await canvasVariance(page, '.stage-3d')).toBeGreaterThan(50);
  // aerial three-quarter view over the picked car's neighbourhood for the screenshot
  await page.evaluate(() => window.__ND__.actions.setCameraMode('orbit'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const f = window.__ND__.focusCar;
    window.__ND__.actions.frame3d(f?.x ?? 0, f?.y ?? 0, 900);
  });
  await page.waitForTimeout(1500);
  await shot(page, 'sim-3d-day');
  const day = await r3(page);
  expect(day.bloom).toBe(true);
  expect(day.shadows).toBe(true);
  expect(day.markings ?? 0).toBeGreaterThan(5);

  // GPU memory returns to its baseline after 3 rebuilds of the world scene. Measured with
  // the simulation stopped and a still camera so frustum culling cannot change which
  // meshes have been uploaded between samples.
  // (Low preset: no bloom or shadows, so software rendering keeps up; the geometry and
  // texture counts do not depend on the preset)
  await page.evaluate(() => {
    window.__ND__.actions.setMode('edit');
    window.__ND__.actions.setQuality('low', false);
  });
  await page.waitForTimeout(1500);
  const rebuild = async (): Promise<void> => {
    const builds = (await r3(page)).builds ?? 0;
    await page.evaluate(() => window.__ND__.actions.rebuild3d());
    await expect.poll(async () => (await r3(page)).builds ?? 0).toBeGreaterThan(builds);
    await page.waitForTimeout(300);
  };
  await rebuild();
  const before = await r3(page);
  for (let i = 0; i < 3; i++) await rebuild();
  const after = await r3(page);
  console.info(
    `3D memory after 1 and 4 rebuilds: geometries ${before.geometries} → ${after.geometries}, textures ${before.textures} → ${after.textures}`,
  );
  expect(after.geometries).toBe(before.geometries);
  expect(after.textures).toBe(before.textures);

  // back to 2D: the editor works again
  await page.keyboard.press('v');
  await expect.poll(() => nd(page, () => window.__ND__.view)).toBe('2d');
  await expect(page.locator('.stage-2d')).toHaveCSS('opacity', '1');
  await expect(page.locator('.camera-chips')).toBeHidden();
  const n0 = await nd(page, () => window.__ND__.world.graph.pointCount);
  await page.evaluate(() => window.__ND__.actions.setView(60000, 60000, 1)); // empty area
  await page.waitForTimeout(400);
  await page.locator('.stage').click({ position: { x: 700, y: 450 } });
  await expect.poll(() => nd(page, () => window.__ND__.world.graph.pointCount)).toBe(n0 + 1);
});

test('3D night: bloom on rays, lamps and windows; slow frames lower the quality', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('./');
  await waitForApp(page);
  await page.evaluate(() => window.__ND__.actions.loadDemo(20251107));
  await waitForGeometry(page);
  await page.evaluate(() => window.__ND__.actions.setRenderView('3d'));
  await expect.poll(async () => (await r3(page)).ready, { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => {
    window.__ND__.actions.setQuality('high', false);
    window.__ND__.actions.setTimeOfDay(0.42);
    window.__ND__.actions.setMode('simulate');
  });
  await expect
    .poll(async () => (await nd(page, () => window.__ND__.sim))?.stepCount ?? 0)
    .toBeGreaterThan(30);

  // L tweens the time of day; the AI demo car's rays, lamps, beacons and lit
  // windows bloom
  await page.keyboard.press('f'); // follow the AI demo car (it has sensors)
  await page.keyboard.press('l');
  await expect
    .poll(async () => (await r3(page)).night ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(0.95);
  await page.evaluate(() => {
    const f = window.__ND__.focusCar;
    window.__ND__.actions.frame3d(f?.x ?? 0, f?.y ?? 0, 520);
  });
  await page.waitForTimeout(1500);
  const night = await r3(page);
  expect(night.rays ?? 0).toBeGreaterThan(0);
  expect(await nd(page, () => window.__ND__.stats.drawCalls)).toBeLessThanOrEqual(150);
  console.info(
    `3D draw calls at night with bloom: ${await nd(page, () => window.__ND__.stats.drawCalls)}`,
  );
  expect(await canvasVariance(page, '.stage-3d')).toBeGreaterThan(20);
  await shot(page, 'sim-3d-night');

  // auto quality: software rendering is slower than 20 ms per frame, so after 3 s of slow
  // frames the preset steps down and a toast explains why
  await page.evaluate(() => window.__ND__.actions.setQuality('high', true));
  await expect.poll(async () => (await r3(page)).quality, { timeout: 20_000 }).toBe('medium');
  await expect(page.locator('.toast')).toContainText(['3D quality was lowered to medium']);
  await page.evaluate(() => {
    window.__ND__.actions.setQuality('high', false);
    window.__ND__.actions.setTimeOfDay(0.42);
  });
});

test('3D OSM sample: imported footprints are extruded and water is drawn', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('./');
  await waitForApp(page);
  await page.evaluate(() => window.__ND__.actions.loadBundled('worlds/osm-sample.world.json'));
  await waitForGeometry(page);
  await page.evaluate(() => window.__ND__.actions.setRenderView('3d'));
  await expect.poll(async () => (await r3(page)).ready, { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => {
    window.__ND__.actions.setQuality('high', false);
    window.__ND__.actions.setTimeOfDay(0.62);
    window.__ND__.actions.frame3d(600, 2300, 1500);
  });
  await page.waitForTimeout(2000);
  const s = await r3(page);
  expect(s.footprints ?? 0).toBeGreaterThan(5);
  expect(s.water).toBe(1);
  expect(await nd(page, () => window.__ND__.stats.drawCalls)).toBeLessThanOrEqual(150);
  expect(await canvasVariance(page, '.stage-3d')).toBeGreaterThan(50);
  await shot(page, 'osm-3d');
});

test('3D view: without WebGL the app toasts and stays in 2D', async ({ page }) => {
  await page.addInitScript(() => {
    // simulate a browser without WebGL
    type GetContext = (this: HTMLCanvasElement, type: string, ...rest: unknown[]) => unknown;
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: GetContext };
    const orig = proto.getContext;
    proto.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2' || type === 'webgl') return null;
      return orig.call(this, type, ...rest);
    };
  });
  await page.goto('./');
  await waitForApp(page);
  await page.keyboard.press('v');
  await expect(page.locator('.toast-error')).toContainText('3D view unavailable');
  expect(await nd(page, () => window.__ND__.view)).toBe('2d');
  expect((await r3(page)).loaded).toBe(false);
  expect(await canvasVariance(page, '.stage-2d')).toBeGreaterThan(5);
});

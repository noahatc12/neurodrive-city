import { test, expect, shot, waitForApp } from './fixtures.ts';
import { nd, waitForGeometry } from './nd.ts';

test('Load sample OSM from the world menu builds a > 50 segment road network', async ({ page }) => {
  await page.goto('./');
  await waitForApp(page);
  await page.getByRole('button', { name: 'World menu' }).click();
  await page.getByRole('menuitem', { name: 'Load sample OSM' }).click();
  await expect
    .poll(() => nd(page, () => window.__ND__.world.graph.segmentCount))
    .toBeGreaterThan(50);
  await waitForGeometry(page);
  const geo = await nd(page, () => window.__ND__.geometry);
  expect(geo?.buildings).toBeGreaterThan(10);
  expect(await nd(page, () => window.__ND__.world.markings.size)).toBeGreaterThan(3);
  await page.waitForTimeout(600);
  await shot(page, 'osm-import');
});

test('OSM dialog: load sample, import with options; invalid JSON shows a toast', async ({
  page,
}) => {
  await page.goto('./');
  await waitForApp(page);
  await page.getByRole('button', { name: 'World menu' }).click();
  await page.getByRole('menuitem', { name: 'Import OSM…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import OpenStreetMap' });
  await expect(dialog).toBeVisible();
  // invalid JSON first
  await dialog.getByLabel('Overpass JSON').fill('{ not json');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('.toast-error')).toBeVisible();
  // then the bundled sample, as two-way roads only
  await page.getByRole('button', { name: 'World menu' }).click();
  await page.getByRole('menuitem', { name: 'Import OSM…' }).click();
  await dialog.getByRole('button', { name: 'Load sample' }).click();
  await expect(dialog.getByLabel('Overpass JSON')).toHaveValue(/elements/);
  await dialog.getByText('Include one-way roads').click();
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect
    .poll(() => nd(page, () => window.__ND__.world.graph.segmentCount))
    .toBeGreaterThan(50);
  const oneWays = await page.evaluate(
    () =>
      (window.__ND__.world.graph.segments as unknown as { oneWay: boolean }[]).filter(
        (s) => s.oneWay,
      ).length,
  );
  expect(oneWays).toBe(0);
});

test('world library lists autosaved worlds and switches between them', async ({ page }) => {
  await page.goto('./');
  await waitForApp(page);
  await nd(page, () => window.__ND__.actions.loadDemo(42));
  await waitForGeometry(page);
  await nd(page, () => window.__ND__.actions.autosaveNow());
  await page.getByRole('button', { name: 'World menu' }).click();
  await page.getByRole('menuitem', { name: 'Ring road' }).click();
  await expect.poll(() => nd(page, () => window.__ND__.world.graph.segmentCount)).toBe(28);
  await nd(page, () => window.__ND__.actions.autosaveNow());
  await page.getByRole('button', { name: 'World menu' }).click();
  await page.getByRole('menuitem', { name: 'World library…' }).click();
  const dialog = page.getByRole('dialog', { name: 'World library' });
  await expect(dialog.locator('.lib-card')).toHaveCount(2);
  await dialog
    .locator('.lib-card', { hasText: 'Demo City' })
    .getByRole('button', { name: 'Open' })
    .click();
  await expect
    .poll(() => nd(page, () => window.__ND__.world.graph.segmentCount))
    .toBeGreaterThan(40);
});

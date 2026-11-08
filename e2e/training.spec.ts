import type { Page } from '@playwright/test';
import { test, expect, shot, waitForApp } from './fixtures.ts';
import { nd, waitForGeometry } from './nd.ts';

interface TrainingHooks {
  generation: number;
  alive: number;
  total: number;
  bestFitness: number;
  bestEver: number;
  infinite: boolean;
}

const training = (page: Page): Promise<TrainingHooks | null> =>
  page.evaluate(() => (window.__ND__ as unknown as { training: TrainingHooks | null }).training);
const nn = (page: Page): Promise<{ framesDrawn: number; collapsed: boolean; hasBrain: boolean }> =>
  page.evaluate(
    () =>
      (
        window.__ND__ as unknown as {
          nn: { framesDrawn: number; collapsed: boolean; hasBrain: boolean };
        }
      ).nn,
  );

test('training: 50 cars at ×8 for 10 s reach generation ≥ 2, save the brain, survive a reload', async ({
  page,
}) => {
  await page.goto('./');
  await waitForApp(page);
  await page.evaluate(() => window.__ND__.actions.loadBundled('worlds/grid-town.world.json'));
  await waitForGeometry(page);
  await page.evaluate(() => {
    const a = window.__ND__.actions as unknown as {
      setTraining(c: { cars: number; timeLimit: number }): void;
    };
    a.setTraining({ cars: 50, timeLimit: 30 });
  });
  await page.locator('.stage').click({ position: { x: 700, y: 450 } });
  await page.keyboard.press('t');
  await expect.poll(() => nd(page, () => window.__ND__.mode)).toBe('train');
  await expect.poll(async () => (await training(page))?.total ?? 0).toBe(50);
  await page.evaluate(() => window.__ND__.actions.setSimSpeed(8));
  await page.waitForTimeout(10_000);
  const t = await training(page);
  console.info('training after 10 s at ×8:', t);
  expect(t?.generation ?? 0).toBeGreaterThanOrEqual(2);
  expect(t?.bestEver ?? 0).toBeGreaterThan(0);
  // the network panel is animating the best car's brain
  const f0 = (await nn(page)).framesDrawn;
  await page.waitForTimeout(400);
  expect((await nn(page)).framesDrawn).toBeGreaterThan(f0);
  await expect(page.locator('.nn-panel')).toBeVisible();
  await shot(page, 'train-2d');

  // save the best brain (S) and check it persists across a reload
  await page.keyboard.press('s');
  await expect(page.locator('.toast-success')).toBeVisible();
  expect((await nn(page)).hasBrain).toBe(true);
  await page.reload();
  await waitForApp(page);
  expect((await nn(page)).hasBrain).toBe(true);
});

test('infinite road: training runs on the endless 3-lane road', async ({ page }) => {
  await page.goto('./');
  await waitForApp(page);
  await page.evaluate(() => {
    const a = window.__ND__.actions as unknown as {
      setTraining(c: { cars: number; timeLimit: number }): void;
    };
    a.setTraining({ cars: 80, timeLimit: 30 });
  });
  await page.getByRole('button', { name: 'World menu' }).click();
  await page.getByRole('menuitem', { name: 'Infinite road' }).click();
  await expect.poll(async () => (await training(page))?.infinite ?? false).toBe(true);
  await page.evaluate(() => window.__ND__.actions.setSimSpeed(4));
  await page.waitForTimeout(4000);
  const t = await training(page);
  expect(t?.bestFitness ?? 0).toBeGreaterThan(100);
  await page.evaluate(() => window.__ND__.actions.setSimSpeed(1));
  await page.waitForTimeout(500);
  await shot(page, 'infinite-road');
  // Edit returns to the city
  await page.keyboard.press('Tab');
  await expect.poll(() => nd(page, () => window.__ND__.mode)).toBe('edit');
});

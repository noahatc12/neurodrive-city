import type { Page } from '@playwright/test';
import { test, expect, shot, waitForApp } from './fixtures.ts';
import { at, nd } from './nd.ts';

/** Clicks a world point. `page.mouse.click` has no modifiers option, so keys are held explicitly. */
async function clickWorld(
  page: Page,
  x: number,
  y: number,
  modifiers: ('Shift' | 'Alt')[] = [],
): Promise<void> {
  const p = await at(page, x, y);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(p.x, p.y);
  for (const m of modifiers) await page.keyboard.up(m);
}

const counts = (page: Page) =>
  nd(page, () => [window.__ND__.world.graph.pointCount, window.__ND__.world.graph.segmentCount]);

test('editor: draw, drag, select, split, delete, box select, undo all, persist', async ({
  page,
}) => {
  await page.goto('./');
  await waitForApp(page);
  await nd(page, () => window.__ND__.actions.setView(0, 0, 1));
  await page.waitForTimeout(100);

  // 1. Four clicks add four connected points; clicking the first closes the loop.
  await clickWorld(page, -300, -200);
  await clickWorld(page, 300, -200);
  await clickWorld(page, 300, 200);
  await clickWorld(page, -300, 200);
  expect(await nd(page, () => window.__ND__.world.graph.points.length)).toBe(4);
  await clickWorld(page, -300, -200);
  expect(await counts(page)).toEqual([4, 4]);
  await shot(page, 'editor-graph');

  // 2. Drag a point, then undo and redo the move.
  const from = await at(page, 300, 200);
  const to = await at(page, 380, 260);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  const moved = await nd(page, () =>
    window.__ND__.world.graph.points.some(
      (p) => Math.abs(p.x - 380) < 1 && Math.abs(p.y - 260) < 1,
    ),
  );
  expect(moved).toBe(true);
  await page.keyboard.press('Control+z');
  expect(
    await nd(page, () =>
      window.__ND__.world.graph.points.some(
        (p) => Math.abs(p.x - 300) < 1 && Math.abs(p.y - 200) < 1,
      ),
    ),
  ).toBe(true);
  await page.keyboard.press('Control+Shift+z');
  expect(
    await nd(page, () => window.__ND__.world.graph.points.some((p) => Math.abs(p.x - 380) < 1)),
  ).toBe(true);

  // 3. Click a segment to select it, shift-click adds another.
  await page.keyboard.press('Escape');
  await clickWorld(page, 0, -200);
  expect(await nd(page, () => window.__ND__.editor.selectedSegmentIds.length)).toBe(1);
  await clickWorld(page, -300, 0, ['Shift']);
  expect(await nd(page, () => window.__ND__.editor.selectedSegmentIds.length)).toBe(2);

  // 4. Toggle one-way on the selection, then delete it.
  await page.keyboard.press('o');
  await page.keyboard.press('Delete');
  expect(await counts(page)).toEqual([4, 2]);
  await page.keyboard.press('Control+z');
  expect(await counts(page)).toEqual([4, 4]);

  // 5. Alt+click splits a segment, inserting a point.
  await page.keyboard.press('Escape');
  await clickWorld(page, 0, -200, ['Alt']);
  expect(await counts(page)).toEqual([5, 5]);

  // 6. Place a stop marking with the marking tool (2), bound to a road.
  await page.keyboard.press('2');
  await clickWorld(page, -150, -180);
  expect(await nd(page, () => window.__ND__.world.markings.size)).toBe(1);
  await page.keyboard.press('1');

  // 7. Shift+drag box selects the left half; Delete removes those points.
  const a = await at(page, -420, -320);
  const b = await at(page, -100, 320);
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  expect(await nd(page, () => window.__ND__.editor.selectedPointIds.length)).toBe(2);
  await page.keyboard.press('Delete');
  expect(await counts(page)).toEqual([3, 2]);
  expect(await nd(page, () => window.__ND__.world.markings.size)).toBe(0); // its segment went with the points

  // 8. Undo everything back to an empty world, then redo it all.
  let guard = 0;
  while ((await nd(page, () => window.__ND__.history.undo)) > 0 && guard++ < 100)
    await page.keyboard.press('Control+z');
  expect(await counts(page)).toEqual([0, 0]);
  guard = 0;
  while ((await nd(page, () => window.__ND__.history.canRedo)) && guard++ < 100)
    await page.keyboard.press('Control+Shift+z');
  expect(await counts(page)).toEqual([3, 2]);

  // 9. Autosave (IndexedDB) survives a reload.
  await nd(page, () => window.__ND__.actions.autosaveNow());
  await page.reload();
  await waitForApp(page);
  await expect.poll(() => counts(page)).toEqual([3, 2]);
});

import { test, expect, shot, waitForApp } from './fixtures.ts';
import { nd } from './nd.ts';

interface Extra {
  reducedMotion: boolean;
  tour: { active: boolean; step: number };
}
const reduced = (): boolean => (window.__ND__ as unknown as Extra).reducedMotion;
const tourState = (): Extra['tour'] => (window.__ND__ as unknown as Extra).tour;

test('first-run tour: four coach marks, keyboard driven, shown once', async ({ page }) => {
  await page.goto('./?tour');
  await waitForApp(page);
  const card = page.getByRole('dialog', { name: 'Build your city' });
  await expect(card).toBeVisible();
  await expect(page.locator('.tour-count')).toHaveText('1 of 4');
  await page.waitForTimeout(400);
  await shot(page, 'tour');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tour-count')).toHaveText('2 of 4');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.tour-count')).toHaveText('1 of 4');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.tour-count')).toHaveText('4 of 4');
  await expect(page.locator('.tour-card .btn-primary')).toHaveText('Done');
  await page.locator('.tour-card .btn-primary').click();
  await expect(page.locator('.tour')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('nd:tour'))).toBe('done');
  await page.reload();
  await waitForApp(page);
  await page.waitForTimeout(900);
  expect((await nd(page, tourState)).active).toBe(false);
  // Help can replay it
  await page.keyboard.press('?');
  await page.getByRole('button', { name: 'Replay the tour' }).click();
  await expect(page.locator('.tour-count')).toHaveText('1 of 4');
  await page.keyboard.press('Escape');
  await expect(page.locator('.tour')).toBeHidden();
});

test('controls have accessible names and visible keyboard focus', async ({ page }) => {
  await page.goto('./');
  await waitForApp(page);
  const unnamed = await page.evaluate(() => {
    const out: string[] = [];
    const els = document.querySelectorAll<HTMLElement>('button, input, select, [role="button"]');
    for (const el of els) {
      if (el.closest('[hidden], .hidden') || el.offsetParent === null) continue;
      if (el instanceof HTMLInputElement && el.type === 'file') continue;
      const forLabel = el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null;
      const label =
        el.getAttribute('aria-label') ??
        forLabel ??
        el.closest('label')?.textContent ??
        el.textContent;
      if (!label || !label.trim()) out.push(el.outerHTML.slice(0, 80));
    }
    return out;
  });
  expect(unnamed).toEqual([]);
  // Tab reaches the controls and the focused control shows a focus ring
  await page.locator('body').click({ position: { x: 5, y: 890 } });
  let ring = '';
  for (let i = 0; i < 8 && !ring; i++) {
    await page.keyboard.press('Tab');
    ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || !el.matches(':focus-visible')) return '';
      const cs = getComputedStyle(el);
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      return outline || cs.boxShadow !== 'none' ? `${el.tagName} ${cs.outlineStyle}` : '';
    });
  }
  expect(ring).not.toBe('');
});

test('layout fits 1280×720 without overlap or horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('./');
  await waitForApp(page);
  await page.evaluate(() => window.__ND__.actions.loadBundled('worlds/grid-town.world.json'));
  for (const mode of ['edit', 'simulate'] as const) {
    await page.evaluate((m) => window.__ND__.actions.setMode(m), mode);
    await page.waitForTimeout(700);
    const report = await page.evaluate(() => {
      const visible = (sel: string): DOMRect | null => {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el || el.offsetParent === null) return null;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return null;
        return el.getBoundingClientRect();
      };
      const names = ['.topbar', '.left-dock', '.statusbar', '.minimap', '.hud', '.nn-panel'];
      const boxes: [string, DOMRect][] = [];
      for (const n of names) {
        const r = visible(n);
        if (r) boxes.push([n, r]);
      }
      const overlaps: string[] = [];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const [na, a] = boxes[i] as [string, DOMRect];
          const [nb, b] = boxes[j] as [string, DOMRect];
          const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ix > 4 && iy > 4) overlaps.push(`${na} x ${nb}`);
        }
      const outside = boxes
        .filter(
          ([, r]) =>
            r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1,
        )
        .map(([n]) => n);
      return { overlaps, outside, scroll: document.documentElement.scrollWidth > innerWidth };
    });
    expect(report, mode).toEqual({ overlaps: [], outside: [], scroll: false });
  }
  await shot(page, 'layout-1280x720');
});

test('reduced motion is honoured', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await waitForApp(page);
  expect(await nd(page, reduced)).toBe(true);
  const dur = await page.evaluate(
    () => getComputedStyle(document.querySelector('.stage-canvas') as Element).transitionDuration,
  );
  expect(parseFloat(dur)).toBeLessThanOrEqual(0.15);
});

test('an uncaught error shows the error overlay with copyable details', async ({
  page,
  errors,
}) => {
  await page.goto('./');
  await waitForApp(page);
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('deliberate test error');
    }, 0);
  });
  const dialog = page.getByRole('alertdialog', { name: 'Unexpected error' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('deliberate test error');
  await expect(dialog.getByRole('button', { name: 'Copy details' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Dismiss' }).click();
  await expect(dialog).toBeHidden();
  // the deliberate error is the only one recorded; the fixture then checks the rest is clean
  expect(errors).toEqual(['pageerror: deliberate test error']);
  errors.length = 0;
});

test('training controls show only in Train mode', async ({ page }) => {
  await page.goto('./');
  await waitForApp(page);
  await page.evaluate(() => window.__ND__.actions.loadBundled('worlds/grid-town.world.json'));
  await page.evaluate(() => window.__ND__.actions.setMode('simulate'));
  await expect(page.locator('.nn-panel')).toBeVisible();
  await expect(page.locator('.train-controls')).toBeHidden();
  await page.evaluate(() => window.__ND__.actions.setMode('train'));
  await expect(page.locator('.train-controls')).toBeVisible();
  // city training offers AI navigation; the curvy toggle belongs to the infinite road
  await expect(page.getByText('Route inputs (AI navigation)')).toBeVisible();
  await expect(page.getByText('Curvy road')).toBeHidden();
});

test('the World menu works from the keyboard', async ({ page }) => {
  await page.goto('./');
  await waitForApp(page);
  const button = page.getByRole('button', { name: 'World menu' });
  await button.click();
  const first = page.getByRole('menuitem', { name: 'Demo city' });
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Ring road' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Dispose world' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(first).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toBeFocused();
});

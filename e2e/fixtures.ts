import { test as base, expect, type Page } from '@playwright/test';
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Bump at the start of each phase so screenshots are archived per phase. */
export const CURRENT_PHASE = 7;

const here = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = join(here, '__screenshots__');

/**
 * Test fixture that fails the test on any `console.error` or uncaught page error,
 * so "zero console errors" is enforced by every spec, not just the smoke test.
 */
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
      });
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
      await use(errors);
      expect(errors, 'console errors / page errors during the test').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Writes `e2e/__screenshots__/<name>.png` plus a phase-tagged copy
 * `phase-<N>-<name>.png` that is kept as evidence in PROGRESS.md.
 */
export async function shot(page: Page, name: string): Promise<Buffer> {
  mkdirSync(SHOT_DIR, { recursive: true });
  const file = join(SHOT_DIR, `${name}.png`);
  const buf = await page.screenshot({ path: file });
  copyFileSync(file, join(SHOT_DIR, `phase-${CURRENT_PHASE}-${name}.png`));
  return buf;
}

/**
 * Pixel variance of the main canvas region, computed in the page from a screenshot
 * decoded via createImageBitmap. A blank or single-colour canvas has variance ~0.
 */
export async function canvasVariance(page: Page, selector = 'canvas'): Promise<number> {
  const png = await page.locator(selector).first().screenshot();
  const b64 = png.toString('base64');
  return page.evaluate(async (data: string) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let i = 0; i < px.length; i += 16) {
      const l = 0.299 * (px[i] ?? 0) + 0.587 * (px[i + 1] ?? 0) + 0.114 * (px[i + 2] ?? 0);
      sum += l;
      sumSq += l * l;
      n++;
    }
    const mean = sum / n;
    return sumSq / n - mean * mean;
  }, b64);
}

/** Waits until the app has booted and exposed `window.__ND__`. */
export async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const nd = (window as unknown as { __ND__?: { ready?: boolean } }).__ND__;
    return nd?.ready === true;
  });
}

/**
 * Typed access to the app's `window.__ND__` debug hooks from Playwright specs.
 */
import type { Page } from '@playwright/test';

export interface NDGeometry {
  version: number;
  fresh: boolean;
  roads: number;
  borders: number;
  buildings: number;
  trees: number;
  genMs: number;
  timings: Record<string, number>;
}

export interface NDHooks {
  ready: boolean;
  world: {
    graph: {
      pointCount: number;
      segmentCount: number;
      points: { id: number; x: number; y: number }[];
      segments: { id: number }[];
    };
    markings: { size: number };
  };
  geometry: NDGeometry | null;
  minimap: { staticRedraws: number };
  stats: { avgFrameMs: number; fps: number; drawCalls: number };
  viewport: { zoom: number; center: { x: number; y: number } };
  history: { undo: number; canRedo: boolean };
  editor: {
    selectedPointId: number | null;
    selectedSegmentIds: number[];
    selectedPointIds: number[];
  };
  actions: {
    run(action: string): void;
    worldToScreen(x: number, y: number): { x: number; y: number };
    setView(x: number, y: number, z: number): void;
    autosaveNow(): Promise<void>;
    loadDemo(seed?: number, opts?: Record<string, number>): void;
    setLayer(key: string, value: boolean): void;
  };
}

declare global {
  interface Window {
    __ND__: NDHooks;
  }
}

/** Evaluates a function in the page (it can read `window.__ND__`). */
export function nd<T>(page: Page, fn: () => T | Promise<T>): Promise<T> {
  return page.evaluate(fn);
}

/** Screen position (page coordinates) of a world point. */
export function at(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([wx, wy]) => window.__ND__.actions.worldToScreen(wx, wy), [x, y] as const);
}

/** Waits until the derived geometry matches the model. */
export async function waitForGeometry(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(() => window.__ND__.geometry?.fresh === true, undefined, { timeout });
}

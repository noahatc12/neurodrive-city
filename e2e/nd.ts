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
  mode: 'edit' | 'simulate' | 'train';
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
  view: '2d' | '3d';
  focusCarId: number | null;
  focusCar: { id: number; x: number; y: number; kind: string } | null;
  render3d: {
    loaded: boolean;
    ready: boolean;
    drawCalls?: number;
    triangles?: number;
    geometries?: number;
    textures?: number;
    programs?: number;
    buildMs?: number;
    builds?: number;
    cameraMode?: string;
    camera?: [number, number, number];
    glRenderer?: string;
    quality?: string;
    autoQuality?: boolean;
    bloom?: boolean;
    shadows?: boolean;
    timeOfDay?: number;
    night?: number;
    rays?: number;
    markings?: number;
    avgFrameMs?: number;
    footprints?: number;
    water?: number;
  };
  sim: { stepCount: number; carCount: number; carPositions: number[][] } | null;
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
    loadBundled(path: string): Promise<boolean>;
    setMode(mode: 'edit' | 'simulate' | 'train'): void;
    setSimSpeed(x: number): void;
    setKeys(k: Partial<Record<'up' | 'down' | 'left' | 'right', boolean>>): void;
    setRenderView(v: '2d' | '3d'): Promise<boolean>;
    setCameraMode(m: string): void;
    rebuild3d(): void;
    frame3d(x: number, y: number, radius: number): void;
    setTimeOfDay(t: number, ms?: number): void;
    setQuality(q: 'low' | 'medium' | 'high', auto?: boolean): void;
    setAutoCycle(on: boolean): void;
    pick3d(x: number, y: number): { kind: string; id: number | null } | null;
    project3d(x: number, y: number): { x: number; y: number } | null;
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

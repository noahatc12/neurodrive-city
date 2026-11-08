/**
 * Keeps derived world geometry in sync with the model, regenerating only when the
 * model's geometry version changes (spec C7):
 *
 * - small worlds regenerate synchronously (a 200-segment city takes well under 150 ms);
 * - while a point is being dragged, small worlds regenerate at most every few frames
 *   (throttled by the last measured cost) and larger ones show a cheap preview only,
 *   with the full regenerate on drop;
 * - worlds above {@link WORKER_THRESHOLD} segments generate in a Web Worker with a
 *   progress bar, so the UI never freezes.
 *
 * @module app/worldManager
 */
import { WorldGeometry, generateWorld, worldInputFrom } from '../engine/world/world.ts';
import type { WorldModel } from '../engine/world/worldModel.ts';
import type { WorldGenRequest, WorldGenResponse } from '../workers/protocol.ts';

export const WORKER_THRESHOLD = 400;
/** Above this many segments, drags show a preview only (no live regeneration). */
export const DRAG_LIVE_MAX = 180;

export interface WorldManagerEvents {
  onProgress?: (fraction: number, stage: string) => void;
  onWorkerDone?: (ms: number) => void;
  onError?: (message: string) => void;
}

export class WorldManager {
  geometry: WorldGeometry | null = null;
  /** Last generation cost in milliseconds (sync or worker). */
  lastGenMs = 0;
  generations = 0;
  private lastRegenAt = -Infinity;
  private worker: Worker | null = null;
  private requestId = 0;
  private pendingVersion = Number.NaN;
  private readonly events: WorldManagerEvents;

  constructor(events: WorldManagerEvents = {}) {
    this.events = events;
  }

  /** True while a worker job is running. */
  get busy(): boolean {
    return !Number.isNaN(this.pendingVersion);
  }

  /** True when the geometry matches the model's current version. */
  isFresh(model: WorldModel): boolean {
    return this.geometry !== null && this.geometry.version === model.geometryVersion;
  }

  /** Call once per frame. */
  update(model: WorldModel, dragging: boolean, nowMs: number): void {
    const v = model.geometryVersion;
    if (this.geometry && this.geometry.version === v) return;
    const segs = model.graph.segmentCount;
    if (dragging) {
      const throttle = Math.max(90, this.lastGenMs * 4);
      if (segs <= DRAG_LIVE_MAX && nowMs - this.lastRegenAt > throttle)
        this.regenerateSync(model, nowMs);
      return;
    }
    if (segs > WORKER_THRESHOLD && typeof Worker !== 'undefined') {
      if (this.pendingVersion !== v) this.regenerateInWorker(model);
      return;
    }
    this.regenerateSync(model, nowMs);
  }

  /** Synchronous regeneration (also used by tests and headless code paths). */
  regenerateSync(model: WorldModel, nowMs = performance.now()): WorldGeometry {
    const t0 = performance.now();
    const data = generateWorld(worldInputFrom(model), { now: () => performance.now() });
    this.geometry = new WorldGeometry(data);
    this.lastGenMs = performance.now() - t0;
    this.lastRegenAt = nowMs;
    this.generations++;
    return this.geometry;
  }

  /** Forces the next update to regenerate (e.g. after loading a new model). */
  reset(): void {
    this.geometry = null;
    this.pendingVersion = Number.NaN;
    this.requestId++;
  }

  private regenerateInWorker(model: WorldModel): void {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/worldgen.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e: MessageEvent<WorldGenResponse>) => this.onWorkerMessage(e.data);
      this.worker.onerror = (e) => {
        this.pendingVersion = Number.NaN;
        this.events.onError?.(e.message);
      };
    }
    const id = ++this.requestId;
    this.pendingVersion = model.geometryVersion;
    const msg: WorldGenRequest = { type: 'generate', id, input: worldInputFrom(model) };
    this.worker.postMessage(msg);
    this.events.onProgress?.(0, 'starting');
  }

  private onWorkerMessage(msg: WorldGenResponse): void {
    if (msg.id !== this.requestId) return; // superseded by a newer request
    if (msg.type === 'progress') {
      this.events.onProgress?.(msg.fraction, msg.stage);
    } else if (msg.type === 'done') {
      this.geometry = new WorldGeometry(msg.data);
      this.lastGenMs = msg.ms;
      this.generations++;
      this.pendingVersion = Number.NaN;
      this.events.onWorkerDone?.(msg.ms);
    } else {
      this.pendingVersion = Number.NaN;
      this.events.onError?.(msg.message);
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

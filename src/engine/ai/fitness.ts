/**
 * Fitness = progress (spec G4). Three trackers, chosen by the world:
 *
 * - {@link RouteProgress}: distance driven along the lane route from the start to the
 *   active target (cars that leave the lane do not earn progress); a bonus on arrival.
 * - {@link CoverageProgress}: when there is no target, distinct road cells visited
 *   (40-unit grid), so driving in circles or wiggling in place earns nothing.
 * - {@link AxisProgress}: distance along −y (the infinite road).
 *
 * All per-car state lives in preallocated typed arrays: updating allocates nothing.
 *
 * @module engine/ai/fitness
 */
import type { Car } from '../car/car.ts';
import { pointAt, projectOnPath, type LanePath } from '../nav/lanePath.ts';
import type { ProgressTracker } from '../sim/host.ts';

/** Progress along −y from the spawn (infinite road). */
export class AxisProgress implements ProgressTracker {
  private readonly startY: Float64Array;
  private readonly best: Float64Array;

  constructor(capacity: number) {
    this.startY = new Float64Array(capacity);
    this.best = new Float64Array(capacity);
  }

  reset(i: number, car: Car): void {
    this.startY[i] = car.y;
    this.best[i] = 0;
  }

  update(i: number, car: Car): number {
    const p = (this.startY[i] as number) - car.y;
    if (p > (this.best[i] as number)) this.best[i] = p;
    return this.best[i] as number;
  }

  waypoint(_i: number, car: Car, out: Float64Array): void {
    // straight ahead is "up": angle error is the heading itself
    out[0] = Math.max(-1, Math.min(1, -car.angle / Math.PI));
  }
}

/** Progress along a lane route; arrival adds the route length again as a bonus. */
export class RouteProgress implements ProgressTracker {
  readonly path: LanePath;
  readonly sStart: number;
  readonly sEnd: number;
  readonly laneTolerance: number;
  private readonly hint: Int32Array;
  private readonly best: Float64Array;
  private readonly done: Uint8Array;
  private readonly lat = new Float64Array(1);
  private readonly pt = new Float64Array(2);

  constructor(
    capacity: number,
    path: LanePath,
    sStart: number,
    sEnd: number,
    laneTolerance: number,
  ) {
    this.path = path;
    this.sStart = sStart;
    this.sEnd = sEnd;
    this.laneTolerance = laneTolerance;
    this.hint = new Int32Array(capacity);
    this.best = new Float64Array(capacity);
    this.done = new Uint8Array(capacity);
  }

  reset(i: number, car: Car): void {
    this.best[i] = 0;
    this.done[i] = 0;
    const s = projectOnPath(this.path, car.x, car.y, 0, Math.min(this.path.count, 24), this.lat);
    this.hint[i] = pointAt(this.path, s, this.pt, 0);
  }

  update(i: number, car: Car): number {
    const h = this.hint[i] as number;
    const s = projectOnPath(this.path, car.x, car.y, h - 2, h + 10, this.lat);
    if ((this.lat[0] as number) <= this.laneTolerance) {
      this.hint[i] = pointAt(this.path, s, this.pt, h);
      const p = s - this.sStart;
      if (p > (this.best[i] as number)) this.best[i] = p;
      if (s >= this.sEnd - 25 && this.done[i] === 0) {
        this.done[i] = 1;
        this.best[i] = (this.best[i] as number) + (this.sEnd - this.sStart);
      }
    }
    return this.best[i] as number;
  }

  finished(i: number): boolean {
    return this.done[i] === 1;
  }

  /** Normalised signed angle from the car heading to the route point 80 units ahead. */
  waypoint(i: number, car: Car, out: Float64Array): void {
    const h = this.hint[i] as number;
    const s = (this.path.cum[Math.min(h, this.path.count - 1)] ?? 0) + 80;
    pointAt(this.path, Math.min(s, this.sEnd), this.pt, h);
    const dx = (this.pt[0] as number) - car.x;
    const dy = (this.pt[1] as number) - car.y;
    // car forward f = (−sin a, −cos a); signed angle from f to (dx, dy), left positive
    const fx = -Math.sin(car.angle);
    const fy = -Math.cos(car.angle);
    const ang = Math.atan2(fx * dy - fy * dx, fx * dx + fy * dy);
    out[0] = Math.max(-1, Math.min(1, -ang / Math.PI));
  }
}

const EMPTY = -2147483648;

/** Distinct 40-unit cells visited per car (open addressing, fixed size per car). */
export class CoverageProgress implements ProgressTracker {
  readonly cell: number;
  private readonly slots: number;
  private readonly table: Int32Array;
  private readonly count: Int32Array;
  private readonly lastCell: Int32Array;

  constructor(capacity: number, cell = 40, slotsPerCar = 1024) {
    this.cell = cell;
    this.slots = slotsPerCar;
    this.table = new Int32Array(capacity * slotsPerCar).fill(EMPTY);
    this.count = new Int32Array(capacity);
    this.lastCell = new Int32Array(capacity).fill(EMPTY);
  }

  reset(i: number, _car: Car): void {
    this.table.fill(EMPTY, i * this.slots, (i + 1) * this.slots);
    this.count[i] = 0;
    this.lastCell[i] = EMPTY;
  }

  update(i: number, car: Car): number {
    const cx = Math.floor(car.x / this.cell);
    const cy = Math.floor(car.y / this.cell);
    const key = ((cx & 0xffff) << 16) | (cy & 0xffff);
    if (key !== this.lastCell[i]) {
      this.lastCell[i] = key;
      if ((this.count[i] as number) < this.slots * 0.7) {
        const base = i * this.slots;
        const h = Math.imul(key, 0x9e3779b1) >>> 0;
        for (let probe = 0; probe < this.slots; probe++) {
          const idx = base + ((h + probe) % this.slots);
          const v = this.table[idx];
          if (v === key) break;
          if (v === EMPTY) {
            this.table[idx] = key;
            this.count[i] = (this.count[i] as number) + 1;
            break;
          }
        }
      }
    }
    return Math.max(0, (this.count[i] as number) - 1) * this.cell;
  }
}

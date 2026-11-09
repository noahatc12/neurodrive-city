/**
 * Fitness = progress (spec G4). Three trackers, chosen by the world:
 *
 * - {@link RouteProgress}: distance driven along the lane route from the start to the
 *   active target, credited by how well the car keeps to its lane; a bonus on arrival.
 * - {@link CoverageProgress}: when there is no target, distinct road cells visited
 *   (40-unit grid), so driving in circles or wiggling in place earns nothing.
 * - {@link AxisProgress}: distance along −y (the infinite road).
 *
 * Lane discipline (route tracker). Each step the car is projected onto the lane path;
 * `lat` is its signed distance from the lane centre (positive toward the kerb, negative
 * toward oncoming traffic) and new ground Δs earns `Δs × laneFactor(lat)`:
 *
 * ```
 *   laneFactor
 *     1 ┤━━━━━━━━━┓                       |lat| ≤ 0.15 w   full credit
 *       │         ┗━━━━┓                  linear to 0.25 at 0.35 w
 *  0.25 ┤              ┗━━┓
 *     0 ┤                 ┗━━━━━━━━━      beyond 0.35 w    nothing
 *       └────────┬────────┬──────── |lat| / w
 *              0.15     0.35
 * ```
 *
 * The lane centre is a quarter road width right of the centre line, so `lat < −0.25 w`
 * means the car's centre is over the centre line; more than 1 s of that is a lane
 * violation (the population eliminates the car like a crash).
 *
 * All per-car state lives in preallocated typed arrays: updating allocates nothing.
 *
 * @module engine/ai/fitness
 */
import type { Car } from '../car/car.ts';
import { pointAt, projectOnPathSigned, type LanePath } from '../nav/lanePath.ts';
import { OBSERVATION_SIZE, type ProgressTracker } from '../sim/host.ts';

/** |lat| (road widths) up to which a car earns full progress. */
export const LANE_FULL = 0.15;
/** |lat| (road widths) at which the credit has fallen to 0.25; nothing beyond. */
export const LANE_EDGE = 0.35;
/** lat (road widths, left of the lane centre) at which the car's centre crosses the centre line. */
export const ONCOMING_LAT = 0.25;
/** Seconds over the centre line before the car is eliminated. */
export const ONCOMING_LIMIT = 1.0;
/** Look-ahead distances along the lane for the two waypoint inputs (units). */
export const WP_NEAR = 60;
export const WP_FAR = 160;
/** Arrival counts this close (units) to the end of the evaluated route. */
const ARRIVE = 25;
/** Below this speed (units/s) a car is not "moving" for the wrong-way rule. */
const MOVING = 1;

/** Credit factor for a lateral offset of `latUnits` on a road `roadWidth` wide. */
export function laneFactor(latUnits: number, roadWidth: number): number {
  const a = Math.abs(latUnits) / roadWidth;
  if (a <= LANE_FULL) return 1;
  if (a > LANE_EDGE) return 0;
  return 1 - (0.75 * (a - LANE_FULL)) / (LANE_EDGE - LANE_FULL);
}

const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

/** Signed angle from the car's forward vector to (dx, dy), normalised by π, left positive. */
function angleTo(car: Car, dx: number, dy: number): number {
  // car forward f = (−sin a, −cos a); in y-down space a positive cross is clockwise
  const fx = -Math.sin(car.angle);
  const fy = -Math.cos(car.angle);
  const ang = Math.atan2(fx * dy - fy * dx, fx * dx + fy * dy);
  return clamp1(-ang / Math.PI);
}

/** Signed heading error of the car against direction (tx, ty): positive = car points left. */
function headingError(car: Car, tx: number, ty: number): number {
  const fx = -Math.sin(car.angle);
  const fy = -Math.cos(car.angle);
  return Math.atan2(ty * fx - tx * fy, tx * fx + ty * fy);
}

/** The lanes of the infinite road, as {@link AxisProgress} needs them. */
export interface AxisLaneFrame {
  readonly laneCount: number;
  readonly laneWidth: number;
  /** x of the road centre at height y. */
  centerX(y: number): number;
  /** Road direction at height y (car heading convention). */
  headingAt(y: number): number;
}

/** One straight lane along x = 0 (the default frame). */
const STRAIGHT_LANE: AxisLaneFrame = Object.freeze({
  laneCount: 1,
  laneWidth: 66,
  centerX: (): number => 0,
  headingAt: (): number => 0,
});

/** Progress along −y from the spawn (infinite road). */
export class AxisProgress implements ProgressTracker {
  readonly lanes: AxisLaneFrame;
  private readonly startY: Float64Array;
  private readonly best: Float64Array;
  private readonly obs = new Float64Array(OBSERVATION_SIZE);

  constructor(capacity: number, lanes: AxisLaneFrame = STRAIGHT_LANE) {
    this.lanes = lanes;
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

  /** x of lane `k`'s centre at height y. */
  private laneX(k: number, y: number): number {
    const f = this.lanes;
    return f.centerX(y) + (k - (f.laneCount - 1) / 2) * f.laneWidth;
  }

  /**
   * Route inputs relative to the nearest lane (the lane centres traffic drives on):
   * `lat` is normalised by half a lane width (a quarter of a two-lane city road).
   */
  observe(_i: number, car: Car, out: Float64Array): void {
    const f = this.lanes;
    const rel = (car.x - f.centerX(car.y)) / f.laneWidth + (f.laneCount - 1) / 2;
    const k = Math.max(0, Math.min(f.laneCount - 1, Math.round(rel)));
    const road = f.headingAt(car.y);
    // the road runs toward −y; its right (toward +x when straight) is (cos h, −sin h)
    const lat = (car.x - this.laneX(k, car.y)) * Math.cos(road);
    out[0] = clamp1(lat / (f.laneWidth / 2));
    let herr = car.angle - road;
    while (herr > Math.PI) herr -= Math.PI * 2;
    while (herr < -Math.PI) herr += Math.PI * 2;
    out[1] = clamp1(herr / (Math.PI / 2));
    const yn = car.y - WP_NEAR;
    const yf = car.y - WP_FAR;
    out[2] = angleTo(car, this.laneX(k, yn) - car.x, yn - car.y);
    out[3] = angleTo(car, this.laneX(k, yf) - car.x, yf - car.y);
    out[4] = car.speed / car.config.maxSpeed;
  }

  /**
   * @deprecated Use {@link observe}; writes its `wpNear` value into out[0] (the v1 F5
   * waypoint input).
   */
  waypoint(i: number, car: Car, out: Float64Array): void {
    this.observe(i, car, this.obs);
    out[0] = this.obs[2] as number;
  }
}

/**
 * Progress along a lane route, credited by lane discipline (see the module notes);
 * arrival at the end of the evaluated route adds that route length again as a bonus.
 * The evaluated route can be capped at a horizon (curriculum training).
 */
export class RouteProgress implements ProgressTracker {
  readonly path: LanePath;
  readonly sStart: number;
  readonly sEnd: number;
  readonly roadWidth: number;
  /** Evaluated route length from the start (≤ the whole route). */
  horizon: number;
  private readonly hint: Int32Array;
  /** Furthest arc position reached (ground already consumed). */
  private readonly sMax: Float64Array;
  /** Credited progress (plus the arrival bonus). */
  private readonly award: Float64Array;
  private readonly done: Uint8Array;
  private readonly oncoming: Float64Array;
  private readonly aliveTime: Float64Array;
  private readonly inLaneTime: Float64Array;
  private readonly factor: Float64Array;
  private readonly proj = new Float64Array(4);
  private readonly pt = new Float64Array(2);
  private readonly obs = new Float64Array(OBSERVATION_SIZE);

  constructor(capacity: number, path: LanePath, sStart: number, sEnd: number, roadWidth: number) {
    this.path = path;
    this.sStart = sStart;
    this.sEnd = sEnd;
    this.roadWidth = roadWidth;
    this.horizon = sEnd - sStart;
    this.hint = new Int32Array(capacity);
    this.sMax = new Float64Array(capacity);
    this.award = new Float64Array(capacity);
    this.done = new Uint8Array(capacity);
    this.oncoming = new Float64Array(capacity);
    this.aliveTime = new Float64Array(capacity);
    this.inLaneTime = new Float64Array(capacity);
    this.factor = new Float64Array(capacity).fill(1);
  }

  /** The whole route's length (start to target). */
  get routeLength(): number {
    return this.sEnd - this.sStart;
  }

  setHorizon(units: number): void {
    this.horizon = Math.max(1, Math.min(this.routeLength, units));
  }

  /** Arc position where the evaluated route ends. */
  get goal(): number {
    return this.sStart + this.horizon;
  }

  reset(i: number, car: Car): void {
    const s = projectOnPathSigned(this.path, car.x, car.y, 0, 24, this.proj);
    this.hint[i] = pointAt(this.path, s, this.pt, 0);
    this.sMax[i] = Math.max(this.sStart, s);
    this.award[i] = 0;
    this.done[i] = 0;
    this.oncoming[i] = 0;
    this.aliveTime[i] = 0;
    this.inLaneTime[i] = 0;
    this.factor[i] = laneFactor(this.proj[1] as number, this.roadWidth);
  }

  update(i: number, car: Car, dt = 1 / 60): number {
    const h = this.hint[i] as number;
    const s = projectOnPathSigned(this.path, car.x, car.y, h - 4, h + 24, this.proj);
    const lat = this.proj[1] as number;
    const herr = headingError(car, this.proj[2] as number, this.proj[3] as number);
    const wrongWay = Math.abs(herr) > Math.PI / 2 && Math.abs(car.speed) > MOVING;
    const f = wrongWay ? 0 : laneFactor(lat, this.roadWidth);
    this.factor[i] = f;
    this.aliveTime[i] = (this.aliveTime[i] as number) + dt;
    if (f === 1) this.inLaneTime[i] = (this.inLaneTime[i] as number) + dt;
    if (lat < -ONCOMING_LAT * this.roadWidth) this.oncoming[i] = (this.oncoming[i] as number) + dt;
    const sMax = this.sMax[i] as number;
    if (wrongWay) {
      // earns nothing and keeps the hint; the ground is consumed so it cannot be
      // claimed later by turning around
      if (s > sMax) this.sMax[i] = s;
    } else {
      this.hint[i] = pointAt(this.path, s, this.pt, h);
      if (s > sMax) {
        this.award[i] = (this.award[i] as number) + (s - sMax) * f;
        this.sMax[i] = s;
      }
      if (this.done[i] === 0 && f > 0 && (this.sMax[i] as number) >= this.goal - ARRIVE) {
        this.done[i] = 1;
        this.award[i] = (this.award[i] as number) + this.horizon;
      }
    }
    return this.award[i] as number;
  }

  finished(i: number): boolean {
    return this.done[i] === 1;
  }

  laneViolation(i: number): boolean {
    return (this.oncoming[i] as number) > ONCOMING_LIMIT;
  }

  inLaneFraction(i: number): number {
    const alive = this.aliveTime[i] as number;
    return alive > 0 ? (this.inLaneTime[i] as number) / alive : Number.NaN;
  }

  laneFactor(i: number): number {
    return this.factor[i] as number;
  }

  /** Route covered by car `i` from the start (units, credited or not). */
  reached(i: number): number {
    return Math.max(0, (this.sMax[i] as number) - this.sStart);
  }

  /** Seconds car `i` has spent with its centre over the centre line. */
  oncomingTime(i: number): number {
    return this.oncoming[i] as number;
  }

  observe(i: number, car: Car, out: Float64Array): void {
    const h = this.hint[i] as number;
    const s = projectOnPathSigned(this.path, car.x, car.y, h - 4, h + 24, this.proj);
    out[0] = clamp1((this.proj[1] as number) / (this.roadWidth / 4));
    const herr = headingError(car, this.proj[2] as number, this.proj[3] as number);
    out[1] = clamp1(herr / (Math.PI / 2));
    const idx = pointAt(this.path, Math.min(s + WP_NEAR, this.sEnd), this.pt, h);
    out[2] = angleTo(car, (this.pt[0] as number) - car.x, (this.pt[1] as number) - car.y);
    pointAt(this.path, Math.min(s + WP_FAR, this.sEnd), this.pt, idx);
    out[3] = angleTo(car, (this.pt[0] as number) - car.x, (this.pt[1] as number) - car.y);
    out[4] = car.speed / car.config.maxSpeed;
  }

  /** @deprecated Use {@link observe}; writes its `wpNear` value into out[0]. */
  waypoint(i: number, car: Car, out: Float64Array): void {
    this.observe(i, car, this.obs);
    out[0] = this.obs[2] as number;
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

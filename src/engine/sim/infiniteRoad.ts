/**
 * "Infinite road" classic mode (spec G7), an homage to the course's first project: a
 * 3-lane road running up the screen forever, with slower traffic that spawns ahead of
 * the leading AI car and is recycled once it falls behind, so the road never ends.
 * An optional curvy variant bends the road with a sine wave.
 *
 * The road borders are kept as a short window of segments around the leader in the
 * collision world, rebuilt each step (a few dozen segments, no allocation).
 *
 * @module engine/sim/infiniteRoad
 */
import { AxisProgress } from '../ai/fitness.ts';
import type { Car } from '../car/car.ts';
import { TRAFFIC_COLORS, createCar } from '../car/carFactory.ts';
import { CollisionWorld } from '../car/damage.ts';
import type { SpawnPose } from '../markings/start.ts';
import { Rng } from '../math/rng.ts';
import type { ProgressTracker, SimExtension, SimHost } from './host.ts';
import { Particles, SkidMarks } from './particlesSim.ts';

export interface InfiniteConfig {
  lanes: number;
  laneWidth: number;
  curvy: boolean;
  /** Sine amplitude of the curvy variant (units). */
  amplitude: number;
  /** Sine wavelength of the curvy variant (units). */
  wavelength: number;
  trafficCount: number;
  /** Traffic cruise speed as a fraction of max speed. */
  trafficSpeed: number;
  seed: number;
}

export const DEFAULT_INFINITE: Readonly<InfiniteConfig> = Object.freeze({
  lanes: 3,
  laneWidth: 66,
  curvy: false,
  amplitude: 150,
  wavelength: 1100,
  trafficCount: 9,
  trafficSpeed: 0.62,
  seed: 1,
});

const BEHIND = 500; // units behind the leader before a traffic car is recycled
const AHEAD = 1600; // border window ahead of the leader
const WINDOW_BACK = 900; // border window behind the leader
const STEP_CURVY = 40;

export class InfiniteRoadSim implements SimHost {
  readonly kind = 'infinite' as const;
  readonly config: InfiniteConfig;
  readonly world = new CollisionWorld();
  readonly particles = new Particles(1024);
  readonly skids = new SkidMarks(2048);
  readonly rng: Rng;
  readonly lights = null;
  readonly traffic: Car[] = [];
  private readonly trafficLane: Int32Array;
  manual: Car | null = null;
  extension: SimExtension | null = null;
  cars: Car[] = [];
  time = 0;
  stepCount = 0;
  /** y of the most advanced live population car (cars move toward −y). */
  leaderY = 0;
  damageCount = 0;
  private readonly carById = new Map<number, Car>();
  private readonly includeDynamic = (c: Car): boolean => c.kind === 'traffic';

  constructor(config: Partial<InfiniteConfig> = {}) {
    this.config = { ...DEFAULT_INFINITE, ...config };
    this.rng = new Rng(this.config.seed);
    this.trafficLane = new Int32Array(this.config.trafficCount);
    for (let i = 0; i < this.config.trafficCount; i++) {
      const c = createCar(500 + i, 'traffic', 'dummy');
      c.color = TRAFFIC_COLORS[i % TRAFFIC_COLORS.length] ?? 1;
      this.traffic.push(c);
    }
    const segCount = Math.ceil((AHEAD + WINDOW_BACK) / STEP_CURVY) + 4;
    this.world.extra = new Float64Array(segCount * 2 * 4);
    this.resetTraffic();
    this.rebuildCarList();
    this.updateBorders();
  }

  /** Road width in units. */
  get roadWidth(): number {
    return this.config.lanes * this.config.laneWidth;
  }

  /** Number of lanes (the lane frame route inputs are measured against). */
  get laneCount(): number {
    return this.config.lanes;
  }

  /** Width of one lane in units. */
  get laneWidth(): number {
    return this.config.laneWidth;
  }

  /** x of the road centre at height y. */
  centerX(y: number): number {
    return this.config.curvy
      ? this.config.amplitude * Math.sin((y / this.config.wavelength) * Math.PI * 2)
      : 0;
  }

  /** x of lane `lane`'s centre at height y. */
  laneX(lane: number, y: number): number {
    return this.centerX(y) + (lane - (this.config.lanes - 1) / 2) * this.config.laneWidth;
  }

  /** Road direction angle (car heading convention) at height y. */
  headingAt(y: number): number {
    if (!this.config.curvy) return 0;
    // dx/dy of the centre line; moving toward −y the forward vector is (−dx/dy, −1)
    const k = (Math.PI * 2) / this.config.wavelength;
    const slope = this.config.amplitude * k * Math.cos(y * k);
    return Math.atan2(slope, 1);
  }

  spawnPose(_index: number): SpawnPose {
    // all population cars start together in the middle lane (course behaviour)
    return { x: this.laneX(Math.floor(this.config.lanes / 2), 0), y: 0, angle: this.headingAt(0) };
  }

  createProgressTracker(capacity: number): ProgressTracker {
    return new AxisProgress(capacity, this);
  }

  setExtension(ext: SimExtension | null): void {
    this.extension = ext;
    this.rebuildCarList();
  }

  getCar(id: number): Car | undefined {
    return this.carById.get(id);
  }

  private rebuildCarList(): void {
    this.cars = [...this.traffic, ...(this.extension ? this.extension.cars : [])];
    this.carById.clear();
    for (const c of this.cars) this.carById.set(c.id, c);
  }

  resetForGeneration(): void {
    this.rng.setState(this.config.seed >>> 0);
    this.resetTraffic();
    this.particles.clear();
  }

  /** Places traffic ahead of the start in random lanes, spaced out. */
  resetTraffic(): void {
    let y = -350;
    for (let i = 0; i < this.traffic.length; i++) {
      const lane = this.rng.int(0, this.config.lanes);
      this.trafficLane[i] = lane;
      const c = this.traffic[i] as Car;
      c.reset(this.laneX(lane, y), y, this.headingAt(y));
      c.speed = c.config.maxSpeed * this.config.trafficSpeed;
      y -= this.rng.range(160, 320);
    }
    this.leaderY = 0;
  }

  /** Writes the left and right border polylines of the current window into the collision world. */
  private updateBorders(): void {
    const half = this.roadWidth / 2;
    const e = this.world.extra;
    let n = 0;
    if (!this.config.curvy) {
      const y0 = this.leaderY + WINDOW_BACK;
      const y1 = this.leaderY - AHEAD;
      for (const side of SIDES) {
        e[n * 4] = side * half;
        e[n * 4 + 1] = y0;
        e[n * 4 + 2] = side * half;
        e[n * 4 + 3] = y1;
        n++;
      }
    } else {
      const start = Math.ceil((this.leaderY + WINDOW_BACK) / STEP_CURVY) * STEP_CURVY;
      for (const side of SIDES) {
        for (let y = start; y > this.leaderY - AHEAD; y -= STEP_CURVY) {
          if ((n + 1) * 4 > e.length) break;
          const y2 = y - STEP_CURVY;
          e[n * 4] = this.centerX(y) + side * half;
          e[n * 4 + 1] = y;
          e[n * 4 + 2] = this.centerX(y2) + side * half;
          e[n * 4 + 3] = y2;
          n++;
        }
      }
    }
    this.world.extraCount = n;
  }

  damage(car: Car): void {
    if (car.damaged) return;
    car.damaged = true;
    car.damagedAt = this.time;
    car.speed = 0;
    this.particles.burst(car.x, car.y, this.rng);
    this.damageCount++;
  }

  afterMove(car: Car, effects = true): void {
    if (!effects) return;
    if (car.speed > 5 && this.rng.chance(car.controls.forward > 0.5 ? 0.12 : 0.03)) {
      const fx = -Math.sin(car.angle);
      const fy = -Math.cos(car.angle);
      const hl = car.config.length / 2;
      this.particles.exhaust(car.x - fx * hl, car.y - fy * hl, -fx, -fy, this.rng);
    }
  }

  /** Keeps traffic in its lane at cruise speed and recycles cars left behind. */
  private stepTraffic(dt: number): void {
    const cruise = this.traffic[0] ? this.traffic[0].config.maxSpeed * this.config.trafficSpeed : 0;
    let farthest = this.leaderY;
    for (const c of this.traffic) if (c.y < farthest) farthest = c.y;
    for (let i = 0; i < this.traffic.length; i++) {
      const c = this.traffic[i] as Car;
      const lane = this.trafficLane[i] as number;
      // lateral P-control toward the lane centre, slightly ahead
      const ahead = c.y - 60;
      const tx = this.laneX(lane, ahead);
      const fx = -Math.sin(c.angle);
      const fy = -Math.cos(c.angle);
      const dx = tx - c.x;
      const dy = ahead - c.y;
      // lateral offset of the target, positive to the left of travel (left = (fy, −fx))
      const yl = dx * fy - dy * fx;
      const steer = Math.max(-1, Math.min(1, yl * 0.035));
      c.controls.left = steer > 0 ? steer : 0;
      c.controls.right = steer < 0 ? -steer : 0;
      c.controls.forward = c.speed < cruise ? 1 : 0;
      c.controls.reverse = 0;
      c.updatePhysics(dt);
      if (c.y > this.leaderY + BEHIND) {
        // recycle ahead of everything, in a lane not occupied nearby
        const y = Math.min(farthest, this.leaderY) - this.rng.range(500, 900);
        const newLane = this.rng.int(0, this.config.lanes);
        this.trafficLane[i] = newLane;
        c.reset(this.laneX(newLane, y), y, this.headingAt(y));
        c.speed = cruise;
        farthest = Math.min(farthest, y);
      }
    }
  }

  step(dt: number): void {
    // leader = most advanced live population car
    const ext = this.extension;
    if (ext) {
      let best = Infinity;
      for (const c of ext.cars) if (!c.damaged && c.active && c.y < best) best = c.y;
      if (best < Infinity) this.leaderY = best;
    }
    this.updateBorders();
    this.world.setDynamic(this.cars, this.cars.length, this.includeDynamic);
    this.stepTraffic(dt);
    ext?.step(this, dt);
    this.particles.update(dt);
    this.time += dt;
    this.stepCount++;
  }
}

const SIDES = [-1, 1] as const;

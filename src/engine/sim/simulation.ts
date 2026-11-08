/**
 * The simulation: a fixed-step world of cars (manual, traffic and, from Phase 6, the AI
 * population), traffic lights, collisions and particles. Pure engine code: it runs the
 * same in the browser main thread, a Web Worker (turbo training) and Vitest.
 *
 * One `step(dt)` call:
 *   1. traffic lights advance (simulation seconds);
 *   2. collidable cars are copied into the collision world's dynamic set;
 *   3. traffic cars sense, follow their routes, move and check damage;
 *   4. the manual car reads the keyboard state, moves and checks damage;
 *   5. extensions (the AI population) step;
 *   6. particles age.
 *
 * @module engine/sim/simulation
 */
import type { Car } from '../car/car.ts';
import { COLOR_MANUAL, createCar } from '../car/carFactory.ts';
import { applyKeys, makeKeyState, type KeyState } from '../car/controls.ts';
import { CollisionWorld, HIT_CAR, HIT_NONE, type CollisionFlags } from '../car/damage.ts';
import { Sensor, type SensorConfig } from '../car/sensor.ts';
import { spawnPoses, type SpawnPose } from '../markings/start.ts';
import { TrafficLightSystem } from '../markings/trafficLightController.ts';
import { Rng } from '../math/rng.ts';
import { headingFromDirection } from '../markings/start.ts';
import { RouteGraph } from '../nav/routeGraph.ts';
import type { FollowerEnv } from '../nav/routeFollower.ts';
import type { WorldGeometry } from '../world/world.ts';
import type { WorldModel } from '../world/worldModel.ts';
import { Particles, SkidMarks } from './particlesSim.ts';
import { TrafficManager } from './traffic.ts';
import type { ProgressTracker, SimExtension, SimHost } from './host.ts';
import { CoverageProgress, RouteProgress } from '../ai/fitness.ts';
import { planRoute } from '../nav/routeFollower.ts';
import { activeTarget } from '../markings/target.ts';

export interface SimConfig {
  trafficCount: number;
  collisions: CollisionFlags;
  /** Population cars collide with each other (default off: they are ghosts). */
  carCarCollisions: boolean;
  /** Spawn a keyboard-driven car. */
  manual: boolean;
  seed: number;
  sensor: Partial<SensorConfig>;
}

export const DEFAULT_SIM: Readonly<SimConfig> = Object.freeze({
  trafficCount: 14,
  collisions: { buildings: true, trees: true },
  carCarCollisions: false,
  manual: true,
  seed: 1,
  sensor: {},
});

export type { SimExtension } from './host.ts';

export class Simulation implements SimHost {
  readonly kind = 'city' as const;
  readonly model: WorldModel;
  readonly geometry: WorldGeometry;
  readonly config: SimConfig;
  readonly routeGraph: RouteGraph;
  readonly routeNodes: number[];
  readonly world = new CollisionWorld();
  readonly lights = new TrafficLightSystem();
  readonly rng: Rng;
  readonly particles = new Particles(2048);
  readonly skids = new SkidMarks(4096);
  readonly traffic: TrafficManager;
  readonly keys: KeyState = makeKeyState();
  manual: Car | null = null;
  manualSensor: Sensor | null = null;
  extension: SimExtension | null = null;
  /** All cars for renderers (manual, traffic, then extension cars). */
  cars: Car[] = [];
  time = 0;
  stepCount = 0;
  /** Damage events by kind of car. */
  damageCount = { traffic: 0, manual: 0, ai: 0 };
  /** Start poses from Start markings (round-robin spawn). */
  starts: SpawnPose[] = [];
  private lightsVersion = -1;
  private readonly reservations = new Map<number, number>();
  private readonly carById = new Map<number, Car>();
  readonly env: FollowerEnv;
  private readonly includeDynamic = (c: Car): boolean =>
    c.kind !== 'ai' || (this.config.carCarCollisions && !c.damaged);

  constructor(model: WorldModel, geometry: WorldGeometry, config: Partial<SimConfig> = {}) {
    this.model = model;
    this.geometry = geometry;
    this.config = {
      ...DEFAULT_SIM,
      ...config,
      collisions: { ...DEFAULT_SIM.collisions, ...config.collisions },
    };
    this.rng = new Rng(this.config.seed);
    this.world.geometry = geometry;
    this.world.flags = this.config.collisions;
    this.routeGraph = new RouteGraph(model.graph);
    this.routeNodes = this.routeGraph.nodesWithEdges();
    this.syncLights();
    this.starts = spawnPoses(model.markings.ofType('start'), model.graph, model.settings.roadWidth);
    this.env = this.makeEnv();
    this.traffic = new TrafficManager(this, this.config.trafficCount, 1000);
    if (this.config.manual) {
      const car = createCar(1, 'manual');
      car.color = COLOR_MANUAL;
      const pose = this.defaultSpawn();
      car.reset(pose.x, pose.y, pose.angle);
      this.manual = car;
      this.manualSensor = new Sensor(this.config.sensor);
    }
    this.rebuildCarList();
    this.traffic.spawnAll(this.env);
  }

  /** Spawn pose: first Start marking, else a lane near the world centre. */
  defaultSpawn(index = 0): SpawnPose {
    const s = this.starts[index % Math.max(1, this.starts.length)];
    if (s) return s;
    const b = this.geometry.data.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const hit = this.model.graph.nearestSegment(cx, cy, 1e9);
    if (!hit) return { x: cx, y: cy, angle: 0 };
    const seg = hit.segment;
    const len = seg.length() || 1;
    const ux = (seg.b.x - seg.a.x) / len;
    const uy = (seg.b.y - seg.a.y) / len;
    const rw = this.model.settings.roadWidth;
    return {
      x: hit.point.x - uy * (rw / 4),
      y: hit.point.y + ux * (rw / 4),
      angle: headingFromDirection(ux, uy),
    };
  }

  /** Re-seeds and respawns traffic and restarts the lights for a new generation. */
  resetForGeneration(): void {
    this.rng.setState(this.config.seed >>> 0);
    this.reservations.clear();
    this.lights.reset();
    this.traffic.spawnAll(this.env);
    this.particles.clear();
  }

  /** Spawn pose for population car `index` (round-robin over Start markings). */
  spawnPose(index: number): SpawnPose {
    return this.defaultSpawn(index);
  }

  /**
   * Fitness basis for the AI population: progress along the lane route from the first
   * start to the active target when one exists, otherwise distinct road cells covered.
   */
  createProgressTracker(capacity: number): ProgressTracker {
    const target = activeTarget(this.model.markings.ofType('target'));
    const rw = this.model.settings.roadWidth;
    if (target) {
      const r = planRoute(
        this.model.graph,
        this.routeGraph,
        this.model.markings,
        rw,
        this.defaultSpawn(0),
        { marking: target },
      );
      if (r) return new RouteProgress(capacity, r.path, r.sStart, r.sEnd, rw * 0.45);
    }
    return new CoverageProgress(capacity);
  }

  /** Attaches the AI population (or any extension). */
  setExtension(ext: SimExtension | null): void {
    this.extension = ext;
    this.rebuildCarList();
  }

  rebuildCarList(): void {
    const list: Car[] = [];
    if (this.manual) list.push(this.manual);
    list.push(...this.traffic.cars);
    if (this.extension) list.push(...this.extension.cars);
    this.cars = list;
    this.carById.clear();
    for (const c of list) this.carById.set(c.id, c);
  }

  getCar(id: number): Car | undefined {
    return this.carById.get(id);
  }

  private syncLights(): void {
    const v = this.model.markings.version;
    if (v === this.lightsVersion) return;
    this.lightsVersion = v;
    this.lights.build(
      this.model.markings.ofType('light'),
      this.model.graph,
      this.model.settings.roadWidth,
      v,
    );
  }

  /** One fixed simulation step of `dt` seconds. */
  step(dt: number): void {
    this.syncLights();
    this.lights.update(dt);
    this.world.setDynamic(this.cars, this.cars.length, this.includeDynamic);
    this.traffic.step(dt, this.env);
    const m = this.manual;
    if (m && m.active) {
      if (!m.damaged) {
        applyKeys(this.keys, m.controls);
        m.updatePhysics(dt);
        this.afterMove(m);
        if (this.world.polygonHit(m.polygon, m.id) !== HIT_NONE) this.damage(m);
        this.manualSensor?.update(m, this.world, true);
      } else {
        m.updatePhysics(dt);
      }
    }
    this.extension?.step(this, dt);
    this.particles.update(dt);
    this.time += dt;
    this.stepCount++;
  }

  /** Respawns the manual car at the start (after a crash, or on request). */
  resetManual(): void {
    if (!this.manual) return;
    const p = this.defaultSpawn();
    this.manual.reset(p.x, p.y, p.angle);
  }

  /** Marks a car as damaged and emits a spark/smoke burst. */
  damage(car: Car): void {
    if (car.damaged) return;
    car.damaged = true;
    car.damagedAt = this.time;
    car.speed = 0;
    this.particles.burst(car.x, car.y, this.rng);
    if (car.kind === 'traffic') this.damageCount.traffic++;
    else if (car.kind === 'manual') this.damageCount.manual++;
    else this.damageCount.ai++;
  }

  /** Effects after a car moved: exhaust puffs and skid marks. */
  afterMove(car: Car, effects = true): void {
    if (!effects) return;
    const fx = -Math.sin(car.angle);
    const fy = -Math.cos(car.angle);
    const hl = car.config.length / 2;
    if (car.speed > 5 && this.rng.chance(car.controls.forward > 0.5 ? 0.18 : 0.04)) {
      this.particles.exhaust(car.x - fx * hl, car.y - fy * hl, -fx, -fy, this.rng);
    }
    const slip = Math.abs(car.steer) * Math.abs(car.speed);
    if (
      slip > car.config.maxSpeed * 0.62 ||
      (car.braking && car.speed > car.config.maxSpeed * 0.55)
    ) {
      const rx = Math.cos(car.angle);
      const ry = -Math.sin(car.angle);
      const hw = car.config.width * 0.38;
      const pfx = -Math.sin(car.prevAngle);
      const pfy = -Math.cos(car.prevAngle);
      const prx = Math.cos(car.prevAngle);
      const pry = -Math.sin(car.prevAngle);
      for (let side = -1; side <= 1; side += 2) {
        this.skids.add(
          car.prevX - pfx * hl * 0.7 + prx * hw * side,
          car.prevY - pfy * hl * 0.7 + pry * hw * side,
          car.x - fx * hl * 0.7 + rx * hw * side,
          car.y - fy * hl * 0.7 + ry * hw * side,
          5,
          this.time,
        );
      }
    }
  }

  /** True if any traffic or manual car is within r of (x, y). */
  anyCarWithin(x: number, y: number, r: number, selfId: number): boolean {
    for (const c of this.cars) {
      if (c.id === selfId || !c.active || c.kind === 'ai') continue;
      if (Math.hypot(c.x - x, c.y - y) < r) return true;
    }
    return false;
  }

  private makeEnv(): FollowerEnv {
    return {
      lights: this.lights,
      gapAhead: (car: Car): number => {
        const s = car.kind === 'traffic' ? this.traffic.sensors[car.tag] : null;
        if (!s) return Infinity;
        let best = Infinity;
        const len = s.config.length;
        for (let i = 0; i < s.rayCount; i++) {
          if (Math.abs(s.rayAngle(i)) > 0.3 || s.kinds[i] !== HIT_CAR) continue;
          const d = (s.offsets[i] as number) * len - car.config.length / 2;
          if (d < best) best = d;
        }
        return best;
      },
      crossTrafficNear: (x: number, y: number, r: number, car: Car): boolean => {
        const fx = -Math.sin(car.angle);
        const fy = -Math.cos(car.angle);
        const core = this.model.settings.roadWidth * 0.6;
        for (const c of this.cars) {
          if (c === car || !c.active || c.damaged || c.kind === 'ai') continue;
          const d = Math.hypot(c.x - x, c.y - y);
          if (d > r) continue;
          const same = -Math.sin(c.angle) * fx + -Math.cos(c.angle) * fy > 0.9;
          if (same) continue;
          if (d < core || Math.abs(c.speed) > 10) return true;
        }
        return false;
      },
      reserve: (node: number, carId: number): boolean => {
        const holder = this.reservations.get(node);
        if (holder === undefined || holder === carId) {
          this.reservations.set(node, carId);
          return true;
        }
        const h = this.carById.get(holder);
        if (!h || !h.active || h.damaged) {
          this.reservations.set(node, carId);
          return true;
        }
        return false;
      },
      release: (node: number, carId: number): void => {
        if (this.reservations.get(node) === carId) this.reservations.delete(node);
      },
    };
  }
}

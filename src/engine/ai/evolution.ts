/**
 * Neuro-evolution (spec G3–G5): a population of AI cars, each driven by its own neural
 * network, evaluated in parallel; the fittest brains seed the next generation.
 *
 * ```
 *   generation g:  N cars drive ──▶ fitness = progress (− penalties)
 *                       │
 *            all crashed / stuck, or time limit
 *                       ▼
 *   selection:  course     → best brain kept exactly (car 0); everyone else = mutate(best)
 *               tournament → the `elite` best brains kept exactly; others =
 *                            mutate(crossover(tournament(k), tournament(k)))
 *   (car 0 carries the previous elite, re-evaluated: in a deterministic world it
 *    reproduces its score and is never lost)
 *                       ▼
 *   generation g+1 (no page reload)
 * ```
 *
 * Fitness is distance progressed (lane-credited route progress, coverage or −y depending
 * on the world). A crash multiplies it by 0.8, and so does a lane violation (more than
 * 1 s over the centre line), which also eliminates the car; a car that makes no
 * progress for `stuckTimeout` seconds is eliminated. The best car of the current
 * generation is tracked live so the camera can follow it.
 *
 * City worlds train with {@link CITY_EVOLUTION}: route inputs, tanh, tournament
 * selection with three elites, a route curriculum and seeded spawn jitter.
 *
 * Curriculum. With one Start every car begins on the same straight, so no car sees a
 * corner until the straight is solved. The evaluated route is therefore capped at a
 * horizon that starts at min(route, 320) units and grows by 260 whenever at least 10% of
 * the cars reach it in a generation, or the best car reaches it in two generations in a
 * row; reaching the horizon freezes a car with full credit and the arrival bonus.
 *
 * ```
 *   stage 1   S ━━━━━━━┫ 320                 (the first straight)
 *   stage 2   S ━━━━━━━━━━━━━┫ 580           (into the first corner)
 *   ...
 *   stage k   S ━━━━━━━━━━━━━━━━━━━━━━━━━━ T (the whole route)
 * ```
 *
 * @module engine/ai/evolution
 */
import type { Car } from '../car/car.ts';
import { createCar } from '../car/carFactory.ts';
import { HIT_NONE } from '../car/damage.ts';
import { DEFAULT_CITY_SENSOR, Sensor, type SensorConfig } from '../car/sensor.ts';
import { Rng } from '../math/rng.ts';
import {
  OBSERVATION_SIZE,
  type ProgressTracker,
  type SimExtension,
  type SimHost,
} from '../sim/host.ts';
import { crossover, mutate } from './mutate.ts';
import { NeuralNetwork, sameTopology, type Activation } from './network.ts';

export type Selection = 'course' | 'tournament';

export interface EvolutionConfig {
  population: number;
  mutation: number;
  selection: Selection;
  tournamentK: number;
  /** Generation time limit in simulation seconds. */
  timeLimit: number;
  /** Seconds without progress before a car is eliminated. */
  stuckTimeout: number;
  activation: Activation;
  /** Hidden layer sizes. */
  hidden: number[];
  sensor: Partial<SensorConfig>;
  /** AI navigation mode (F5): add the five route inputs ({@link NAV_INPUTS}). */
  navInputs: boolean;
  /** Population cars collide with traffic (always) and sensors see traffic cars. */
  seeTraffic: boolean;
  /**
   * Brains copied unmutated into the next generation under tournament selection: the
   * best brain ever first, then this generation's next best (course selection keeps one).
   */
  elite: number;
  /** Route curriculum (city worlds with a target): evaluate a growing part of the route. */
  curriculum: boolean;
  /** Horizon (units) the curriculum starts from; 0 = {@link CURRICULUM_START}. */
  startHorizon: number;
  /** Seeded spawn jitter: lateral offset, ± this fraction of the road width. */
  jitterLateral: number;
  /** Seeded spawn jitter: heading, ± this many radians. */
  jitterHeading: number;
  /**
   * Re-seed the world's traffic at every generation (fair comparisons while training).
   * Off for the Simulate-mode demo car, whose respawns must not reset the city.
   */
  resetWorldEachGeneration: boolean;
  seed: number;
}

export const DEFAULT_EVOLUTION: Readonly<EvolutionConfig> = Object.freeze({
  population: 300,
  mutation: 0.1,
  selection: 'course',
  tournamentK: 5,
  timeLimit: 60,
  stuckTimeout: 5,
  activation: 'step',
  hidden: [6],
  sensor: {},
  navInputs: false,
  seeTraffic: true,
  elite: 1,
  curriculum: false,
  startHorizon: 0,
  jitterLateral: 0,
  jitterHeading: 0,
  resetWorldEachGeneration: true,
  seed: 1,
});

/** First curriculum horizon (units of route). */
export const CURRICULUM_START = 320;
/** Horizon growth per curriculum stage (units). */
export const CURRICULUM_STEP = 260;
/** Share of the population that must reach the horizon for it to grow. */
export const CURRICULUM_SHARE = 0.1;

/**
 * Training defaults for city worlds (the infinite road keeps {@link DEFAULT_EVOLUTION},
 * the course homage): route inputs, 7 rays over 5π/6 (topology [12, 8, 4]), tanh,
 * tournament selection (k = 5) with crossover and three elites, mutation 0.12, the route
 * curriculum and ±0.08 road widths / ±4° of spawn jitter.
 */
export const CITY_EVOLUTION: Readonly<Partial<EvolutionConfig>> = Object.freeze({
  navInputs: true,
  activation: 'tanh',
  hidden: [8],
  selection: 'tournament',
  tournamentK: 5,
  mutation: 0.12,
  elite: 3,
  sensor: { ...DEFAULT_CITY_SENSOR },
  curriculum: true,
  jitterLateral: 0.08,
  jitterHeading: (4 * Math.PI) / 180,
});

/** {@link CITY_EVOLUTION} with overrides (the sensor is merged, not replaced). */
export function cityEvolution(over: Partial<EvolutionConfig> = {}): Partial<EvolutionConfig> {
  return {
    ...CITY_EVOLUTION,
    ...over,
    hidden: [...(over.hidden ?? CITY_EVOLUTION.hidden ?? [8])],
    sensor: { ...CITY_EVOLUTION.sensor, ...over.sensor },
  };
}

export interface GenerationRecord {
  generation: number;
  best: number;
  average: number;
  /** Simulation seconds the generation lasted. */
  duration: number;
  /** Cars that reached the end of the evaluated route (the target, or the horizon). */
  reached?: number;
  /** Curriculum stage (1-based) and horizon (units) the generation was evaluated at. */
  stage?: number;
  horizon?: number;
}

/**
 * Route inputs of the AI navigation mode (F5), in network order after the rays: lateral
 * offset from the lane centre, heading error against the lane, signed angles to the lane
 * 60 and 160 units ahead, and speed (see {@link ProgressTracker.observe}).
 */
export const NAV_INPUTS = ['lat', 'hdg', 'wpNear', 'wpFar', 'speed'] as const;

/** Short labels for the route inputs (network panel). */
export const NAV_LABELS: Readonly<Record<(typeof NAV_INPUTS)[number], string>> = Object.freeze({
  lat: 'lat',
  hdg: 'hdg',
  wpNear: 'wp near',
  wpFar: 'wp far',
  speed: 'speed',
});

export class Population implements SimExtension {
  readonly config: EvolutionConfig;
  readonly cars: Car[] = [];
  readonly brains: NeuralNetwork[] = [];
  readonly sensors: Sensor[] = [];
  readonly fitness: Float64Array;
  readonly eliminated: Uint8Array;
  readonly topology: number[];
  readonly history: GenerationRecord[] = [];
  generation = 0;
  genTime = 0;
  alive = 0;
  /** Index of the best car in the current generation. */
  bestIndex = 0;
  /** Best brain seen across all generations, with its fitness. */
  bestEver: NeuralNetwork;
  /** Best fitness of any generation (monotone; shown as "best ever"). */
  bestEverFitness = 0;
  /**
   * Fitness of {@link bestEver} in its latest evaluation at the current curriculum stage
   * (0 right after the horizon grows, before it has been evaluated there).
   */
  eliteFitness = 0;
  /** Curriculum stage (1-based). */
  stage = 1;
  /** Evaluated route length in units (Infinity without a route). */
  horizon = Infinity;
  private bestReachedLast = false;
  private readonly rng: Rng;
  /** Spawn jitter has its own stream so turning it on does not change the brains. */
  private readonly jitter: Rng;
  private tracker: ProgressTracker;
  private readonly lastProgress: Float64Array;
  private readonly lastImproveAt: Float64Array;
  private readonly inputs: Float64Array;
  private readonly obs = new Float64Array(OBSERVATION_SIZE);
  /** Called when a generation ends (record of the finished one). */
  onGeneration: (rec: GenerationRecord) => void = () => {};

  constructor(
    host: SimHost,
    config: Partial<EvolutionConfig> = {},
    seedBrain: NeuralNetwork | null = null,
  ) {
    this.config = { ...DEFAULT_EVOLUTION, ...config, sensor: { ...config.sensor } };
    const n = Math.max(1, Math.min(1000, Math.round(this.config.population)));
    this.config.population = n;
    this.rng = new Rng(this.config.seed);
    this.jitter = new Rng((this.config.seed ^ 0x5eed1e) >>> 0);
    this.config.elite = Math.max(1, Math.min(n, Math.round(this.config.elite)));
    if (this.config.startHorizon > 0) this.horizon = this.config.startHorizon;
    const probe = new Sensor(this.config.sensor);
    const inputCount = probe.rayCount + (this.config.navInputs ? NAV_INPUTS.length : 0);
    this.topology = [inputCount, ...this.config.hidden, 4];
    this.inputs = new Float64Array(inputCount);
    this.fitness = new Float64Array(n);
    this.eliminated = new Uint8Array(n);
    this.lastProgress = new Float64Array(n);
    this.lastImproveAt = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = createCar(100_000 + i, 'ai');
      c.tag = i;
      this.cars.push(c);
      this.sensors.push(new Sensor(this.config.sensor));
    }
    const seed =
      seedBrain && seedBrain.inputCount === inputCount && seedBrain.outputCount === 4
        ? seedBrain
        : null;
    for (let i = 0; i < n; i++) {
      if (seed) {
        const b = seed.clone();
        if (i > 0) mutate(b, this.config.mutation, this.rng);
        this.brains.push(b);
      } else {
        this.brains.push(NeuralNetwork.random(this.topology, this.rng, this.config.activation));
      }
    }
    this.bestEver = (this.brains[0] as NeuralNetwork).clone();
    this.tracker = host.createProgressTracker(n);
    this.spawnAll(host);
  }

  /** Number of network inputs (rays plus route inputs). */
  get inputCount(): number {
    return this.topology[0] as number;
  }

  /** The current generation's progress tracker (fitness basis, lane statistics). */
  get progress(): ProgressTracker {
    return this.tracker;
  }

  /** Fraction of its time alive car `i` spent fully in its lane (NaN without a route). */
  inLaneFraction(i: number): number {
    return this.tracker.inLaneFraction?.(i) ?? Number.NaN;
  }

  /** Lane credit factor of car `i` at its last step (NaN without a route). */
  laneFactor(i: number): number {
    return this.tracker.laneFactor?.(i) ?? Number.NaN;
  }

  /** Length of the whole route the tracker follows (NaN without one). */
  get routeLength(): number {
    return this.tracker.routeLength ?? Number.NaN;
  }

  /** Share of the route evaluated this generation (1 without a curriculum or route). */
  get routeShare(): number {
    const len = this.routeLength;
    return Number.isFinite(len) && len > 0 ? Math.min(1, this.horizon / len) : 1;
  }

  /** Applies the curriculum horizon to the current tracker. */
  private applyHorizon(): void {
    const t = this.tracker;
    const len = t.routeLength;
    if (!t.setHorizon || len === undefined) {
      this.horizon = Infinity;
      return;
    }
    if (!this.config.curriculum) this.horizon = len;
    else if (!Number.isFinite(this.horizon)) this.horizon = Math.min(len, CURRICULUM_START);
    this.horizon = Math.min(this.horizon, len);
    t.setHorizon(this.horizon);
  }

  /** The current generation's best car. */
  get bestCar(): Car {
    return this.cars[this.bestIndex] as Car;
  }

  get bestBrain(): NeuralNetwork {
    return this.brains[this.bestIndex] as NeuralNetwork;
  }

  get bestFitness(): number {
    return this.fitness[this.bestIndex] as number;
  }

  /** Places every car at its spawn pose and resets per-generation state. */
  private spawnAll(host: SimHost): void {
    if (this.config.resetWorldEachGeneration) host.resetForGeneration?.();
    this.tracker = host.createProgressTracker(this.cars.length);
    this.applyHorizon();
    const jl = this.config.jitterLateral * host.roadWidth;
    const jh = this.config.jitterHeading;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i] as Car;
      const p = host.spawnPose(i);
      if (jl > 0 || jh > 0) {
        // offset along the right vector of the pose, (cos a, −sin a), then turn
        const off = jl > 0 ? this.jitter.range(-jl, jl) : 0;
        const da = jh > 0 ? this.jitter.range(-jh, jh) : 0;
        c.reset(p.x + Math.cos(p.angle) * off, p.y - Math.sin(p.angle) * off, p.angle + da);
      } else c.reset(p.x, p.y, p.angle);
      c.active = true;
      this.tracker.reset(i, c);
      this.sensors[i]?.clear();
    }
    this.fitness.fill(0);
    this.eliminated.fill(0);
    this.lastProgress.fill(0);
    this.lastImproveAt.fill(0);
    this.genTime = 0;
    this.alive = this.cars.length;
    this.bestIndex = 0;
  }

  /** One simulation step for every live car. */
  step(host: SimHost, dt: number): void {
    const cfg = this.config;
    let alive = 0;
    let best = this.bestIndex;
    let bestFit = -Infinity;
    const inputs = this.inputs;
    const rays = this.sensors[0]?.rayCount ?? 0;
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i] as Car;
      const fit = this.fitness[i] as number;
      if (fit > bestFit) {
        bestFit = fit;
        best = i;
      }
      if (car.damaged || this.eliminated[i] === 1) {
        if (car.damaged) car.updatePhysics(dt);
        continue;
      }
      alive++;
      const sensor = this.sensors[i] as Sensor;
      sensor.update(car, host.world, cfg.seeTraffic);
      for (let k = 0; k < rays; k++) inputs[k] = sensor.readings[k] as number;
      if (cfg.navInputs) {
        const obs = this.obs;
        if (this.tracker.observe) this.tracker.observe(i, car, obs);
        else {
          // no route to observe: only the speed is known
          obs.fill(0);
          obs[OBSERVATION_SIZE - 1] = car.speed / car.config.maxSpeed;
        }
        for (let k = 0; k < OBSERVATION_SIZE; k++) inputs[rays + k] = obs[k] as number;
      }
      const brain = this.brains[i] as NeuralNetwork;
      const out = brain.feedForward(inputs);
      const c = car.controls;
      // outputs follow the brain's own activation (a seed brain may differ from the config)
      if (brain.activation === 'step') {
        c.forward = out[0] as number;
        c.left = out[1] as number;
        c.right = out[2] as number;
        c.reverse = out[3] as number;
      } else {
        c.forward = Math.max(0, out[0] as number);
        c.left = Math.max(0, out[1] as number);
        c.right = Math.max(0, out[2] as number);
        c.reverse = Math.max(0, out[3] as number);
      }
      car.updatePhysics(dt);
      host.afterMove(car, i === this.bestIndex);
      const progress = this.tracker.update(i, car, dt);
      if (progress > (this.lastProgress[i] as number) + 1) {
        this.lastProgress[i] = progress;
        this.lastImproveAt[i] = this.genTime;
      }
      this.fitness[i] = progress;
      if (host.world.polygonHit(car.polygon, car.id) !== HIT_NONE) {
        host.damage(car);
        this.fitness[i] = progress * 0.8;
      } else if (this.tracker.laneViolation?.(i)) {
        // over the centre line for too long: eliminated and penalised like a crash
        this.eliminated[i] = 1;
        this.fitness[i] = progress * 0.8;
        car.speed = 0;
      } else if (this.genTime - (this.lastImproveAt[i] as number) > cfg.stuckTimeout) {
        this.eliminated[i] = 1;
        car.speed = 0;
      } else if (this.tracker.finished?.(i)) {
        this.eliminated[i] = 1; // reached the target: freeze with full credit
        car.speed = 0;
      }
    }
    this.bestIndex = best;
    this.alive = alive;
    this.genTime += dt;
    if (alive === 0 || this.genTime >= cfg.timeLimit) this.nextGeneration(host);
  }

  /** Ends the current generation, breeds the next one and respawns every car. */
  nextGeneration(host: SimHost): GenerationRecord {
    const n = this.cars.length;
    let sum = 0;
    let bi = 0;
    for (let i = 0; i < n; i++) {
      const f = this.fitness[i] as number;
      sum += f;
      if (f > (this.fitness[bi] as number)) bi = i;
    }
    const tracker = this.tracker;
    let reached = 0;
    if (tracker.finished) for (let i = 0; i < n; i++) if (tracker.finished(i)) reached++;
    const rec: GenerationRecord = {
      generation: this.generation,
      best: this.fitness[bi] as number,
      average: sum / n,
      duration: this.genTime,
      reached,
      stage: this.stage,
      horizon: this.horizon,
    };
    this.history.push(rec);
    if (this.history.length > 500) this.history.shift();
    // Elitism: the generation's best brain becomes the elite. Slot 0 carried the previous
    // elite and was re-evaluated this generation, so in a deterministic world the elite is
    // never lost (it reproduces its score); with spawn jitter a lucky run cannot hold the
    // slot forever, because the elite has to keep earning it.
    this.eliteFitness = rec.best;
    this.bestEver = (this.brains[bi] as NeuralNetwork).clone();
    if (rec.best > this.bestEverFitness) this.bestEverFitness = rec.best;
    // a longer horizon resets the elite's bar: fitness at different horizons is not
    // comparable (the elite itself is kept and re-evaluated at the new horizon)
    this.advanceCurriculum(reached, tracker.finished?.(bi) ?? false);
    const keeper = this.bestEver.clone();
    if (this.config.selection === 'tournament') {
      const ranked = Array.from({ length: n }, (_, i) => i).sort(
        (a, b) => (this.fitness[b] as number) - (this.fitness[a] as number),
      );
      const parents = ranked.map((i) => (this.brains[i] as NeuralNetwork).clone());
      const pick = (): NeuralNetwork => {
        let bestIdx = this.rng.int(0, n);
        for (let k = 1; k < this.config.tournamentK; k++) {
          const j = this.rng.int(0, n);
          if (j < bestIdx) bestIdx = j; // ranked: lower index = fitter
        }
        return parents[bestIdx] as NeuralNetwork;
      };
      (this.brains[0] as NeuralNetwork).copyFrom(keeper);
      // further elites: this generation's next best, unmutated (its best is in slot 0)
      let e = 1;
      for (let r = 1; r < n && e < this.config.elite; r++, e++)
        (this.brains[e] as NeuralNetwork).copyFrom(parents[r] as NeuralNetwork);
      for (let i = e; i < n; i++) {
        const child = crossover(pick(), pick(), this.rng);
        mutate(child, this.config.mutation, this.rng);
        (this.brains[i] as NeuralNetwork).copyFrom(child);
      }
    } else {
      for (let i = 0; i < n; i++) {
        const b = this.brains[i] as NeuralNetwork;
        b.copyFrom(keeper);
        if (i > 0) mutate(b, this.config.mutation, this.rng);
      }
    }
    this.generation++;
    this.spawnAll(host);
    this.onGeneration(rec);
    return rec;
  }

  /** Grows the curriculum horizon after a generation (see the module notes). */
  private advanceCurriculum(reached: number, bestReached: boolean): void {
    const len = this.routeLength;
    if (!this.config.curriculum || !Number.isFinite(len) || this.horizon >= len) return;
    const n = this.cars.length;
    if (reached >= CURRICULUM_SHARE * n || (bestReached && this.bestReachedLast)) {
      this.horizon = Math.min(len, this.horizon + CURRICULUM_STEP);
      this.stage++;
      this.bestReachedLast = false;
      this.eliteFitness = 0;
    } else this.bestReachedLast = bestReached;
  }

  /** Restarts from generation 0 with random brains (or a seed brain). */
  reset(host: SimHost, seedBrain: NeuralNetwork | null = null): void {
    for (let i = 0; i < this.brains.length; i++) {
      const b = this.brains[i] as NeuralNetwork;
      if (seedBrain && sameTopology(seedBrain, b)) {
        b.copyFrom(seedBrain);
        if (i > 0) mutate(b, this.config.mutation, this.rng);
      } else {
        const r = NeuralNetwork.random(this.topology, this.rng, this.config.activation);
        b.copyFrom(r);
      }
    }
    this.generation = 0;
    this.history.length = 0;
    this.bestEverFitness = 0;
    this.eliteFitness = 0;
    this.stage = 1;
    this.horizon = this.config.startHorizon > 0 ? this.config.startHorizon : Infinity;
    this.bestReachedLast = false;
    this.bestEver = (this.brains[0] as NeuralNetwork).clone();
    this.spawnAll(host);
  }

  /** Changes the mutation amount used for the next generations. */
  setMutation(amount: number): void {
    this.config.mutation = Math.min(1, Math.max(0, amount));
  }

  setSelection(s: Selection): void {
    this.config.selection = s;
  }
}

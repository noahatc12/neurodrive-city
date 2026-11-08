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
 *               tournament → best kept; others = mutate(crossover(tournament(k), tournament(k)))
 *                       ▼
 *   generation g+1 (no page reload)
 * ```
 *
 * Fitness is distance progressed (lane-credited route progress, coverage or −y depending
 * on the world). A crash multiplies it by 0.8, and so does a lane violation (more than
 * 1 s over the centre line), which also eliminates the car; a car that makes no
 * progress for `stuckTimeout` seconds is eliminated. The best car of the current generation is tracked live so the camera
 * can follow it.
 *
 * @module engine/ai/evolution
 */
import type { Car } from '../car/car.ts';
import { createCar } from '../car/carFactory.ts';
import { HIT_NONE } from '../car/damage.ts';
import { Sensor, type SensorConfig } from '../car/sensor.ts';
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
  resetWorldEachGeneration: true,
  seed: 1,
});

export interface GenerationRecord {
  generation: number;
  best: number;
  average: number;
  /** Simulation seconds the generation lasted. */
  duration: number;
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
  bestEverFitness = 0;
  private readonly rng: Rng;
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
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i] as Car;
      const p = host.spawnPose(i);
      c.reset(p.x, p.y, p.angle);
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
    const rec: GenerationRecord = {
      generation: this.generation,
      best: this.fitness[bi] as number,
      average: sum / n,
      duration: this.genTime,
    };
    this.history.push(rec);
    if (this.history.length > 500) this.history.shift();
    // Elitism: always keep the best brain seen so far (it may come from an older generation).
    if (rec.best >= this.bestEverFitness) {
      this.bestEverFitness = rec.best;
      this.bestEver = (this.brains[bi] as NeuralNetwork).clone();
    }
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
      for (let i = 1; i < n; i++) {
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

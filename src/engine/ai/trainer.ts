/**
 * Headless training (spec G6, G8): runs whole generations of a {@link Population} on a
 * simulation host as fast as the CPU allows, with no rendering. The same code drives the
 * turbo-training Web Worker and `scripts/train.ts`, which produced the bundled
 * pre-trained brain.
 *
 * @module engine/ai/trainer
 */
import { Sensor } from '../car/sensor.ts';
import { InfiniteRoadSim, type InfiniteConfig } from '../sim/infiniteRoad.ts';
import type { SimHost } from '../sim/host.ts';
import { Simulation } from '../sim/simulation.ts';
import type { WorldGeometry } from '../world/world.ts';
import type { WorldModel } from '../world/worldModel.ts';
import { inputNames, serializeBrain, type BrainFile } from './brainSchema.ts';
import { RouteProgress } from './fitness.ts';
import {
  NAV_INPUTS,
  routeInputNames,
  Population,
  cityEvolution,
  type EvolutionConfig,
  type GenerationRecord,
} from './evolution.ts';
import type { NeuralNetwork } from './network.ts';

/** Fixed simulation step (s). */
export const TRAIN_DT = 1 / 60;

/** Rays of the city sensor. */
const CITY_RAYS = new Sensor(cityEvolution().sensor).rayCount;

/** Spawn jitter of city training, as plain numbers (road widths, radians). */
const CITY_JITTER = Object.freeze({
  lateral: cityEvolution().jitterLateral ?? 0.08,
  heading: cityEvolution().jitterHeading ?? (4 * Math.PI) / 180,
});

/** The infinite-road configuration used for the bundled brain and its test. */
export const PRETRAINED_ROAD: Readonly<Partial<InfiniteConfig>> = Object.freeze({
  curvy: false,
  seed: 2026,
});

export class HeadlessTrainer {
  readonly host: SimHost;
  readonly population: Population;
  /** Simulated steps run so far. */
  steps = 0;

  constructor(host: SimHost, population: Population) {
    this.host = host;
    this.population = population;
    host.setExtension(population);
  }

  /** Runs until the current generation ends (or `maxSteps`), returning its record. */
  runGeneration(maxSteps = 60 * 60 * 10): GenerationRecord | null {
    const pop = this.population;
    const g = pop.generation;
    for (let i = 0; i < maxSteps && pop.generation === g; i++) {
      this.host.step(TRAIN_DT);
      this.steps++;
    }
    return pop.generation !== g ? (pop.history[pop.history.length - 1] ?? null) : null;
  }

  /** The best brain seen so far as a brain file. */
  brainFile(world: string, date = new Date().toISOString()): BrainFile {
    const pop = this.population;
    const rays = new Sensor(pop.config.sensor).rayCount;
    return serializeBrain(
      pop.bestEver,
      inputNames(rays, pop.config.navInputs ? routeInputNames(pop.config.lightInput) : []),
      {
        generations: pop.generation,
        bestFitness: Math.round(pop.bestEverFitness * 10) / 10,
        world,
        mutation: pop.config.mutation,
        date,
        population: pop.cars.length,
      },
    );
  }
}

/** A trainer on the infinite road (the classic course setup). */
export function infiniteTrainer(
  evo: Partial<EvolutionConfig>,
  road: Partial<InfiniteConfig> = PRETRAINED_ROAD,
  seedBrain: NeuralNetwork | null = null,
): HeadlessTrainer {
  const host = new InfiniteRoadSim(road);
  return new HeadlessTrainer(host, new Population(host, evo, seedBrain));
}

/** A trainer in a city world (lane-route progress fitness, with traffic). */
export function cityTrainer(
  model: WorldModel,
  geometry: WorldGeometry,
  evo: Partial<EvolutionConfig>,
  seedBrain: NeuralNetwork | null = null,
  trafficCount = 14,
): HeadlessTrainer {
  const host = new Simulation(model, geometry, { trafficCount, manual: false, seed: model.seed });
  return new HeadlessTrainer(host, new Population(host, evo, seedBrain));
}

/** Result of one validation drive of a city brain ({@link validateCityBrain}). */
export interface CityValidation {
  /** Reached the target (the end of the whole route). */
  arrived: boolean;
  crashed: boolean;
  /** Eliminated for more than 1 s over the centre line. */
  laneViolation: boolean;
  /** Eliminated for crossing a stop line on red (brains with the light input). */
  redLight: boolean;
  /** Seconds fully in lane ÷ seconds driven. */
  inLane: number;
  /** Share of the route covered (furthest point reached ÷ route length). */
  routeShare: number;
  seconds: number;
}

/** Thresholds a validation drive must meet to pass. */
export const CITY_PASS = Object.freeze({ inLane: 0.95 });

/** True when a validation drive reached the target cleanly and in lane. */
export function cityDrivePassed(v: CityValidation): boolean {
  return v.arrived && !v.crashed && !v.laneViolation && !v.redLight && v.inLane >= CITY_PASS.inLane;
}

/** Seconds without progress before a validation drive counts as stopped (above a full light cycle). */
export const VALIDATION_STUCK = 30;

/**
 * Drives one exact copy of a city brain alone from the first Start to the active Target,
 * with traffic seeded by `trafficSeed`, until it arrives, crashes, is eliminated or
 * `seconds` pass. `jitterSeed` > 0 adds the training spawn jitter (seeded); 0 spawns on
 * the Start exactly, as the Simulate-mode demo car does. A car may wait up to
 * {@link VALIDATION_STUCK} seconds without progress (behind a car at a red light, say).
 */
export function validateCityBrain(
  model: WorldModel,
  geometry: WorldGeometry,
  net: NeuralNetwork,
  trafficSeed: number,
  jitterSeed = 0,
  seconds = 120,
  trafficCount = 14,
): CityValidation {
  // one AI car is a real road user, as in Simulate mode: traffic sees it and yields to it
  const sim = new Simulation(model, geometry, {
    trafficCount,
    manual: false,
    seed: trafficSeed,
    carCarCollisions: true,
  });
  const pop = new Population(
    sim,
    cityEvolution({
      population: 1,
      mutation: 0,
      curriculum: false,
      timeLimit: seconds + 1,
      stuckTimeout: VALIDATION_STUCK,
      seed: Math.max(1, jitterSeed),
      jitterLateral: jitterSeed > 0 ? CITY_JITTER.lateral : 0,
      jitterHeading: jitterSeed > 0 ? CITY_JITTER.heading : 0,
      // the layout follows the brain: rays only, route inputs, or route inputs and the light
      navInputs: net.inputCount > CITY_RAYS,
      lightInput: net.inputCount > CITY_RAYS + NAV_INPUTS.length,
    }),
    net,
  );
  sim.setExtension(pop);
  const car = pop.cars[0];
  const t = pop.progress;
  const len = pop.routeLength;
  let k = 0;
  const steps = Math.round(seconds / TRAIN_DT);
  while (car && k < steps && pop.generation === 0 && !car.damaged && pop.eliminated[0] === 0) {
    sim.step(TRAIN_DT);
    k++;
  }
  const fraction = t.inLaneFraction?.(0) ?? 0;
  const reach = t instanceof RouteProgress ? t.reached(0) : 0;
  return {
    arrived: t.finished?.(0) ?? false,
    crashed: car?.damaged ?? true,
    laneViolation: t.laneViolation?.(0) ?? false,
    redLight: pop.config.lightInput && (t.redLightViolation?.(0) ?? false),
    inLane: Number.isNaN(fraction) ? 0 : fraction,
    routeShare: Number.isFinite(len) && len > 0 ? Math.min(1, reach / len) : 0,
    seconds: k * TRAIN_DT,
  };
}

/** Summary of {@link broadCityCheck}: many validation drives on unseen traffic. */
export interface BroadCheck {
  drives: number;
  /** Drives that passed ({@link cityDrivePassed}). */
  passes: number;
  arrived: number;
  crashed: number;
  violations: number;
  redLights: number;
  /** Mean in-lane fraction and mean share of the route covered. */
  inLane: number;
  routeShare: number;
}

/** First traffic seed of the broad check (never used for training or the 5-seed validation). */
export const BROAD_SEED = 5000;

/**
 * Drives a city brain on `count` unseen traffic seeds ({@link BROAD_SEED} + k; every other
 * drive with spawn jitter) and summarises the results.
 */
export function broadCityCheck(
  model: WorldModel,
  geometry: WorldGeometry,
  net: NeuralNetwork,
  count = 20,
): BroadCheck {
  const sum: BroadCheck = {
    drives: count,
    passes: 0,
    arrived: 0,
    crashed: 0,
    violations: 0,
    redLights: 0,
    inLane: 0,
    routeShare: 0,
  };
  for (let k = 0; k < count; k++) {
    const v = validateCityBrain(model, geometry, net, BROAD_SEED + k, k % 2 === 1 ? 7000 + k : 0);
    if (cityDrivePassed(v)) sum.passes++;
    if (v.arrived) sum.arrived++;
    if (v.crashed) sum.crashed++;
    if (v.laneViolation) sum.violations++;
    if (v.redLight) sum.redLights++;
    sum.inLane += v.inLane / count;
    sum.routeShare += v.routeShare / count;
  }
  return sum;
}

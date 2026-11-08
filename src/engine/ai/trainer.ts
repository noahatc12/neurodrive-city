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
import {
  NAV_INPUTS,
  Population,
  type EvolutionConfig,
  type GenerationRecord,
} from './evolution.ts';
import type { NeuralNetwork } from './network.ts';

/** Fixed simulation step (s). */
export const TRAIN_DT = 1 / 60;

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
    return serializeBrain(pop.bestEver, inputNames(rays, pop.config.navInputs ? NAV_INPUTS : []), {
      generations: pop.generation,
      bestFitness: Math.round(pop.bestEverFitness * 10) / 10,
      world,
      mutation: pop.config.mutation,
      date,
    });
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

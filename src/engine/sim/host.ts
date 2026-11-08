/**
 * What an AI population (or any extension) needs from the world it drives in. Both the
 * city simulation and the infinite road implement it, so training code is shared.
 * @module engine/sim/host
 */
import type { Car } from '../car/car.ts';
import type { CollisionWorld } from '../car/damage.ts';
import type { TrafficLightSystem } from '../markings/trafficLightController.ts';
import type { SpawnPose } from '../markings/start.ts';
import type { Rng } from '../math/rng.ts';
import type { Particles, SkidMarks } from './particlesSim.ts';

/** Measures how far each car has progressed: the basis of fitness. */
export interface ProgressTracker {
  /** Called when car `i` is (re)spawned. */
  reset(i: number, car: Car): void;
  /** Current progress of car `i` in world units (monotone, never decreases). */
  update(i: number, car: Car): number;
  /**
   * Navigation inputs for the AI navigation mode (F5): writes the normalised signed
   * angle to the next waypoint (−1..1) into out[0]. Optional.
   */
  waypoint?(i: number, car: Car, out: Float64Array): void;
  /** True once car `i` reached the destination (if the tracker has one). */
  finished?(i: number): boolean;
}

/** Something that adds cars and per-step logic to a simulation (the AI population). */
export interface SimExtension {
  readonly cars: readonly Car[];
  step(sim: SimHost, dt: number): void;
}

export interface SimHost {
  readonly kind: 'city' | 'infinite';
  readonly world: CollisionWorld;
  readonly particles: Particles;
  readonly skids: SkidMarks;
  readonly rng: Rng;
  readonly lights: TrafficLightSystem | null;
  time: number;
  stepCount: number;
  cars: Car[];
  manual: Car | null;
  extension: SimExtension | null;
  setExtension(ext: SimExtension | null): void;
  damage(car: Car): void;
  afterMove(car: Car, effects?: boolean): void;
  /** Spawn pose for population car `index` (round-robin over starts). */
  spawnPose(index: number): SpawnPose;
  /**
   * Called at the start of every generation: re-seeds traffic so each generation faces
   * identical conditions (fair comparison, and the elite replays its exact run).
   */
  resetForGeneration?(): void;
  /** A progress tracker for `capacity` cars suited to this world. */
  createProgressTracker(capacity: number): ProgressTracker;
  step(dt: number): void;
  getCar(id: number): Car | undefined;
}

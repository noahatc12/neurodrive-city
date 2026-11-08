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

/** Number of values {@link ProgressTracker.observe} writes. */
export const OBSERVATION_SIZE = 5;

/** Measures how far each car has progressed: the basis of fitness. */
export interface ProgressTracker {
  /** Called when car `i` is (re)spawned. */
  reset(i: number, car: Car): void;
  /**
   * Current progress of car `i` in world units (monotone, never decreases) after a step
   * of `dt` seconds (default 1/60).
   */
  update(i: number, car: Car, dt?: number): number;
  /**
   * Route inputs for the AI navigation mode (F5), each in [−1, 1], written into
   * `out[0..4]`: `lat` (signed offset from the lane centre, negative toward oncoming
   * traffic), `hdg` (heading error against the lane, positive when the car points left
   * of it), `wpNear` and `wpFar` (signed angles to the lane 60 and 160 units ahead,
   * positive to the left) and `speed` (fraction of max speed). Optional.
   */
  observe?(i: number, car: Car, out: Float64Array): void;
  /** True once car `i` reached the destination (if the tracker has one). */
  finished?(i: number): boolean;
  /** True once car `i` has spent too long over the centre line (eliminate it). */
  laneViolation?(i: number): boolean;
  /** Seconds car `i` spent fully in its lane ÷ seconds alive (NaN before the first step). */
  inLaneFraction?(i: number): number;
  /** Lane credit factor of car `i` at its last step: 1 in lane, 0 off it. */
  laneFactor?(i: number): number;
  /** Length of the whole evaluated route (units), when the tracker follows one. */
  readonly routeLength?: number;
  /** Caps the evaluated route at `units` from the start (curriculum); Infinity = whole route. */
  setHorizon?(units: number): void;
}

/** Something that adds cars and per-step logic to a simulation (the AI population). */
export interface SimExtension {
  readonly cars: readonly Car[];
  step(sim: SimHost, dt: number): void;
}

export interface SimHost {
  readonly kind: 'city' | 'infinite';
  /** Width of a road (both directions) in units: scales spawn jitter. */
  readonly roadWidth: number;
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

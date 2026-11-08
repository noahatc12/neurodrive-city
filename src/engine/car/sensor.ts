/**
 * Ray sensors (spec E4): N rays spread over an angle in front of the car. Each ray
 * reports the closest hit in the collidable set as an offset in [0, 1]; the value fed
 * to the network is `1 - offset` (1 = touching, 0 = nothing within range).
 *
 * ```
 *            ray 0      ray 2      ray 4
 *               ╲         │         ╱        spread = π/2 by default
 *                ╲        │        ╱         length = 150 units
 *                 ╲       │       ╱
 *                  ┌──────┴──────┐
 *                  │     car     │
 * ```
 *
 * All buffers are preallocated; `update` allocates nothing.
 *
 * @module engine/car/sensor
 */
import type { Car } from './car.ts';
import { HIT_NONE, type CollisionWorld } from './damage.ts';

export interface SensorConfig {
  /** Number of rays (3..15). */
  rayCount: number;
  /** Total spread angle in radians. */
  spread: number;
  /** Ray length in world units. */
  length: number;
}

export const DEFAULT_SENSOR: Readonly<SensorConfig> = Object.freeze({
  rayCount: 5,
  spread: Math.PI / 2,
  length: 150,
});

export class Sensor {
  readonly config: SensorConfig;
  /** Network inputs: 1 − offset per ray (0 when nothing is hit). */
  readonly readings: Float64Array;
  /** Raw offsets (1 when nothing is hit). */
  readonly offsets: Float64Array;
  /** HIT_* kind per ray. */
  readonly kinds: Int8Array;
  /** Ray segments [ox, oy, ex, ey] per ray (full length), for rendering. */
  readonly rays: Float64Array;

  constructor(config: Partial<SensorConfig> = {}) {
    const rc = Math.max(1, Math.min(15, Math.round(config.rayCount ?? DEFAULT_SENSOR.rayCount)));
    this.config = { ...DEFAULT_SENSOR, ...config, rayCount: rc };
    this.readings = new Float64Array(rc);
    this.offsets = new Float64Array(rc).fill(1);
    this.kinds = new Int8Array(rc).fill(HIT_NONE);
    this.rays = new Float64Array(rc * 4);
  }

  get rayCount(): number {
    return this.config.rayCount;
  }

  /** Relative angle of ray i (left-most first, like the course). */
  rayAngle(i: number): number {
    const n = this.config.rayCount;
    const half = this.config.spread / 2;
    return n === 1 ? 0 : half - (this.config.spread * i) / (n - 1);
  }

  /** Casts every ray from the car's centre against the collision world. */
  update(car: Car, world: CollisionWorld, seeCars: boolean): void {
    const n = this.config.rayCount;
    const len = this.config.length;
    for (let i = 0; i < n; i++) {
      const a = car.angle + this.rayAngle(i);
      const ox = car.x;
      const oy = car.y;
      const ex = ox - Math.sin(a) * len;
      const ey = oy - Math.cos(a) * len;
      this.rays[i * 4] = ox;
      this.rays[i * 4 + 1] = oy;
      this.rays[i * 4 + 2] = ex;
      this.rays[i * 4 + 3] = ey;
      const hit = world.castRay(ox, oy, ex, ey, car.id, seeCars);
      this.offsets[i] = hit.offset;
      this.kinds[i] = hit.kind;
      this.readings[i] = hit.kind === HIT_NONE ? 0 : 1 - hit.offset;
    }
  }

  /** Clears readings (damaged cars stop sensing). */
  clear(): void {
    this.readings.fill(0);
    this.offsets.fill(1);
    this.kinds.fill(HIT_NONE);
  }
}

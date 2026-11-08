/**
 * Yield sign behaviour (spec D2): slow down when approaching; if another car is within
 * the detection radius of the junction, stop at the line until it clears, otherwise
 * proceed without stopping.
 * @module engine/markings/yield
 */
import { stoppingSpeed } from './stop.ts';

/** Speed factor (of max speed) at a yield line. */
export const YIELD_SLOW_FACTOR = 0.45;
/** Detection radius around the junction, in road widths. */
export const YIELD_DETECT_ROAD_WIDTHS = 2.2;

/**
 * Maximum speed for a car approaching a yield line.
 * @param dist distance to the line (units; negative once past it)
 * @param conflict true when another car is within the detection radius
 * @param zone distance over which the car slows down
 */
export function yieldMaxSpeed(
  dist: number,
  conflict: boolean,
  maxSpeed: number,
  decel: number,
  zone: number,
): number {
  if (dist < 0 || dist > zone) return Infinity;
  if (conflict) return stoppingSpeed(dist - 6, decel);
  const slow = maxSpeed * YIELD_SLOW_FACTOR;
  return slow + (maxSpeed - slow) * (dist / zone);
}

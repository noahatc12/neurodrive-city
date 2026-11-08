/**
 * Zebra crossing behaviour (spec D3): cars slow to a crawl while approaching and
 * driving over the crossing.
 * @module engine/markings/crossing
 */

/** Crawl speed factor (of max speed) on and just before a crossing. */
export const CROSSING_CRAWL_FACTOR = 0.25;

/**
 * Maximum speed near a crossing: a smooth ramp from full speed at the edge of the zone
 * down to a crawl at the stripes, and a crawl while on them.
 * @param dist distance from the car to the crossing centre (negative once past it)
 * @param halfLength half the crossing length along the road
 */
export function crossingMaxSpeed(
  dist: number,
  halfLength: number,
  maxSpeed: number,
  zone: number,
): number {
  if (dist < -halfLength || dist > zone) return Infinity;
  const crawl = maxSpeed * CROSSING_CRAWL_FACTOR;
  if (dist <= halfLength) return crawl;
  const f = (dist - halfLength) / Math.max(1e-6, zone - halfLength);
  return crawl + (maxSpeed - crawl) * f;
}
